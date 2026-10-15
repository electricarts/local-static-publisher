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
exports.requestBuffer = requestBuffer;
exports.contentType = contentType;
const http = __importStar(require("http"));
const https = __importStar(require("https"));
const url_1 = require("url");
const MAX_REDIRECTS = 8;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
function isLocalHostname(hostname) {
    return hostname === 'localhost'
        || hostname === '127.0.0.1'
        || hostname === '::1'
        || hostname.endsWith('.local')
        || hostname.endsWith('.test');
}
function requestBuffer(urlString, headers = {}, redirectCount = 0) {
    if (redirectCount > MAX_REDIRECTS) {
        return Promise.reject(new Error(`Too many redirects while fetching ${urlString}`));
    }
    const url = new url_1.URL(urlString);
    const transport = url.protocol === 'https:' ? https : http;
    const isLocal = isLocalHostname(url.hostname);
    return new Promise((resolve, reject) => {
        const request = transport.request(url, {
            method: 'GET',
            headers: {
                'User-Agent': 'WordPress-Static-Publisher/0.2 prototype',
                Accept: '*/*',
                ...headers,
            },
            rejectUnauthorized: !isLocal,
            timeout: 30000,
        }, (response) => {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
            response.on('end', async () => {
                const statusCode = response.statusCode || 0;
                const locationHeader = response.headers.location;
                const location = Array.isArray(locationHeader) ? locationHeader[0] : locationHeader;
                if (location && REDIRECT_STATUSES.has(statusCode)) {
                    try {
                        const nextUrl = new url_1.URL(location, urlString).toString();
                        resolve(await requestBuffer(nextUrl, headers, redirectCount + 1));
                    }
                    catch (error) {
                        reject(error);
                    }
                    return;
                }
                resolve({
                    statusCode,
                    headers: response.headers,
                    body: Buffer.concat(chunks),
                    url: urlString,
                });
            });
        });
        request.on('timeout', () => request.destroy(new Error(`Request timed out: ${urlString}`)));
        request.on('error', reject);
        request.end();
    });
}
function contentType(response) {
    return String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
}
//# sourceMappingURL=http.js.map