import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

export interface HttpResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  url: string;
}

const MAX_REDIRECTS = 8;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function isLocalHostname(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname.endsWith('.local')
    || hostname.endsWith('.test');
}

export function requestBuffer(
  urlString: string,
  headers: Record<string, string> = {},
  redirectCount = 0,
): Promise<HttpResponse> {
  if (redirectCount > MAX_REDIRECTS) {
    return Promise.reject(new Error(`Too many redirects while fetching ${urlString}`));
  }

  const url = new URL(urlString);
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
      timeout: 30_000,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on('end', async () => {
        const statusCode = response.statusCode || 0;
        const locationHeader = response.headers.location;
        const location = Array.isArray(locationHeader) ? locationHeader[0] : locationHeader;

        if (location && REDIRECT_STATUSES.has(statusCode)) {
          try {
            const nextUrl = new URL(location, urlString).toString();
            resolve(await requestBuffer(nextUrl, headers, redirectCount + 1));
          } catch (error) {
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

export function contentType(response: HttpResponse): string {
  return String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
}
