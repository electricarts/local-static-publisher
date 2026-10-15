"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadSftp = uploadSftp;
exports.testSftpConnection = testSftpConnection;
exports.pushGithub = pushGithub;
exports.testGithubConnection = testGithubConnection;
exports.testTargetConnection = testTargetConnection;
exports.publishTarget = publishTarget;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
async function listFiles(root, current = root) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const absolute = path.join(current, entry.name);
        if (entry.isDirectory())
            files.push(...await listFiles(root, absolute));
        else
            files.push(path.relative(root, absolute));
    }
    return files;
}
function posixJoin(...parts) {
    return parts.join('/').replace(/\\/g, '/').replace(/\/+/g, '/');
}
const DEFAULT_SSH_KEY_NAMES = ['id_ed25519', 'id_ecdsa', 'id_rsa', 'id_dsa'];
function stripSshComment(line) {
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        if (character === '"')
            quoted = !quoted;
        if (character === '#' && !quoted && (index === 0 || /\s/.test(line[index - 1])))
            return line.slice(0, index);
    }
    return line;
}
function unquoteSshValue(value) {
    const trimmed = value.trim();
    if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"'))
        return trimmed.slice(1, -1);
    return trimmed;
}
function hostPatternMatches(pattern, host) {
    const escaped = pattern.toLowerCase().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`, 'i').test(host);
}
function sshHostMatches(patterns, host) {
    let matched = false;
    for (const pattern of patterns) {
        if (!pattern)
            continue;
        const negated = pattern.startsWith('!');
        const candidate = negated ? pattern.slice(1) : pattern;
        if (!hostPatternMatches(candidate, host))
            continue;
        if (negated)
            return false;
        matched = true;
    }
    return matched;
}
function parseSshConfig(contents, host) {
    const globalOptions = {};
    const blocks = [];
    let activeOptions = globalOptions;
    let activePatterns;
    for (const rawLine of contents.split(/\r?\n/)) {
        const line = stripSshComment(rawLine).trim();
        if (!line)
            continue;
        const match = line.match(/^([^\s=]+)\s*(?:=|\s)\s*(.*?)\s*$/);
        if (!match)
            continue;
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
        if (!activePatterns && activeOptions !== globalOptions)
            continue;
        activeOptions[key] = activeOptions[key] || [];
        activeOptions[key].push(value);
    }
    const parsed = { identityFiles: [] };
    const applyOptions = (options) => {
        var _a, _b, _c, _d;
        if (!parsed.hostName && ((_a = options.hostname) === null || _a === void 0 ? void 0 : _a[0]))
            parsed.hostName = options.hostname[0];
        if (!parsed.user && ((_b = options.user) === null || _b === void 0 ? void 0 : _b[0]))
            parsed.user = options.user[0];
        if (!parsed.port && ((_c = options.port) === null || _c === void 0 ? void 0 : _c[0])) {
            const port = Number(options.port[0]);
            if (Number.isInteger(port) && port > 0 && port <= 65535)
                parsed.port = port;
        }
        if (options.identityfile)
            parsed.identityFiles.push(...options.identityfile);
        if (parsed.identityAgent === undefined && ((_d = options.identityagent) === null || _d === void 0 ? void 0 : _d[0]))
            parsed.identityAgent = options.identityagent[0];
    };
    applyOptions(globalOptions);
    for (const block of blocks) {
        if (sshHostMatches(block.patterns, host))
            applyOptions(block.options);
    }
    return parsed;
}
function expandSshTokens(value, target, hostName) {
    return value.trim()
        .replace(/%d/g, os.homedir())
        .replace(/%h/g, hostName || target.host)
        .replace(/%n/g, target.host)
        .replace(/%p/g, String(target.port || 22))
        .replace(/%r/g, target.username || '');
}
function expandSshPath(value, sshDirectory, target, hostName) {
    let expanded = expandSshTokens(value, target, hostName);
    expanded = expanded.replace(/^~(?=\/|$)/, os.homedir());
    return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(sshDirectory, expanded);
}
function expandSshAgent(value, sshDirectory, target, hostName) {
    var _a;
    if (!value || value.toLowerCase() === 'none')
        return undefined;
    const environmentName = (_a = value.match(/^\$([A-Za-z_][A-Za-z0-9_]*)$/)) === null || _a === void 0 ? void 0 : _a[1];
    if (environmentName)
        return process.env[environmentName];
    return expandSshPath(value, sshDirectory, target, hostName);
}
function defaultOnePasswordAgentSockets() {
    const sockets = [path.join(os.homedir(), '.1password/agent.sock')];
    if (process.platform === 'darwin') {
        sockets.unshift(path.join(os.homedir(), 'Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock'));
    }
    return sockets;
}
async function agentIdentityCount(agentSocket) {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { OpenSSHAgent } = require('ssh2');
        const agent = new OpenSSHAgent(agentSocket);
        return await new Promise((resolve) => {
            let settled = false;
            const finish = (count) => {
                if (settled)
                    return;
                settled = true;
                resolve(count);
            };
            const timeout = setTimeout(() => finish(0), 1500);
            agent.getIdentities((error, identities) => {
                clearTimeout(timeout);
                finish(error || !Array.isArray(identities) ? 0 : identities.length);
            });
        });
    }
    catch {
        return 0;
    }
}
async function findUsableAgentSocket(candidates) {
    const accessible = [];
    for (const candidate of candidates) {
        try {
            await fs.access(candidate);
            accessible.push(candidate);
            if (await agentIdentityCount(candidate) > 0)
                return { socket: candidate, accessible };
        }
        catch {
            // Try the next candidate.
        }
    }
    return { accessible };
}
function inferAuthMethod(target) {
    if (target.authMethod)
        return target.authMethod;
    if (target.password)
        return 'password';
    if (target.privateKey)
        return 'privateKey';
    return 'sshAgent';
}
function authMethodLabel(target) {
    switch (inferAuthMethod(target)) {
        case 'password': return 'password';
        case 'privateKey': return 'private key';
        case 'sshConfig': return 'SSH config/default key';
        default: return 'SSH agent';
    }
}
function sftpConnectionError(profile, config, error) {
    const target = profile.sftp;
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
async function applySshConfigAuthentication(config, target) {
    const sshDirectory = path.join(os.homedir(), '.ssh');
    let parsed = { identityFiles: [] };
    try {
        const contents = await fs.readFile(path.join(sshDirectory, 'config'), 'utf8');
        parsed = parseSshConfig(contents, target.host);
    }
    catch {
        // A missing SSH config is fine; the standard key names are tried below.
    }
    if (parsed.hostName)
        config.host = expandSshTokens(parsed.hostName, target);
    if (parsed.port)
        config.port = parsed.port;
    if (parsed.user)
        config.username = parsed.user;
    const configuredAgent = expandSshAgent(parsed.identityAgent, sshDirectory, target, parsed.hostName);
    const agentCandidates = parsed.identityAgent === undefined
        ? [configuredAgent, process.env.SSH_AUTH_SOCK]
        : [configuredAgent];
    const agentResult = await findUsableAgentSocket(agentCandidates
        .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index));
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
        }
        catch {
            // Try the next configured/default identity file.
        }
    }
    const agentHint = agentResult.accessible.length ? ' The available agent socket(s) did not provide any identities.' : '';
    throw new Error(`No usable SSH authentication found in ~/.ssh/config or ~/.ssh.${agentHint} Select an SSH agent, password, or private-key profile.`);
}
async function createSftpConfig(target) {
    const config = {
        host: target.host,
        port: target.port || 22,
        username: target.username,
    };
    await applySftpAuthentication(config, target);
    if (!String(config.host || '').trim())
        throw new Error('SFTP host is required.');
    if (!String(config.username || '').trim())
        throw new Error('SFTP username is required.');
    return config;
}
async function applySftpAuthentication(config, target) {
    var _a;
    const authMethod = inferAuthMethod(target);
    if (authMethod === 'password') {
        if (!target.password)
            throw new Error('SFTP password authentication is selected, but no password is configured.');
        config.password = target.password;
        return;
    }
    if (authMethod === 'privateKey') {
        if (!target.privateKey)
            throw new Error('SFTP private-key authentication is selected, but no private key is configured.');
        config.privateKey = target.privateKey;
        return;
    }
    if (authMethod === 'sshConfig') {
        await applySshConfigAuthentication(config, target);
        return;
    }
    const candidates = [(_a = target.agentSocket) === null || _a === void 0 ? void 0 : _a.trim(), process.env.SSH_AUTH_SOCK, ...defaultOnePasswordAgentSockets()]
        .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index);
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
async function uploadSftp(profile, outputDir, onProgress) {
    if (!profile.sftp)
        throw new Error('The SFTP profile is incomplete.');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const SftpClient = require('ssh2-sftp-client');
    const client = new SftpClient();
    const config = await createSftpConfig(profile.sftp);
    try {
        await client.connect(config);
    }
    catch (error) {
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
    }
    finally {
        await client.end();
    }
}
async function testSftpConnection(profile) {
    if (!profile.sftp)
        throw new Error('The SFTP profile is incomplete.');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const SftpClient = require('ssh2-sftp-client');
    const client = new SftpClient();
    const config = await createSftpConfig(profile.sftp);
    try {
        await client.connect(config);
        return `SFTP connection successful for ${String(config.username)}@${String(config.host)}:${Number(config.port || 22)}.`;
    }
    catch (error) {
        throw sftpConnectionError(profile, config, error);
    }
    finally {
        try {
            await client.end();
        }
        catch { /* best effort after a failed connection */ }
    }
}
function githubRequest(token, method, endpoint, body) {
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
        }, (response) => {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
            response.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                let parsed = {};
                try {
                    parsed = text ? JSON.parse(text) : {};
                }
                catch {
                    parsed = { raw: text };
                }
                if (response.statusCode >= 200 && response.statusCode < 300)
                    resolve(parsed);
                else
                    reject(new Error(`GitHub API ${response.statusCode}: ${parsed.message || text}`));
            });
        });
        request.on('error', reject);
        if (body)
            request.write(JSON.stringify(body));
        request.end();
    });
}
async function pushGithub(profile, outputDir, onProgress) {
    if (!profile.github)
        throw new Error('The GitHub profile is incomplete.');
    const { token, owner, repository, branch } = profile.github;
    if (!token || !owner || !repository || !branch)
        throw new Error('GitHub requires a token, owner, repository, and branch.');
    const prefix = (profile.github.pathPrefix || '').replace(/^\/+|\/+$/g, '');
    const files = await listFiles(outputDir);
    const ref = await githubRequest(token, 'GET', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/ref/heads/${encodeURIComponent(branch)}`);
    const baseCommitSha = ref.object.sha;
    const baseCommit = await githubRequest(token, 'GET', `/repos/${owner}/${repository}/git/commits/${baseCommitSha}`);
    const treeEntries = [];
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
async function testGithubConnection(profile) {
    if (!profile.github)
        throw new Error('The GitHub profile is incomplete.');
    const { token, owner, repository, branch } = profile.github;
    if (!token || !owner || !repository || !branch)
        throw new Error('GitHub requires a token, owner, repository, and branch.');
    await githubRequest(token, 'GET', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`);
    await githubRequest(token, 'GET', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/ref/heads/${encodeURIComponent(branch)}`);
    return `GitHub connection successful for ${owner}/${repository} (${branch}).`;
}
async function testTargetConnection(profile) {
    if (profile.type === 'sftp')
        return testSftpConnection(profile);
    if (profile.type === 'github')
        return testGithubConnection(profile);
    throw new Error(`Unknown target type: ${profile.type}`);
}
async function publishTarget(profile, outputDir, onProgress) {
    if (profile.type === 'sftp') {
        await uploadSftp(profile, outputDir, onProgress);
        return undefined;
    }
    if (profile.type === 'github')
        return pushGithub(profile, outputDir, onProgress);
    throw new Error(`Unknown target type: ${profile.type}`);
}
//# sourceMappingURL=transports.js.map