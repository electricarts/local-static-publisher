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
exports.ProfileStore = void 0;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
class ProfileStore {
    constructor(filePath, legacyFilePaths = []) {
        this.filePath = filePath;
        this.legacyFilePaths = legacyFilePaths;
    }
    async read() {
        const paths = [this.filePath, ...this.legacyFilePaths];
        for (const candidate of paths) {
            try {
                return JSON.parse(await fs.readFile(candidate, 'utf8'));
            }
            catch {
                // Try the next legacy location before treating this as a new installation.
            }
        }
        return [];
    }
    async write(profiles) {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        await fs.writeFile(this.filePath, JSON.stringify(profiles, null, 2), { mode: 0o600 });
        try {
            await fs.chmod(this.filePath, 0o600);
        }
        catch { /* best effort on Windows */ }
    }
    async listPublic() {
        const profiles = await this.read();
        return profiles.map((profile) => {
            var _a, _b, _c, _d, _e, _f, _g, _h;
            return ({
                id: profile.id,
                name: profile.name,
                type: profile.type,
                publicUrl: profile.publicUrl,
                hasSecret: Boolean(((_a = profile.sftp) === null || _a === void 0 ? void 0 : _a.password) || ((_b = profile.sftp) === null || _b === void 0 ? void 0 : _b.privateKey) || ((_c = profile.github) === null || _c === void 0 ? void 0 : _c.token)),
                destination: profile.type === 'sftp'
                    ? `${((_d = profile.sftp) === null || _d === void 0 ? void 0 : _d.host) || ''}${((_e = profile.sftp) === null || _e === void 0 ? void 0 : _e.remotePath) ? `:${profile.sftp.remotePath}` : ''}`
                    : `${((_f = profile.github) === null || _f === void 0 ? void 0 : _f.owner) || ''}/${((_g = profile.github) === null || _g === void 0 ? void 0 : _g.repository) || ''}:${((_h = profile.github) === null || _h === void 0 ? void 0 : _h.branch) || ''}`,
            });
        });
    }
    async get(id) {
        return (await this.read()).find((profile) => profile.id === id);
    }
    async save(input) {
        var _a;
        const profiles = await this.read();
        const previous = profiles.find((profile) => profile.id === input.id);
        const merged = JSON.parse(JSON.stringify(input));
        if (previous && !((_a = merged.sftp) === null || _a === void 0 ? void 0 : _a.authMethod)) {
            if (merged.sftp && !merged.sftp.password && !merged.sftp.privateKey && previous.sftp) {
                merged.sftp.password = previous.sftp.password;
                merged.sftp.privateKey = previous.sftp.privateKey;
            }
            if (merged.github && !merged.github.token && previous.github)
                merged.github.token = previous.github.token;
        }
        const next = profiles.filter((profile) => profile.id !== merged.id);
        next.push(merged);
        await this.write(next);
        return this.listPublic();
    }
    async remove(id) {
        await this.write((await this.read()).filter((profile) => profile.id !== id));
        return this.listPublic();
    }
}
exports.ProfileStore = ProfileStore;
//# sourceMappingURL=profile-store.js.map