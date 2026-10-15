import * as fs from 'fs/promises';
import * as path from 'path';
import { PublicTargetProfile, TargetProfile } from './types';

export class ProfileStore {
  constructor(private readonly filePath: string, private readonly legacyFilePaths: string[] = []) {}

  private async read(): Promise<TargetProfile[]> {
    const paths = [this.filePath, ...this.legacyFilePaths];
    for (const candidate of paths) {
      try {
        return JSON.parse(await fs.readFile(candidate, 'utf8')) as TargetProfile[];
      } catch {
        // Try the next legacy location before treating this as a new installation.
      }
    }
    return [];
  }

  private async write(profiles: TargetProfile[]): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(profiles, null, 2), { mode: 0o600 });
    try { await fs.chmod(this.filePath, 0o600); } catch { /* best effort on Windows */ }
  }

  async listPublic(): Promise<PublicTargetProfile[]> {
    const profiles = await this.read();
    return profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      type: profile.type,
      publicUrl: profile.publicUrl,
      hasSecret: Boolean(profile.sftp?.password || profile.sftp?.privateKey || profile.github?.token),
      destination: profile.type === 'sftp'
        ? `${profile.sftp?.host || ''}${profile.sftp?.remotePath ? `:${profile.sftp.remotePath}` : ''}`
        : `${profile.github?.owner || ''}/${profile.github?.repository || ''}:${profile.github?.branch || ''}`,
    }));
  }

  async get(id: string): Promise<TargetProfile | undefined> {
    return (await this.read()).find((profile) => profile.id === id);
  }

  async save(input: TargetProfile): Promise<PublicTargetProfile[]> {
    const profiles = await this.read();
    const previous = profiles.find((profile) => profile.id === input.id);
    const merged = JSON.parse(JSON.stringify(input)) as TargetProfile;
    if (previous && !merged.sftp?.authMethod) {
      if (merged.sftp && !merged.sftp.password && !merged.sftp.privateKey && previous.sftp) {
        merged.sftp.password = previous.sftp.password;
        merged.sftp.privateKey = previous.sftp.privateKey;
      }
      if (merged.github && !merged.github.token && previous.github) merged.github.token = previous.github.token;
    }
    const next = profiles.filter((profile) => profile.id !== merged.id);
    next.push(merged);
    await this.write(next);
    return this.listPublic();
  }

  async remove(id: string): Promise<PublicTargetProfile[]> {
    await this.write((await this.read()).filter((profile) => profile.id !== id));
    return this.listPublic();
  }
}
