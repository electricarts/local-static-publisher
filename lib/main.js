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
exports.default = init;
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const exporter_1 = require("./exporter");
const profile_store_1 = require("./profile-store");
const transports_1 = require("./transports");
function init(context) {
    const { electron, environment } = context;
    const userDataPath = environment.userDataPath || os.homedir();
    const baseDir = path.join(userDataPath, 'local-static-publisher');
    const store = new profile_store_1.ProfileStore(path.join(baseDir, 'profiles.json'), [
        path.join(userDataPath, 'wordpress-static-publisher', 'profiles.json'),
        path.join(userDataPath, 'etch-static-publisher', 'profiles.json'),
    ]);
    const ipcMain = electron.ipcMain;
    ipcMain.handle('local-static-publisher-list-profiles', () => store.listPublic());
    ipcMain.handle('local-static-publisher-get-profile', (_event, id) => store.get(id));
    ipcMain.handle('local-static-publisher-save-profile', (_event, profile) => store.save(profile));
    ipcMain.handle('local-static-publisher-delete-profile', (_event, id) => store.remove(id));
    ipcMain.handle('local-static-publisher-test-profile', (_event, profile) => (0, transports_1.testTargetConnection)(profile));
    ipcMain.on('local-static-publisher-export', async (event, site, profileId, options) => {
        var _a;
        const jobId = `${site.id}-${Date.now()}`;
        const send = (payload) => event.sender.send('local-static-publisher-progress', { jobId, ...payload });
        try {
            const profile = profileId && profileId !== 'local'
                ? await store.get(profileId)
                : undefined;
            if (profileId && profileId !== 'local' && !profile)
                throw new Error('The selected target profile could not be found.');
            const siteSlug = String(site.name || site.id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || site.id;
            let outputDir;
            if (profileId === 'local') {
                send({ phase: 'starting', message: 'Choose an export folder …' });
                if (!((_a = electron.dialog) === null || _a === void 0 ? void 0 : _a.showOpenDialog)) {
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
            }
            else {
                outputDir = path.join(baseDir, 'exports', siteSlug, new Date().toISOString().replace(/[:.]/g, '-'));
            }
            const result = await (0, exporter_1.exportSite)(site, outputDir, {
                ...options,
                publicUrl: options.publicUrl || (profile === null || profile === void 0 ? void 0 : profile.publicUrl),
                localBuild: profileId === 'local',
            }, (progress) => send(progress));
            let commitUrl;
            if (profile) {
                send({ phase: 'uploading', message: `Publishing ${profile.name}.` });
                commitUrl = await (0, transports_1.publishTarget)(profile, result.outputDir, (message, current, total) => send({ phase: 'uploading', message, current, total }));
            }
            send({ phase: 'complete', message: profile ? 'Export and publication complete.' : 'Export complete.', outputDir: result.outputDir, pages: result.pages, assets: result.assets, limitReached: result.limitReached, pendingPages: result.pendingPages, commitUrl });
        }
        catch (error) {
            send({ phase: 'error', message: error.message || String(error) });
        }
    });
}
//# sourceMappingURL=main.js.map