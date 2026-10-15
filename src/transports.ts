import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { SftpAuthMethod, SftpTarget, TargetProfile } from './types';

async function listFiles(root: string, current = root): Promise<string[]> {
  const entries = await fs.readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, absolute));
    else files.push(path.relative(root, absolute));
  }
  return files;
}

function posixJoin(...parts: string[]): string {
  return parts.join('/').replace(/\\/g, '/').replace(/\/+/g, '/');
}

const DEFAULT_SSH_KEY_NAMES = ['id_ed25519', 'id_ecdsa', 'id_rsa', 'id_dsa'];

type SshConfigOptions = Record<string, string[]>;

interface ParsedSshConfig {
  hostName?: string;
  port?: number;
  user?: string;
  identityFiles: string[];
  identityAgent?: string;
}

function stripSshComment(line: string): string {
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') quoted = !quoted;
    if (character === '#' && !quoted && (index === 0 || /\s/.test(line[index - 1]))) return line.slice(0, index);
  }
  return line;
}

function unquoteSshValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1);
  return trimmed;
}

function hostPatternMatches(pattern: string, host: string): boolean {
  const escaped = pattern.toLowerCase().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i').test(host);
}

function sshHostMatches(patterns: string[], host: string): boolean {
  let matched = false;
  for (const pattern of patterns) {
    if (!pattern) continue;
    const negated = pattern.startsWith('!');
    const candidate = negated ? pattern.slice(1) : pattern;
    if (!hostPatternMatches(candidate, host)) continue;
    if (negated) return false;
    matched = true;
  }
  return matched;
}

function parseSshConfig(contents: string, host: string): ParsedSshConfig {
  const globalOptions: SshConfigOptions = {};
  const blocks: Array<{ patterns: string[]; options: SshConfigOptions }> = [];
  let activeOptions = globalOptions;
  let activePatterns: string[] | undefined;

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = stripSshComment(rawLine).trim();
    if (!line) continue;
    const match = line.match(/^([^\s=]+)\s*(?:=|\s)\s*(.*?)\s*$/);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = unquoteSshValue(match[2]);
    if (key === 'host') {
      activePatterns = value.split(/\s+/).filter(Boolean);
      activeOptions = {};
      blocks.push({ patterns: activePatterns, options: activeOptions });
      continue;
    }
    if (key === 'match') {
      activePatterns = undefined;
      activeOptions = {};
      continue;
    }
    if (!activePatterns && activeOptions !== globalOptions) continue;
    activeOptions[key] = activeOptions[key] || [];
    activeOptions[key].push(value);
  }

  const parsed: ParsedSshConfig = { identityFiles: [] };
  const applyOptions = (options: SshConfigOptions) => {
    if (!parsed.hostName && options.hostname?.[0]) parsed.hostName = options.hostname[0];
    if (!parsed.user && options.user?.[0]) parsed.user = options.user[0];
    if (!parsed.port && options.port?.[0]) {
      const port = Number(options.port[0]);
      if (Number.isInteger(port) && port > 0 && port <= 65535) parsed.port = port;
    }
    if (options.identityfile) parsed.identityFiles.push(...options.identityfile);
    if (parsed.identityAgent === undefined && options.identityagent?.[0]) parsed.identityAgent = options.identityagent[0];
  };

  applyOptions(globalOptions);
  for (const block of blocks) {
    if (sshHostMatches(block.patterns, host)) applyOptions(block.options);
  }
  return parsed;
}

function expandSshTokens(value: string, target: SftpTarget, hostName?: string): string {
  return value.trim()
    .replace(/%d/g, os.homedir())
    .replace(/%h/g, hostName || target.host)
    .replace(/%n/g, target.host)
    .replace(/%p/g, String(target.port || 22))
    .replace(/%r/g, target.username || '');
}

function expandSshPath(value: string, sshDirectory: string, target: SftpTarget, hostName?: string): string {
  let expanded = expandSshTokens(value, target, hostName);
  expanded = expanded.replace(/^~(?=\/|$)/, os.homedir());
  return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(sshDirectory, expanded);
}

function expandSshAgent(value: string | undefined, sshDirectory: string, target: SftpTarget, hostName?: string): string | undefined {
  if (!value || value.toLowerCase() === 'none') return undefined;
  const environmentName = value.match(/^\$([A-Za-z_][A-Za-z0-9_]*)$/)?.[1];
  if (environmentName) return process.env[environmentName];
  return expandSshPath(value, sshDirectory, target, hostName);
}

function defaultOnePasswordAgentSockets(): string[] {
  const sockets = [path.join(os.homedir(), '.1password/agent.sock')];
  if (process.platform === 'darwin') {
    sockets.unshift(path.join(os.homedir(), 'Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock'));
  }
  return sockets;
}

async function agentIdentityCount(agentSocket: string): Promise<number> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { OpenSSHAgent } = require('ssh2');
    const agent = new OpenSSHAgent(agentSocket);
    return await new Promise<number>((resolve) => {
      let settled = false;
      const finish = (count: number) => {
        if (settled) return;
        settled = true;
        resolve(count);
      };
      const timeout = setTimeout(() => finish(0), 1500);
      agent.getIdentities((error: unknown, identities: unknown[]) => {
        clearTimeout(timeout);
        finish(error || !Array.isArray(identities) ? 0 : identities.length);
      });
    });
  } catch {
    return 0;
  }
}

async function findUsableAgentSocket(candidates: string[]): Promise<{ socket?: string; accessible: string[] }> {
  const accessible: string[] = [];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      accessible.push(candidate);
      if (await agentIdentityCount(candidate) > 0) return { socket: candidate, accessible };
    } catch {
      // Try the next candidate.
    }
  }
  return { accessible };
}

function inferAuthMethod(target: SftpTarget): SftpAuthMethod {
  if (target.authMethod) return target.authMethod;
  if (target.password) return 'password';
  if (target.privateKey) return 'privateKey';
  return 'sshAgent';
}

function authMethodLabel(target: SftpTarget): string {
  switch (inferAuthMethod(target)) {
    case 'password': return 'password';
    case 'privateKey': return 'private key';
    case 'sshConfig': return 'SSH config/default key';
    default: return 'SSH agent';
  }
}

function sftpConnectionError(profile: TargetProfile, config: Record<string, unknown>, error: unknown): Error {
  const target = profile.sftp!;
  const host = String(config.host || target.host);
  const port = Number(config.port || target.port || 22);
  const username = String(config.username || target.username || '');
  const message = error instanceof Error ? error.message : String(error);
  const identityHint = inferAuthMethod(target) === 'sshAgent'
    ? ' Check that the agent is running and contains the private key whose public key is authorized on the server.'
    : inferAuthMethod(target) === 'sshConfig'
      ? ' Check the matching Host entry and IdentityFile in ~/.ssh/config.'
      : '';
  return new Error(`SFTP connection failed for ${username ? `${username}@` : ''}${host}:${port} using ${authMethodLabel(target)}. ${message}${identityHint}`);
}

async function applySshConfigAuthentication(config: Record<string, unknown>, target: SftpTarget): Promise<void> {
  const sshDirectory = path.join(os.homedir(), '.ssh');
  let parsed: ParsedSshConfig = { identityFiles: [] };
  try {
    const contents = await fs.readFile(path.join(sshDirectory, 'config'), 'utf8');
    parsed = parseSshConfig(contents, target.host);
  } catch {
    // A missing SSH config is fine; the standard key names are tried below.
  }

  if (parsed.hostName) config.host = expandSshTokens(parsed.hostName, target);
  if (parsed.port) config.port = parsed.port;
  if (parsed.user) config.username = parsed.user;

  const configuredAgent = expandSshAgent(parsed.identityAgent, sshDirectory, target, parsed.hostName);
  const agentCandidates = parsed.identityAgent === undefined
    ? [configuredAgent, process.env.SSH_AUTH_SOCK]
    : [configuredAgent];
  const agentResult = await findUsableAgentSocket(agentCandidates
    .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index));
  if (agentResult.socket) {
    config.agent = agentResult.socket;
    return;
  }

  const identityFiles = [...parsed.identityFiles, ...DEFAULT_SSH_KEY_NAMES.map((name) => path.join(sshDirectory, name))]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .map((value) => expandSshPath(value, sshDirectory, target, parsed.hostName));
  for (const identityFile of identityFiles) {
    try {
      const privateKey = await fs.readFile(identityFile);
      if (privateKey.length > 0) {
        config.privateKey = privateKey;
        return;
      }
    } catch {
      // Try the next configured/default identity file.
    }
  }

  const agentHint = agentResult.accessible.length ? ' The available agent socket(s) did not provide any identities.' : '';
  throw new Error(`No usable SSH authentication found in ~/.ssh/config or ~/.ssh.${agentHint} Select an SSH agent, password, or private-key profile.`);
}

async function createSftpConfig(target: SftpTarget): Promise<Record<string, unknown>> {
  const config: Record<string, unknown> = {
    host: target.host,
    port: target.port || 22,
    username: target.username,
  };
  await applySftpAuthentication(config, target);
  if (!String(config.host || '').trim()) throw new Error('SFTP host is required.');
  if (!String(config.username || '').trim()) throw new Error('SFTP username is required.');
  return config;
}

async function applySftpAuthentication(config: Record<string, unknown>, target: SftpTarget): Promise<void> {
  const authMethod = inferAuthMethod(target);
  if (authMethod === 'password') {
    if (!target.password) throw new Error('SFTP password authentication is selected, but no password is configured.');
    config.password = target.password;
    return;
  }
  if (authMethod === 'privateKey') {
    if (!target.privateKey) throw new Error('SFTP private-key authentication is selected, but no private key is configured.');
    config.privateKey = target.privateKey;
    return;
  }
  if (authMethod === 'sshConfig') {
    await applySshConfigAuthentication(config, target);
    return;
  }

  const candidates = [target.agentSocket?.trim(), process.env.SSH_AUTH_SOCK, ...defaultOnePasswordAgentSockets()]
    .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);
  const agentResult = await findUsableAgentSocket(candidates);
  if (agentResult.socket) {
    config.agent = agentResult.socket;
    return;
  }
  if (candidates.length === 0) {
    throw new Error('No SSH agent found. Enable the 1Password SSH agent or choose password/private-key authentication.');
  }
  if (agentResult.accessible.length > 0) {
    throw new Error('SSH agent socket found, but no identities were available. Add the server key to the agent or choose password/private-key authentication.');
  }
  throw new Error(`SSH agent socket not found. Tried: ${candidates.join(', ')}`);
}

export async function uploadSftp(profile: TargetProfile, outputDir: string, onProgress: (message: string, current?: number, total?: number) => void): Promise<void> {
  if (!profile.sftp) throw new Error('The SFTP profile is incomplete.');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const SftpClient = require('ssh2-sftp-client');
  const client = new SftpClient();
  const config = await createSftpConfig(profile.sftp);

  try {
    await client.connect(config);
  } catch (error) {
    throw sftpConnectionError(profile, config, error);
  }
  try {
    const files = await listFiles(outputDir);
    const remoteRoot = profile.sftp.remotePath.replace(/\/$/, '') || '/';
    for (const [index, relative] of files.entries()) {
      const local = path.join(outputDir, relative);
      const remote = posixJoin(remoteRoot, relative);
      await client.mkdir(path.posix.dirname(remote), true);
      await client.put(local, remote);
      onProgress(`SFTP: ${index + 1}/${files.length} – ${relative}`, index + 1, files.length);
    }
  } finally {
    await client.end();
  }
}

export async function testSftpConnection(profile: TargetProfile): Promise<string> {
  if (!profile.sftp) throw new Error('The SFTP profile is incomplete.');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const SftpClient = require('ssh2-sftp-client');
  const client = new SftpClient();
  const config = await createSftpConfig(profile.sftp);
  try {
    await client.connect(config);
    return `SFTP connection successful for ${String(config.username)}@${String(config.host)}:${Number(config.port || 22)}.`;
  } catch (error) {
    throw sftpConnectionError(profile, config, error);
  } finally {
    try { await client.end(); } catch { /* best effort after a failed connection */ }
  }
}

function githubRequest(token: string, method: string, endpoint: string, body?: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const request = require('https').request({
      hostname: 'api.github.com',
      path: endpoint,
      method,
      headers: {
        'User-Agent': 'WordPress-Static-Publisher/0.2 prototype',
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
    }, (response: any) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed: any = {};
        try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(parsed);
        else reject(new Error(`GitHub API ${response.statusCode}: ${parsed.message || text}`));
      });
    });
    request.on('error', reject);
    if (body) request.write(JSON.stringify(body));
    request.end();
  });
}

export async function pushGithub(profile: TargetProfile, outputDir: string, onProgress: (message: string, current?: number, total?: number) => void): Promise<string | undefined> {
  if (!profile.github) throw new Error('The GitHub profile is incomplete.');
  const { token, owner, repository, branch } = profile.github;
  if (!token || !owner || !repository || !branch) throw new Error('GitHub requires a token, owner, repository, and branch.');

  const prefix = (profile.github.pathPrefix || '').replace(/^\/+|\/+$/g, '');
  const files = await listFiles(outputDir);
  const ref = await githubRequest(token, 'GET', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/ref/heads/${encodeURIComponent(branch)}`);
  const baseCommitSha = ref.object.sha;
  const baseCommit = await githubRequest(token, 'GET', `/repos/${owner}/${repository}/git/commits/${baseCommitSha}`);
  const treeEntries: Array<Record<string, unknown>> = [];

  for (const [index, relative] of files.entries()) {
    const contents = await fs.readFile(path.join(outputDir, relative));
    const blob = await githubRequest(token, 'POST', `/repos/${owner}/${repository}/git/blobs`, {
      content: contents.toString('base64'),
      encoding: 'base64',
    });
    treeEntries.push({ path: prefix ? `${prefix}/${relative.replace(/\\/g, '/')}` : relative.replace(/\\/g, '/'), mode: '100644', type: 'blob', sha: blob.sha });
    onProgress(`GitHub: ${index + 1}/${files.length} – ${relative}`, index + 1, files.length);
  }

  const tree = await githubRequest(token, 'POST', `/repos/${owner}/${repository}/git/trees`, {
    base_tree: baseCommit.tree.sha,
    tree: treeEntries,
  });
  const commit = await githubRequest(token, 'POST', `/repos/${owner}/${repository}/git/commits`, {
    message: `Static export ${new Date().toISOString()}`,
    tree: tree.sha,
    parents: [baseCommitSha],
  });
  await githubRequest(token, 'PATCH', `/repos/${owner}/${repository}/git/refs/heads/${encodeURIComponent(branch)}`, { sha: commit.sha, force: false });
  return commit.html_url;
}

export async function testGithubConnection(profile: TargetProfile): Promise<string> {
  if (!profile.github) throw new Error('The GitHub profile is incomplete.');
  const { token, owner, repository, branch } = profile.github;
  if (!token || !owner || !repository || !branch) throw new Error('GitHub requires a token, owner, repository, and branch.');
  await githubRequest(token, 'GET', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`);
  await githubRequest(token, 'GET', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/ref/heads/${encodeURIComponent(branch)}`);
  return `GitHub connection successful for ${owner}/${repository} (${branch}).`;
}

export async function testTargetConnection(profile: TargetProfile): Promise<string> {
  if (profile.type === 'sftp') return testSftpConnection(profile);
  if (profile.type === 'github') return testGithubConnection(profile);
  throw new Error(`Unknown target type: ${profile.type}`);
}

export async function publishTarget(profile: TargetProfile, outputDir: string, onProgress: (message: string, current?: number, total?: number) => void): Promise<string | undefined> {
  if (profile.type === 'sftp') {
    await uploadSftp(profile, outputDir, onProgress);
    return undefined;
  }
  if (profile.type === 'github') return pushGithub(profile, outputDir, onProgress);
  throw new Error(`Unknown target type: ${profile.type}`);
}
