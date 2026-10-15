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
exports.default = ExportPanel;
const react_1 = __importStar(require("react"));
const electron_1 = require("electron");
const emptyProfile = {
    id: '',
    name: '',
    type: 'sftp',
    publicUrl: '',
    sftp: { host: '', port: 22, username: '', authMethod: 'sshAgent', password: '', privateKey: '', agentSocket: '', remotePath: '/' },
};
function makeId(name) {
    return `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'target'}-${Date.now()}`;
}
function ExportPanel({ site }) {
    var _a, _b, _c;
    const [profiles, setProfiles] = (0, react_1.useState)([]);
    const [selected, setSelected] = (0, react_1.useState)('local');
    const [publicUrl, setPublicUrl] = (0, react_1.useState)('');
    const [maxPages, setMaxPages] = (0, react_1.useState)(200);
    const [running, setRunning] = (0, react_1.useState)(false);
    const [testing, setTesting] = (0, react_1.useState)(false);
    const [progress, setProgress] = (0, react_1.useState)(null);
    const [showProfiles, setShowProfiles] = (0, react_1.useState)(false);
    const [profile, setProfile] = (0, react_1.useState)(emptyProfile);
    const selectedProfile = (0, react_1.useMemo)(() => profiles.find((item) => item.id === selected), [profiles, selected]);
    const editingProfile = Boolean(profile.id);
    const sftpAuthMethod = ((_a = profile.sftp) === null || _a === void 0 ? void 0 : _a.authMethod)
        || (((_b = profile.sftp) === null || _b === void 0 ? void 0 : _b.password) ? 'password' : ((_c = profile.sftp) === null || _c === void 0 ? void 0 : _c.privateKey) ? 'privateKey' : 'sshAgent');
    const progressActive = Boolean(progress && ['starting', 'crawling', 'writing', 'uploading'].includes(progress.phase));
    const progressPercent = (progress === null || progress === void 0 ? void 0 : progress.current) !== undefined && progress.total
        ? Math.max(0, Math.min(100, Math.round((progress.current / progress.total) * 100)))
        : undefined;
    const refreshProfiles = async () => {
        try {
            const items = await electron_1.ipcRenderer.invoke('local-static-publisher-list-profiles');
            setProfiles(items || []);
        }
        catch (error) {
            setProgress({ phase: 'error', message: `Profiles could not be loaded: ${error.message}` });
        }
    };
    (0, react_1.useEffect)(() => {
        refreshProfiles();
        const handler = (_event, next) => {
            setProgress(next);
            if (next.phase === 'starting' || next.phase === 'crawling' || next.phase === 'writing' || next.phase === 'uploading')
                setRunning(true);
            if (next.phase === 'complete' || next.phase === 'cancelled' || next.phase === 'error')
                setRunning(false);
        };
        electron_1.ipcRenderer.on('local-static-publisher-progress', handler);
        return () => {
            electron_1.ipcRenderer.removeListener('local-static-publisher-progress', handler);
        };
    }, []);
    const startExport = () => {
        setRunning(true);
        setProgress({ phase: 'starting', message: 'Starting export.' });
        electron_1.ipcRenderer.send('local-static-publisher-export', site, selected, { publicUrl: publicUrl || (selectedProfile === null || selectedProfile === void 0 ? void 0 : selectedProfile.publicUrl) || '', maxPages, includeSitemap: true });
    };
    const loadProfile = async (profileId) => {
        try {
            const existing = await electron_1.ipcRenderer.invoke('local-static-publisher-get-profile', profileId);
            if (!existing)
                throw new Error('The selected target profile could not be found.');
            setProfile(existing);
            setProgress({ phase: 'complete', message: `Profile “${existing.name}” loaded.` });
        }
        catch (error) {
            setProgress({ phase: 'error', message: `Profile could not be loaded: ${error.message}` });
        }
    };
    const selectTarget = (targetId) => {
        setSelected(targetId);
        if (targetId === 'local')
            setProfile(emptyProfile);
        else
            void loadProfile(targetId);
    };
    const saveProfile = async () => {
        const next = { ...profile, id: profile.id || makeId(profile.name) };
        const wasEditing = Boolean(profile.id);
        try {
            const items = await electron_1.ipcRenderer.invoke('local-static-publisher-save-profile', next);
            setProfiles(items || []);
            setSelected(next.id);
            setProfile(wasEditing ? next : emptyProfile);
            setProgress({ phase: 'complete', message: `Profile “${next.name}” ${wasEditing ? 'updated' : 'saved'}.` });
        }
        catch (error) {
            setProgress({ phase: 'error', message: `Profile could not be saved: ${error.message}` });
        }
    };
    const testConnection = async () => {
        const candidate = { ...profile, id: profile.id || 'connection-test', name: profile.name || 'Connection test' };
        setTesting(true);
        setProgress({ phase: 'starting', message: 'Testing connection …' });
        try {
            const message = await electron_1.ipcRenderer.invoke('local-static-publisher-test-profile', candidate);
            setProgress({ phase: 'complete', message });
        }
        catch (error) {
            setProgress({ phase: 'error', message: `Connection test failed: ${error.message}` });
        }
        finally {
            setTesting(false);
        }
    };
    const editProfile = async () => {
        if (!selectedProfile)
            return;
        await loadProfile(selectedProfile.id);
    };
    const deleteProfile = async () => {
        if (!selectedProfile)
            return;
        const items = await electron_1.ipcRenderer.invoke('local-static-publisher-delete-profile', selectedProfile.id);
        setProfiles(items || []);
        setSelected('local');
        setProfile(emptyProfile);
    };
    return (react_1.default.createElement("section", { className: "esp-panel" },
        react_1.default.createElement("div", { className: "esp-header" },
            react_1.default.createElement("div", null,
                react_1.default.createElement("h2", null, "Static Publisher"),
                react_1.default.createElement("p", null,
                    "Export and publish a static website from Local \u00B7 ",
                    site.name || site.domain || site.id)),
            react_1.default.createElement("span", { className: `esp-status ${running || testing ? 'is-running' : ''}` }, running ? 'Running …' : testing ? 'Testing …' : 'Ready')),
        react_1.default.createElement("div", { className: "esp-grid" },
            react_1.default.createElement("label", null,
                "Target",
                react_1.default.createElement("select", { value: selected, onChange: (event) => selectTarget(event.target.value), disabled: running },
                    react_1.default.createElement("option", { value: "local" }, "Create local build only"),
                    profiles.map((item) => react_1.default.createElement("option", { key: item.id, value: item.id },
                        item.name,
                        " \u00B7 ",
                        item.type.toUpperCase())))),
            react_1.default.createElement("label", null,
                "Public URL",
                react_1.default.createElement("input", { value: publicUrl || (selectedProfile === null || selectedProfile === void 0 ? void 0 : selectedProfile.publicUrl) || '', onChange: (event) => setPublicUrl(event.target.value), placeholder: "https://www.example.de", disabled: running })),
            react_1.default.createElement("label", null,
                "Max. pages to crawl",
                react_1.default.createElement("input", { type: "number", min: 1, max: 2000, value: maxPages, onChange: (event) => setMaxPages(Number(event.target.value) || 200), disabled: running }))),
        react_1.default.createElement("div", { className: "esp-actions" },
            react_1.default.createElement("button", { className: "esp-primary", onClick: startExport, disabled: running }, selected === 'local' ? 'Start export' : 'Export & publish'),
            react_1.default.createElement("button", { className: "esp-secondary", onClick: () => setShowProfiles(!showProfiles) }, showProfiles ? 'Close profiles' : 'Manage target profiles')),
        progress && react_1.default.createElement("div", { className: `esp-log ${progress.phase === 'error' ? 'is-error' : ''}` },
            react_1.default.createElement("strong", null, progress.message),
            progressActive && react_1.default.createElement("div", { className: `esp-progress ${progressPercent === undefined ? 'is-indeterminate' : ''}` },
                react_1.default.createElement("div", { className: "esp-progress-bar", style: progressPercent === undefined ? undefined : { width: `${progressPercent}%` } })),
            progress.current !== undefined && progress.total !== undefined && react_1.default.createElement("span", { className: "esp-progress-count" },
                progress.current,
                " / ",
                progress.total),
            progress.outputDir && react_1.default.createElement("code", null, progress.outputDir),
            progress.pages !== undefined && react_1.default.createElement("span", null,
                progress.pages,
                " pages \u00B7 ",
                progress.assets || 0,
                " assets"),
            progress.limitReached && react_1.default.createElement("div", { className: "esp-warning" },
                "Page limit reached. ",
                progress.pendingPages,
                " additional page",
                progress.pendingPages === 1 ? '' : 's',
                " were not exported. Increase the limit and run the export again."),
            progress.commitUrl && react_1.default.createElement("a", { href: progress.commitUrl, target: "_blank", rel: "noreferrer" }, "Open GitHub commit")),
        showProfiles && react_1.default.createElement("div", { className: "esp-profiles" },
            react_1.default.createElement("div", { className: "esp-profile-list" },
                react_1.default.createElement("h3", null, "Saved target profiles"),
                profiles.length === 0 && react_1.default.createElement("p", null, "No profiles configured yet."),
                profiles.map((item) => react_1.default.createElement("button", { key: item.id, className: `esp-profile-row ${selected === item.id ? 'is-selected' : ''}`, onClick: () => selectTarget(item.id) },
                    react_1.default.createElement("span", null, item.name),
                    react_1.default.createElement("small", null, item.destination))),
                selectedProfile && react_1.default.createElement("div", { className: "esp-profile-actions" },
                    react_1.default.createElement("button", { className: "esp-secondary", onClick: editProfile }, "Edit selected profile"),
                    react_1.default.createElement("button", { className: "esp-danger", onClick: deleteProfile }, "Delete selected profile"))),
            react_1.default.createElement("div", { className: "esp-profile-form" },
                react_1.default.createElement("h3", null, editingProfile ? 'Edit profile' : 'New profile'),
                react_1.default.createElement("label", null,
                    "Name",
                    react_1.default.createElement("input", { value: profile.name, onChange: (event) => setProfile({ ...profile, name: event.target.value }), placeholder: "Production" })),
                react_1.default.createElement("label", null,
                    "Type",
                    react_1.default.createElement("select", { value: profile.type, onChange: (event) => setProfile({ ...profile, type: event.target.value, sftp: event.target.value === 'sftp' ? (profile.sftp || emptyProfile.sftp) : undefined, github: event.target.value === 'github' ? (profile.github || { owner: '', repository: '', branch: 'main', pathPrefix: '', token: '' }) : undefined }) },
                        react_1.default.createElement("option", { value: "sftp" }, "SFTP"),
                        react_1.default.createElement("option", { value: "github" }, "GitHub"))),
                react_1.default.createElement("label", null,
                    "Public URL",
                    react_1.default.createElement("input", { value: profile.publicUrl, onChange: (event) => setProfile({ ...profile, publicUrl: event.target.value }), placeholder: "https://www.example.de" })),
                profile.type === 'sftp' && profile.sftp && react_1.default.createElement(react_1.default.Fragment, null,
                    react_1.default.createElement("label", null,
                        "Host",
                        react_1.default.createElement("input", { value: profile.sftp.host, onChange: (event) => setProfile({ ...profile, sftp: { ...profile.sftp, host: event.target.value } }), placeholder: "sftp.example.de" })),
                    react_1.default.createElement("div", { className: "esp-two" },
                        react_1.default.createElement("label", null,
                            "Port",
                            react_1.default.createElement("input", { type: "number", value: profile.sftp.port, onChange: (event) => setProfile({ ...profile, sftp: { ...profile.sftp, port: Number(event.target.value) || 22 } }) })),
                        react_1.default.createElement("label", null,
                            "Username",
                            react_1.default.createElement("input", { value: profile.sftp.username, onChange: (event) => setProfile({ ...profile, sftp: { ...profile.sftp, username: event.target.value } }) }))),
                    react_1.default.createElement("label", null,
                        "Authentication",
                        react_1.default.createElement("select", { value: sftpAuthMethod, onChange: (event) => {
                                var _a, _b;
                                const authMethod = event.target.value;
                                setProfile({ ...profile, sftp: { ...profile.sftp, authMethod, password: authMethod === 'password' ? ((_a = profile.sftp) === null || _a === void 0 ? void 0 : _a.password) || '' : '', privateKey: authMethod === 'privateKey' ? ((_b = profile.sftp) === null || _b === void 0 ? void 0 : _b.privateKey) || '' : '' } });
                            } },
                            react_1.default.createElement("option", { value: "sshAgent" }, "SSH agent (1Password)"),
                            react_1.default.createElement("option", { value: "sshConfig" }, "SSH config / default key (~/.ssh)"),
                            react_1.default.createElement("option", { value: "password" }, "Password"),
                            react_1.default.createElement("option", { value: "privateKey" }, "Private key"))),
                    sftpAuthMethod === 'password' && react_1.default.createElement("label", null,
                        "Password",
                        react_1.default.createElement("input", { type: "password", value: profile.sftp.password || '', onChange: (event) => setProfile({ ...profile, sftp: { ...profile.sftp, password: event.target.value } }) })),
                    sftpAuthMethod === 'privateKey' && react_1.default.createElement("label", null,
                        "Private key",
                        react_1.default.createElement("textarea", { rows: 3, value: profile.sftp.privateKey || '', onChange: (event) => setProfile({ ...profile, sftp: { ...profile.sftp, privateKey: event.target.value } }), placeholder: "-----BEGIN OPENSSH PRIVATE KEY-----" })),
                    sftpAuthMethod === 'sshAgent' && react_1.default.createElement(react_1.default.Fragment, null,
                        react_1.default.createElement("label", null,
                            "SSH agent socket (optional)",
                            react_1.default.createElement("input", { value: profile.sftp.agentSocket || '', onChange: (event) => setProfile({ ...profile, sftp: { ...profile.sftp, agentSocket: event.target.value } }), placeholder: "Uses SSH_AUTH_SOCK or 1Password automatically" })),
                        react_1.default.createElement("small", { className: "esp-help" }, "The key stays in 1Password and is requested through its SSH agent.")),
                    sftpAuthMethod === 'sshConfig' && react_1.default.createElement("small", { className: "esp-help" }, "Reads ~/.ssh/config and common default keys from ~/.ssh. No key is copied into this profile."),
                    react_1.default.createElement("label", null,
                        "Remote directory",
                        react_1.default.createElement("input", { value: profile.sftp.remotePath, onChange: (event) => setProfile({ ...profile, sftp: { ...profile.sftp, remotePath: event.target.value } }), placeholder: "/www" }))),
                profile.type === 'github' && profile.github && react_1.default.createElement(react_1.default.Fragment, null,
                    react_1.default.createElement("div", { className: "esp-two" },
                        react_1.default.createElement("label", null,
                            "Owner",
                            react_1.default.createElement("input", { value: profile.github.owner, onChange: (event) => setProfile({ ...profile, github: { ...profile.github, owner: event.target.value } }) })),
                        react_1.default.createElement("label", null,
                            "Repository",
                            react_1.default.createElement("input", { value: profile.github.repository, onChange: (event) => setProfile({ ...profile, github: { ...profile.github, repository: event.target.value } }) }))),
                    react_1.default.createElement("div", { className: "esp-two" },
                        react_1.default.createElement("label", null,
                            "Branch",
                            react_1.default.createElement("input", { value: profile.github.branch, onChange: (event) => setProfile({ ...profile, github: { ...profile.github, branch: event.target.value } }) })),
                        react_1.default.createElement("label", null,
                            "Path prefix",
                            react_1.default.createElement("input", { value: profile.github.pathPrefix || '', onChange: (event) => setProfile({ ...profile, github: { ...profile.github, pathPrefix: event.target.value } }), placeholder: "public" }))),
                    react_1.default.createElement("label", null,
                        "Fine-grained Token",
                        react_1.default.createElement("input", { type: "password", value: profile.github.token || '', onChange: (event) => setProfile({ ...profile, github: { ...profile.github, token: event.target.value } }) }))),
                react_1.default.createElement("div", { className: "esp-actions" },
                    react_1.default.createElement("button", { className: "esp-primary", onClick: saveProfile, disabled: !profile.name || testing }, editingProfile ? 'Update profile' : 'Save profile'),
                    react_1.default.createElement("button", { className: "esp-secondary", onClick: testConnection, disabled: testing || running }, "Test connection"),
                    editingProfile && react_1.default.createElement("button", { className: "esp-secondary", onClick: () => setProfile(emptyProfile), disabled: testing }, "Cancel edit"))))));
}
//# sourceMappingURL=ExportPanel.js.map