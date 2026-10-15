import * as path from 'path';
import * as os from 'os';
import { exportSite } from './exporter';
import { ProfileStore } from './profile-store';
import { ExportOptions, LocalSite, TargetProfile } from './types';
import { publishTarget, testTargetConnection } from './transports';

export default function init(context: any): void {
  const { electron, environment } = context;
  const userDataPath = environment.userDataPath || os.homedir();
  const baseDir = path.join(userDataPath, 'local-static-publisher');
  const store = new ProfileStore(
    path.join(baseDir, 'profiles.json'),
    [
      path.join(userDataPath, 'wordpress-static-publisher', 'profiles.json'),
      path.join(userDataPath, 'etch-static-publisher', 'profiles.json'),
    ],
  );
  const ipcMain = electron.ipcMain;

  ipcMain.handle('local-static-publisher-list-profiles', () => store.listPublic());
  ipcMain.handle('local-static-publisher-get-profile', (_event: unknown, id: string) => store.get(id));
  ipcMain.handle('local-static-publisher-save-profile', (_event: unknown, profile: TargetProfile) => store.save(profile));
  ipcMain.handle('local-static-publisher-delete-profile', (_event: unknown, id: string) => store.remove(id));
  ipcMain.handle('local-static-publisher-test-profile', (_event: unknown, profile: TargetProfile) => testTargetConnection(profile));

  ipcMain.on('local-static-publisher-export', async (event: any, site: LocalSite, profileId: string, options: ExportOptions) => {
    const jobId = `${site.id}-${Date.now()}`;
    const send = (payload: any) => event.sender.send('local-static-publisher-progress', { jobId, ...payload });
    try {
      const profile = profileId && profileId !== 'local'
        ? await store.get(profileId)
        : undefined;
      if (profileId && profileId !== 'local' && !profile) throw new Error('The selected target profile could not be found.');

      const siteSlug = String(site.name || site.id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || site.id;
      let outputDir: string;
      if (profileId === 'local') {
        send({ phase: 'starting', message: 'Choose an export folder …' });
        if (!electron.dialog?.showOpenDialog) {
          throw new Error('The folder dialog is not available in this version of Local.');
        }
        const selection = await electron.dialog.showOpenDialog({
          title: 'Choose a location for the local build',
          buttonLabel: 'Use this location',
          properties: ['openDirectory', 'createDirectory'],
        });
        if (selection.canceled || !selection.filePaths[0]) {
          send({ phase: 'cancelled', message: 'Local export cancelled.' });
          return;
        }
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        outputDir = path.join(selection.filePaths[0], `${siteSlug}-${timestamp}`);
      } else {
        outputDir = path.join(baseDir, 'exports', siteSlug, new Date().toISOString().replace(/[:.]/g, '-'));
      }
      const result = await exportSite(site, outputDir, {
        ...options,
        publicUrl: options.publicUrl || profile?.publicUrl,
        localBuild: profileId === 'local',
      }, (progress) => send(progress));

      let commitUrl: string | undefined;
      if (profile) {
        send({ phase: 'uploading', message: `Publishing ${profile.name}.` });
        commitUrl = await publishTarget(
          profile,
          result.outputDir,
          (message, current, total) => send({ phase: 'uploading', message, current, total }),
        );
      }
      send({ phase: 'complete', message: profile ? 'Export and publication complete.' : 'Export complete.', outputDir: result.outputDir, pages: result.pages, assets: result.assets, limitReached: result.limitReached, pendingPages: result.pendingPages, commitUrl });
    } catch (error) {
      send({ phase: 'error', message: (error as Error).message || String(error) });
    }
  });
}
