import React, { useEffect, useMemo, useState } from 'react';
import { ipcRenderer } from 'electron';
import { PublicTargetProfile, SftpAuthMethod, TargetProfile, LocalSite } from './types';

type Progress = {
  jobId?: string;
  phase: string;
  message: string;
  current?: number;
  total?: number;
  outputDir?: string;
  pages?: number;
  assets?: number;
  limitReached?: boolean;
  pendingPages?: number;
  commitUrl?: string;
};

const emptyProfile: TargetProfile = {
  id: '',
  name: '',
  type: 'sftp',
  publicUrl: '',
  sftp: { host: '', port: 22, username: '', authMethod: 'sshAgent', password: '', privateKey: '', agentSocket: '', remotePath: '/' },
};

function makeId(name: string): string {
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'target'}-${Date.now()}`;
}

export default function ExportPanel({ site }: { site: LocalSite }) {
  const [profiles, setProfiles] = useState<PublicTargetProfile[]>([]);
  const [selected, setSelected] = useState('local');
  const [publicUrl, setPublicUrl] = useState('');
  const [maxPages, setMaxPages] = useState(200);
  const [running, setRunning] = useState(false);
  const [testing, setTesting] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [showProfiles, setShowProfiles] = useState(false);
  const [profile, setProfile] = useState<TargetProfile>(emptyProfile);

  const selectedProfile = useMemo(() => profiles.find((item) => item.id === selected), [profiles, selected]);
  const editingProfile = Boolean(profile.id);
  const sftpAuthMethod: SftpAuthMethod = profile.sftp?.authMethod
    || (profile.sftp?.password ? 'password' : profile.sftp?.privateKey ? 'privateKey' : 'sshAgent');
  const progressActive = Boolean(progress && ['starting', 'crawling', 'writing', 'uploading'].includes(progress.phase));
  const progressPercent = progress?.current !== undefined && progress.total
    ? Math.max(0, Math.min(100, Math.round((progress.current / progress.total) * 100)))
    : undefined;

  const refreshProfiles = async () => {
    try {
      const items = await ipcRenderer.invoke('local-static-publisher-list-profiles');
      setProfiles(items || []);
    } catch (error) {
      setProgress({ phase: 'error', message: `Profiles could not be loaded: ${(error as Error).message}` });
    }
  };

  useEffect(() => {
    refreshProfiles();
    const handler = (_event: unknown, next: Progress) => {
      setProgress(next);
      if (next.phase === 'starting' || next.phase === 'crawling' || next.phase === 'writing' || next.phase === 'uploading') setRunning(true);
      if (next.phase === 'complete' || next.phase === 'cancelled' || next.phase === 'error') setRunning(false);
    };
    ipcRenderer.on('local-static-publisher-progress', handler);
    return () => {
      ipcRenderer.removeListener('local-static-publisher-progress', handler);
    };
  }, []);

  const startExport = () => {
    setRunning(true);
    setProgress({ phase: 'starting', message: 'Starting export.' });
    ipcRenderer.send('local-static-publisher-export', site, selected, { publicUrl: publicUrl || selectedProfile?.publicUrl || '', maxPages, includeSitemap: true });
  };

  const loadProfile = async (profileId: string) => {
    try {
      const existing = await ipcRenderer.invoke('local-static-publisher-get-profile', profileId);
      if (!existing) throw new Error('The selected target profile could not be found.');
      setProfile(existing);
      setProgress({ phase: 'complete', message: `Profile “${existing.name}” loaded.` });
    } catch (error) {
      setProgress({ phase: 'error', message: `Profile could not be loaded: ${(error as Error).message}` });
    }
  };

  const selectTarget = (targetId: string) => {
    setSelected(targetId);
    if (targetId === 'local') setProfile(emptyProfile);
    else void loadProfile(targetId);
  };

  const saveProfile = async () => {
    const next = { ...profile, id: profile.id || makeId(profile.name) };
    const wasEditing = Boolean(profile.id);
    try {
      const items = await ipcRenderer.invoke('local-static-publisher-save-profile', next);
      setProfiles(items || []);
      setSelected(next.id);
      setProfile(wasEditing ? next : emptyProfile);
      setProgress({ phase: 'complete', message: `Profile “${next.name}” ${wasEditing ? 'updated' : 'saved'}.` });
    } catch (error) {
      setProgress({ phase: 'error', message: `Profile could not be saved: ${(error as Error).message}` });
    }
  };

  const testConnection = async () => {
    const candidate = { ...profile, id: profile.id || 'connection-test', name: profile.name || 'Connection test' };
    setTesting(true);
    setProgress({ phase: 'starting', message: 'Testing connection …' });
    try {
      const message = await ipcRenderer.invoke('local-static-publisher-test-profile', candidate);
      setProgress({ phase: 'complete', message });
    } catch (error) {
      setProgress({ phase: 'error', message: `Connection test failed: ${(error as Error).message}` });
    } finally {
      setTesting(false);
    }
  };

  const editProfile = async () => {
    if (!selectedProfile) return;
    await loadProfile(selectedProfile.id);
  };

  const deleteProfile = async () => {
    if (!selectedProfile) return;
    const items = await ipcRenderer.invoke('local-static-publisher-delete-profile', selectedProfile.id);
    setProfiles(items || []);
    setSelected('local');
    setProfile(emptyProfile);
  };

  return (
    <section className="esp-panel">
      <div className="esp-header">
        <div>
          <h2>Static Publisher</h2>
          <p>Export and publish a static website from Local · {site.name || site.domain || site.id}</p>
        </div>
        <span className={`esp-status ${running || testing ? 'is-running' : ''}`}>{running ? 'Running …' : testing ? 'Testing …' : 'Ready'}</span>
      </div>

      <div className="esp-grid">
        <label>
          Target
          <select value={selected} onChange={(event) => selectTarget(event.target.value)} disabled={running}>
            <option value="local">Create local build only</option>
            {profiles.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.type.toUpperCase()}</option>)}
          </select>
        </label>
        <label>
          Public URL
          <input value={publicUrl || selectedProfile?.publicUrl || ''} onChange={(event) => setPublicUrl(event.target.value)} placeholder="https://www.example.de" disabled={running} />
        </label>
        <label>
          Max. pages to crawl
          <input type="number" min={1} max={2000} value={maxPages} onChange={(event) => setMaxPages(Number(event.target.value) || 200)} disabled={running} />
        </label>
      </div>

      <div className="esp-actions">
        <button className="esp-primary" onClick={startExport} disabled={running}>{selected === 'local' ? 'Start export' : 'Export & publish'}</button>
        <button className="esp-secondary" onClick={() => setShowProfiles(!showProfiles)}>{showProfiles ? 'Close profiles' : 'Manage target profiles'}</button>
      </div>

      {progress && <div className={`esp-log ${progress.phase === 'error' ? 'is-error' : ''}`}>
        <strong>{progress.message}</strong>
        {progressActive && <div className={`esp-progress ${progressPercent === undefined ? 'is-indeterminate' : ''}`}>
          <div className="esp-progress-bar" style={progressPercent === undefined ? undefined : { width: `${progressPercent}%` }} />
        </div>}
        {progress.current !== undefined && progress.total !== undefined && <span className="esp-progress-count">{progress.current} / {progress.total}</span>}
        {progress.outputDir && <code>{progress.outputDir}</code>}
        {progress.pages !== undefined && <span>{progress.pages} pages · {progress.assets || 0} assets</span>}
        {progress.limitReached && <div className="esp-warning">Page limit reached. {progress.pendingPages} additional page{progress.pendingPages === 1 ? '' : 's'} were not exported. Increase the limit and run the export again.</div>}
        {progress.commitUrl && <a href={progress.commitUrl} target="_blank" rel="noreferrer">Open GitHub commit</a>}
      </div>}

      {showProfiles && <div className="esp-profiles">
        <div className="esp-profile-list">
          <h3>Saved target profiles</h3>
          {profiles.length === 0 && <p>No profiles configured yet.</p>}
          {profiles.map((item) => <button key={item.id} className={`esp-profile-row ${selected === item.id ? 'is-selected' : ''}`} onClick={() => selectTarget(item.id)}>
            <span>{item.name}</span><small>{item.destination}</small>
          </button>)}
          {selectedProfile && <div className="esp-profile-actions">
            <button className="esp-secondary" onClick={editProfile}>Edit selected profile</button>
            <button className="esp-danger" onClick={deleteProfile}>Delete selected profile</button>
          </div>}
        </div>

        <div className="esp-profile-form">
          <h3>{editingProfile ? 'Edit profile' : 'New profile'}</h3>
          <label>Name<input value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} placeholder="Production" /></label>
          <label>Type<select value={profile.type} onChange={(event) => setProfile({ ...profile, type: event.target.value as 'sftp' | 'github', sftp: event.target.value === 'sftp' ? (profile.sftp || emptyProfile.sftp) : undefined, github: event.target.value === 'github' ? (profile.github || { owner: '', repository: '', branch: 'main', pathPrefix: '', token: '' }) : undefined })}>
            <option value="sftp">SFTP</option><option value="github">GitHub</option>
          </select></label>
          <label>Public URL<input value={profile.publicUrl} onChange={(event) => setProfile({ ...profile, publicUrl: event.target.value })} placeholder="https://www.example.de" /></label>
          {profile.type === 'sftp' && profile.sftp && <>
            <label>Host<input value={profile.sftp.host} onChange={(event) => setProfile({ ...profile, sftp: { ...profile.sftp!, host: event.target.value } })} placeholder="sftp.example.de" /></label>
            <div className="esp-two"><label>Port<input type="number" value={profile.sftp.port} onChange={(event) => setProfile({ ...profile, sftp: { ...profile.sftp!, port: Number(event.target.value) || 22 } })} /></label><label>Username<input value={profile.sftp.username} onChange={(event) => setProfile({ ...profile, sftp: { ...profile.sftp!, username: event.target.value } })} /></label></div>
            <label>Authentication<select value={sftpAuthMethod} onChange={(event) => {
              const authMethod = event.target.value as SftpAuthMethod;
              setProfile({ ...profile, sftp: { ...profile.sftp!, authMethod, password: authMethod === 'password' ? profile.sftp?.password || '' : '', privateKey: authMethod === 'privateKey' ? profile.sftp?.privateKey || '' : '' } });
            }}>
              <option value="sshAgent">SSH agent (1Password)</option>
              <option value="sshConfig">SSH config / default key (~/.ssh)</option>
              <option value="password">Password</option>
              <option value="privateKey">Private key</option>
            </select></label>
            {sftpAuthMethod === 'password' && <label>Password<input type="password" value={profile.sftp.password || ''} onChange={(event) => setProfile({ ...profile, sftp: { ...profile.sftp!, password: event.target.value } })} /></label>}
            {sftpAuthMethod === 'privateKey' && <label>Private key<textarea rows={3} value={profile.sftp.privateKey || ''} onChange={(event) => setProfile({ ...profile, sftp: { ...profile.sftp!, privateKey: event.target.value } })} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" /></label>}
            {sftpAuthMethod === 'sshAgent' && <>
              <label>SSH agent socket (optional)<input value={profile.sftp.agentSocket || ''} onChange={(event) => setProfile({ ...profile, sftp: { ...profile.sftp!, agentSocket: event.target.value } })} placeholder="Uses SSH_AUTH_SOCK or 1Password automatically" /></label>
              <small className="esp-help">The key stays in 1Password and is requested through its SSH agent.</small>
            </>}
            {sftpAuthMethod === 'sshConfig' && <small className="esp-help">Reads ~/.ssh/config and common default keys from ~/.ssh. No key is copied into this profile.</small>}
            <label>Remote directory<input value={profile.sftp.remotePath} onChange={(event) => setProfile({ ...profile, sftp: { ...profile.sftp!, remotePath: event.target.value } })} placeholder="/www" /></label>
          </>}
          {profile.type === 'github' && profile.github && <>
            <div className="esp-two"><label>Owner<input value={profile.github.owner} onChange={(event) => setProfile({ ...profile, github: { ...profile.github!, owner: event.target.value } })} /></label><label>Repository<input value={profile.github.repository} onChange={(event) => setProfile({ ...profile, github: { ...profile.github!, repository: event.target.value } })} /></label></div>
            <div className="esp-two"><label>Branch<input value={profile.github.branch} onChange={(event) => setProfile({ ...profile, github: { ...profile.github!, branch: event.target.value } })} /></label><label>Path prefix<input value={profile.github.pathPrefix || ''} onChange={(event) => setProfile({ ...profile, github: { ...profile.github!, pathPrefix: event.target.value } })} placeholder="public" /></label></div>
            <label>Fine-grained Token<input type="password" value={profile.github.token || ''} onChange={(event) => setProfile({ ...profile, github: { ...profile.github!, token: event.target.value } })} /></label>
          </>}
          <div className="esp-actions">
            <button className="esp-primary" onClick={saveProfile} disabled={!profile.name || testing}>{editingProfile ? 'Update profile' : 'Save profile'}</button>
            <button className="esp-secondary" onClick={testConnection} disabled={testing || running}>Test connection</button>
            {editingProfile && <button className="esp-secondary" onClick={() => setProfile(emptyProfile)} disabled={testing}>Cancel edit</button>}
          </div>
        </div>
      </div>}
    </section>
  );
}
