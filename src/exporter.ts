import * as fs from 'fs/promises';
import * as path from 'path';
import { URL } from 'url';
import * as cheerio from 'cheerio';
import { contentType, requestBuffer } from './http';
import { ExportOptions, ExportProgress, ExportResult, LocalSite } from './types';

type ProgressCallback = (progress: ExportProgress) => void;

interface CrawlState {
  sourceOrigin: string;
  publicOrigin: string;
  pages: Map<string, Buffer>;
  assets: Map<string, Buffer>;
  warnings: string[];
  queuedPages: Set<string>;
  queuedAssets: Set<string>;
}

function normalizeUrl(value: string, base: string): string | null {
  try {
    const url = new URL(value, base);
    url.hash = '';
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function isSameOrigin(urlString: string, origin: string): boolean {
  try {
    const url = new URL(urlString);
    const base = new URL(origin);
    if (url.origin === base.origin) return true;

    // Local by Flywheel commonly redirects .test sites from HTTP to HTTPS.
    // Treat both schemes as the same local site, while keeping strict origin
    // checks for public URLs.
    const isLocal = (hostname: string) => hostname === 'localhost'
      || hostname === '127.0.0.1'
      || hostname === '::1'
      || hostname.endsWith('.local')
      || hostname.endsWith('.test');
    return isLocal(url.hostname)
      && isLocal(base.hostname)
      && url.hostname === base.hostname
      && url.port === base.port;
  } catch {
    return false;
  }
}

function isLikelyPage(urlString: string): boolean {
  const pathname = new URL(urlString).pathname.toLowerCase();
  if (pathname === '/' || pathname.endsWith('/')) return true;
  return !/\.(?:css|js|mjs|json|xml|txt|map|jpe?g|png|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|pdf|zip|mp4|webm|mov|mp3|wav|docx?|xlsx?)$/i.test(pathname);
}

function isAssetPath(urlString: string): boolean {
  const pathname = new URL(urlString).pathname.toLowerCase();
  return /\.(?:css|js|mjs|json|xml|txt|map|webmanifest|jpe?g|png|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|pdf|mp4|webm|mov|mp3|wav|docx?|xlsx?)$/i.test(pathname);
}

function isStaticPagePath(urlString: string): boolean {
  const pathname = new URL(urlString).pathname.toLowerCase();
  if (pathname.startsWith('/wp-admin') || pathname.startsWith('/wp-login') || pathname.startsWith('/wp-json')) return false;
  return isLikelyPage(urlString);
}

function sourceUrlForSite(site: LocalSite, override?: string): string {
  if (override) return override.replace(/\/$/, '');
  if (site.domain) return `http://${site.domain}`;
  if (site.ports?.HTTP) return `http://127.0.0.1:${site.ports.HTTP}`;
  throw new Error('The Local site has no reachable domain or HTTP port.');
}

function outputPathForUrl(urlString: string, flatPages = false): string {
  const pathname = decodeURIComponent(new URL(urlString).pathname);
  const clean = pathname.replace(/^\/+/, '');
  if (!clean) return 'index.html';
  if (isAssetPath(urlString)) return clean;
  if (flatPages) return `${clean.replace(/\/+$/, '').replace(/\//g, '--')}.html`;
  if (pathname.endsWith('/')) return path.posix.join(clean, 'index.html');
  return path.posix.join(clean, 'index.html');
}

function safeOutputPath(root: string, relativePath: string): string {
  const normalized = path.normalize(relativePath.replace(/^[/\\]+/, ''));
  const target = path.resolve(root, normalized);
  const rootWithSeparator = path.resolve(root) + path.sep;
  if (target !== path.resolve(root) && !target.startsWith(rootWithSeparator)) {
    throw new Error(`Unsafe export path: ${relativePath}`);
  }
  return target;
}

function replaceOrigin(value: string, sourceOrigin: string, publicOrigin: string): string {
  let result = value;
  const origins = [sourceOrigin];
  try {
    const source = new URL(sourceOrigin);
    if (source.hostname === 'localhost'
      || source.hostname === '127.0.0.1'
      || source.hostname === '::1'
      || source.hostname.endsWith('.local')
      || source.hostname.endsWith('.test')) {
      const alternate = new URL(sourceOrigin);
      alternate.protocol = alternate.protocol === 'https:' ? 'http:' : 'https:';
      origins.push(alternate.origin);
    }
  } catch {
    // Keep the original value when an attribute is not a valid URL.
  }
  for (const origin of origins) {
    result = result.split(origin).join(publicOrigin);
    // Inline WordPress/Elementor configuration often JSON-escapes slashes.
    result = result.split(origin.replace(/\//g, '\\/')).join(publicOrigin);
  }
  return result;
}

function isInternalOrigin(urlString: string, sourceOrigin: string, publicOrigin: string): boolean {
  return isSameOrigin(urlString, sourceOrigin) || isSameOrigin(urlString, publicOrigin);
}

function relativeOutputUrl(
  value: string,
  pageUrl: string,
  currentOutputPath: string,
  sourceOrigin: string,
  publicOrigin: string,
  flatPages: boolean,
  predicate: (urlString: string) => boolean,
): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('?')) return null;
  try {
    const url = new URL(trimmed, pageUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const normalized = url.toString();
    if (!isInternalOrigin(normalized, sourceOrigin, publicOrigin) || !predicate(normalized)) return null;
    const targetPath = outputPathForUrl(normalized, flatPages);
    const currentDirectory = path.posix.dirname(currentOutputPath);
    const relativePath = path.posix.relative(currentDirectory, targetPath) || path.posix.basename(targetPath);
    return `${relativePath}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function relativeDirectoryUrl(
  value: string,
  pageUrl: string,
  currentOutputPath: string,
  sourceOrigin: string,
  publicOrigin: string,
): string | null {
  try {
    const url = new URL(value, pageUrl);
    if (!isInternalOrigin(url.toString(), sourceOrigin, publicOrigin)) return null;
    if (isAssetPath(url.toString())) return null;
    const pathname = decodeURIComponent(url.pathname);
    const clean = pathname.replace(/^\/+/, '');
    if (!clean || !/(?:^|\/)wp-(?:content|includes)(?:\/|$)/i.test(pathname)) return null;
    const targetPath = `${clean.replace(/\/+$/, '')}/`;
    const currentDirectory = path.posix.dirname(currentOutputPath);
    const relativePath = path.posix.relative(currentDirectory, targetPath) || path.posix.basename(targetPath);
    return `${relativePath.replace(/\/+$/, '')}/${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function embeddedUrlCandidates(value: string, baseUrl: string): string[] {
  const urls = new Set<string>();
  // Also handles JSON/JavaScript escaped URLs such as https:\/\/example.test\/wp-content\/...
  const pattern = /(?:https?:\\?\/\\?\/|\/\/)[^"' \t\r\n<>),};\]]+/gi;
  for (const match of value.matchAll(pattern)) {
    const candidate = match[0].replace(/\\\//g, '/');
    const normalized = normalizeUrl(candidate, baseUrl);
    if (normalized) urls.add(normalized);
  }
  return [...urls];
}

function extractJavascriptAssetUrls(value: string, baseUrl: string): string[] {
  const urls = new Set<string>(embeddedUrlCandidates(value, baseUrl));
  const relativePattern = /[`'"]((?:\.{0,2}\/|\/)?[A-Za-z0-9_./-]+\.(?:m?js|css|json|webmanifest)(?:\?[^`'"]*)?)[`'"]/gi;
  for (const match of value.matchAll(relativePattern)) {
    const normalized = match[1].replace(/\\\//g, '/');
    const resolved = normalizeUrl(normalized, baseUrl);
    if (resolved) urls.add(resolved);
  }

  const chunkPattern = /__elementorLoadChunk\s*\(\s*[`'"]([^`'"]+)[`'"]\s*\)/g;
  if (/\/wp-content\/plugins\/elementor\/assets\/js\//i.test(new URL(baseUrl).pathname)) {
    const chunkBase = new URL('./chunks/', baseUrl);
    for (const match of value.matchAll(chunkPattern)) {
      const name = match[1].trim();
      if (/^[a-z0-9][a-z0-9_-]*$/i.test(name)) urls.add(new URL(`${name}.min.js`, chunkBase).toString());
    }
  }
  return [...urls];
}

function rewriteEmbeddedUrls(
  value: string,
  pageUrl: string,
  currentOutputPath: string,
  sourceOrigin: string,
  publicOrigin: string,
  flatPages: boolean,
): string {
  const pattern = /(?:https?:\\?\/\\?\/|\/\/)[^"' \t\r\n<>),};\]]+/gi;
  return value.replace(pattern, (candidate) => {
    const normalized = candidate.replace(/\\\//g, '/');
    let url: URL;
    try {
      url = new URL(normalized, pageUrl);
    } catch {
      return candidate;
    }
    if (!isInternalOrigin(url.toString(), sourceOrigin, publicOrigin)) return candidate;

    const normalizedUrl = url.toString();
    const directory = relativeDirectoryUrl(normalizedUrl, pageUrl, currentOutputPath, sourceOrigin, publicOrigin);
    if (directory) return directory;
    const predicate = isAssetPath(normalizedUrl)
      ? isAssetPath
      : isStaticPagePath(normalizedUrl)
        ? isStaticPagePath
        : null;
    if (predicate) {
      const rewritten = relativeOutputUrl(normalizedUrl, pageUrl, currentOutputPath, sourceOrigin, publicOrigin, flatPages, predicate);
      if (rewritten) return rewritten;
    }

    // Keep non-static endpoints usable on the public site, but never leak the local origin.
    return `${publicOrigin}${url.pathname}${url.search}${url.hash}`;
  });
}

function rewriteSrcset(
  value: string,
  pageUrl: string,
  currentOutputPath: string,
  sourceOrigin: string,
  publicOrigin: string,
  flatPages: boolean,
): string {
  return value.split(',').map((candidate) => {
    const parts = candidate.trim().split(/\s+/);
    if (parts[0]) {
      const rewritten = relativeOutputUrl(parts[0], pageUrl, currentOutputPath, sourceOrigin, publicOrigin, flatPages, isAssetPath);
      parts[0] = rewritten || replaceOrigin(parts[0], sourceOrigin, publicOrigin);
    }
    return parts.join(' ');
  }).join(', ');
}

function rewriteHtml(
  html: string,
  pageUrl: string,
  sourceOrigin: string,
  publicOrigin: string,
  flatPages: boolean,
): string {
  const $ = cheerio.load(html);
  const currentOutputPath = outputPathForUrl(pageUrl, flatPages);
  $('[href], [src], [action], [poster], [data-src], [data-lazy-src], [srcset], [style]').each((_index, element) => {
    const node = $(element);
    const tagName = String(element.tagName || '').toLowerCase();
    const rel = String(node.attr('rel') || '').toLowerCase();
    const isPageLink = tagName === 'a' || tagName === 'area';
    const isAssetLink = tagName === 'script'
      || tagName === 'img'
      || tagName === 'source'
      || tagName === 'video'
      || tagName === 'audio'
      || tagName === 'iframe'
      || (tagName === 'link' && /(stylesheet|icon|manifest|preload|modulepreload)/.test(rel));
    for (const attribute of ['href', 'src', 'action', 'poster', 'data-src', 'data-lazy-src']) {
      const value = node.attr(attribute);
      if (!value) continue;
      let predicate: ((urlString: string) => boolean) | null = null;
      if (isPageLink && attribute === 'href') predicate = isStaticPagePath;
      if (isAssetLink && (attribute !== 'href' || tagName === 'link')) predicate = isAssetPath;
      const rewritten = predicate
        ? relativeOutputUrl(value, pageUrl, currentOutputPath, sourceOrigin, publicOrigin, flatPages, predicate)
        : null;
      node.attr(attribute, rewritten || replaceOrigin(value, sourceOrigin, publicOrigin));
    }
    const srcset = node.attr('srcset');
    if (srcset) node.attr('srcset', rewriteSrcset(srcset, pageUrl, currentOutputPath, sourceOrigin, publicOrigin, flatPages));
    const style = node.attr('style');
    if (style) node.attr('style', replaceOrigin(style, sourceOrigin, publicOrigin));
  });

  $('script').each((_index, element) => {
    const node = $(element);
    const contents = node.html();
    if (contents) node.html(rewriteEmbeddedUrls(contents, pageUrl, currentOutputPath, sourceOrigin, publicOrigin, flatPages));
  });
  $('style').each((_index, element) => {
    const node = $(element);
    const contents = node.html();
    if (contents) {
      const rewrittenCss = rewriteCss(contents, pageUrl, sourceOrigin, publicOrigin, flatPages);
      node.html(rewriteEmbeddedUrls(rewrittenCss, pageUrl, currentOutputPath, sourceOrigin, publicOrigin, flatPages));
    }
  });

  return replaceOrigin($.html(), sourceOrigin, publicOrigin);
}

function rewriteCss(
  css: string,
  assetUrl: string,
  sourceOrigin: string,
  publicOrigin: string,
  flatPages: boolean,
): string {
  const currentOutputPath = outputPathForUrl(assetUrl, flatPages);
  return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (match, quote: string, value: string) => {
    const rewritten = relativeOutputUrl(value, assetUrl, currentOutputPath, sourceOrigin, publicOrigin, flatPages, isAssetPath);
    return `url(${quote}${rewritten || replaceOrigin(value, sourceOrigin, publicOrigin)}${quote})`;
  });
}

function extractAssetUrls(html: string, pageUrl: string): string[] {
  const $ = cheerio.load(html);
  const urls = new Set<string>();
  $('[src], [poster], [data-src], [data-lazy-src]').each((_index, element) => {
    for (const attribute of ['src', 'poster', 'data-src', 'data-lazy-src']) {
      const value = $(element).attr(attribute);
      const normalized = value ? normalizeUrl(value, pageUrl) : null;
      if (normalized) urls.add(normalized);
    }
  });
  $('[href]').each((_index, element) => {
    const rel = String($(element).attr('rel') || '').toLowerCase();
    if (!/(stylesheet|icon|manifest|preload|modulepreload)/.test(rel)) return;
    const value = $(element).attr('href');
    const normalized = value ? normalizeUrl(value, pageUrl) : null;
    if (normalized) urls.add(normalized);
  });
  $('[srcset]').each((_index, element) => {
    const srcset = $(element).attr('srcset') || '';
    for (const candidate of srcset.split(',')) {
      const value = candidate.trim().split(/\s+/)[0];
      const normalized = value ? normalizeUrl(value, pageUrl) : null;
      if (normalized) urls.add(normalized);
    }
  });
  for (const embedded of embeddedUrlCandidates(html, pageUrl)) {
    if (isAssetPath(embedded)) urls.add(embedded);
  }
  for (const embedded of extractJavascriptAssetUrls(html, pageUrl)) {
    if (isAssetPath(embedded)) urls.add(embedded);
  }
  return [...urls];
}

function extractPageUrls(html: string, pageUrl: string, sourceOrigin: string): string[] {
  const $ = cheerio.load(html);
  const urls = new Set<string>();
  $('a[href]').each((_index, element) => {
    const raw = $(element).attr('href');
    const normalized = raw ? normalizeUrl(raw, pageUrl) : null;
    if (!normalized || !isSameOrigin(normalized, sourceOrigin) || !isLikelyPage(normalized)) return;
    const url = new URL(normalized);
    if (url.pathname.startsWith('/wp-admin') || url.pathname.startsWith('/wp-login')) return;
    urls.add(normalized);
  });
  return [...urls];
}

async function readSitemap(sitemapUrl: string, sourceOrigin: string, visited: Set<string>, depth = 0): Promise<string[]> {
  if (depth > 3 || visited.has(sitemapUrl)) return [];
  visited.add(sitemapUrl);
  try {
    const response = await requestBuffer(sitemapUrl);
    if (response.statusCode < 200 || response.statusCode >= 300) return [];
    const $ = cheerio.load(response.body.toString('utf8'), { xml: true });
    const urls: string[] = [];
    const nested: string[] = [];
    $('loc').each((_index, element) => {
      const value = $(element).text().trim();
      if (!value || !isSameOrigin(value, sourceOrigin)) return;
      if (/\.xml(?:$|\?)/i.test(new URL(value).pathname)) nested.push(value);
      else if (isLikelyPage(value)) urls.push(value);
    });
    for (const child of nested) urls.push(...await readSitemap(child, sourceOrigin, visited, depth + 1));
    return urls;
  } catch {
    return [];
  }
}

async function discoverSitemapUrls(sourceUrl: string, sourceOrigin: string): Promise<string[]> {
  const candidates = [`${sourceUrl}/wp-sitemap.xml`, `${sourceUrl}/sitemap.xml`];
  const visited = new Set<string>();
  for (const candidate of candidates) {
    const urls = await readSitemap(candidate, sourceOrigin, visited);
    if (urls.length) return [...new Set(urls)];
  }
  return [];
}

async function writeExportFile(outputDir: string, urlString: string, body: Buffer, flatPages: boolean): Promise<void> {
  const target = safeOutputPath(outputDir, outputPathForUrl(urlString, flatPages));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, body);
}

export async function exportSite(
  site: LocalSite,
  outputDir: string,
  options: ExportOptions = {},
  onProgress: ProgressCallback = () => undefined,
): Promise<ExportResult> {
  const sourceRoot = sourceUrlForSite(site, options.sourceUrl).replace(/\/$/, '');
  const sourceUrl = `${sourceRoot}/`;
  let sourceOrigin = new URL(sourceUrl).origin;
  const configuredPublicOrigin = options.publicUrl?.trim()
    ? options.publicUrl.trim().replace(/\/$/, '')
    : null;
  let publicOrigin = configuredPublicOrigin || sourceOrigin;
  // Keep every export layout consistent: pages are flat files while assets retain
  // their original directory structure. This also avoids requiring directory
  // index rewrites on SFTP hosts.
  const flatPages = true;
  const maxPages = Math.max(1, Math.min(options.maxPages || 200, 2_000));
  const state: CrawlState = {
    sourceOrigin,
    publicOrigin,
    pages: new Map(),
    assets: new Map(),
    warnings: [],
    queuedPages: new Set(),
    queuedAssets: new Set(),
  };

  onProgress({ phase: 'starting', message: `Preparing export of ${sourceUrl}.` });

  const pageQueue: string[] = [sourceUrl];
  if (options.includeSitemap !== false) {
    pageQueue.push(...await discoverSitemapUrls(sourceRoot, sourceOrigin));
  }

  while (pageQueue.length && state.pages.size < maxPages) {
    const pageUrl = pageQueue.shift()!;
    if (state.queuedPages.has(pageUrl)) continue;
    state.queuedPages.add(pageUrl);
      onProgress({ phase: 'crawling', message: `Reading ${pageUrl}`, current: state.pages.size + 1, total: maxPages });

    try {
      const response = await requestBuffer(pageUrl, { Accept: 'text/html,application/xhtml+xml' });
      if (response.statusCode < 200 || response.statusCode >= 300) {
        state.warnings.push(`${pageUrl}: HTTP ${response.statusCode}`);
        continue;
      }
      const type = contentType(response);
      if (!type.includes('html')) {
        state.warnings.push(`${pageUrl}: No HTML content (Content-Type: ${type || 'unknown'})`);
        continue;
      }
      const responseUrl = response.url || pageUrl;
      if (isSameOrigin(responseUrl, sourceOrigin)) {
        sourceOrigin = new URL(responseUrl).origin;
        if (!configuredPublicOrigin) publicOrigin = sourceOrigin;
        state.sourceOrigin = sourceOrigin;
        state.publicOrigin = publicOrigin;
      }
      const html = response.body.toString('utf8');
      state.pages.set(pageUrl, Buffer.from(rewriteHtml(html, responseUrl, sourceOrigin, publicOrigin, flatPages), 'utf8'));
      for (const asset of extractAssetUrls(html, responseUrl)) {
        if (isSameOrigin(asset, sourceOrigin)) state.queuedAssets.add(asset);
      }
      for (const child of extractPageUrls(html, responseUrl, sourceOrigin)) {
        if (!state.queuedPages.has(child) && pageQueue.length + state.pages.size < maxPages) pageQueue.push(child);
      }
    } catch (error) {
      state.warnings.push(`${pageUrl}: ${(error as Error).message}`);
    }
  }

  const pendingPageCount = pageQueue.filter((url) => !state.queuedPages.has(url)).length;
  const limitReached = state.pages.size >= maxPages && pendingPageCount > 0;
  if (limitReached) {
    state.warnings.push(`Page limit reached (${maxPages}). ${pendingPageCount} additional page${pendingPageCount === 1 ? '' : 's'} were not exported.`);
  }

  const assetQueue = [...state.queuedAssets];
  let assetIndex = 0;
  while (assetQueue.length) {
    const assetUrl = assetQueue.shift()!;
    if (state.assets.has(assetUrl)) continue;
    assetIndex += 1;
    onProgress({ phase: 'crawling', message: `Reading asset ${assetUrl}`, current: assetIndex, total: assetIndex + assetQueue.length });
    try {
      const response = await requestBuffer(assetUrl);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        state.warnings.push(`${assetUrl}: HTTP ${response.statusCode}`);
        continue;
      }
      const type = contentType(response);
      const responseUrl = response.url || assetUrl;
      const sourceText = response.body.toString('utf8');
      const body = type === 'text/css'
        ? Buffer.from(rewriteCss(sourceText, responseUrl, sourceOrigin, publicOrigin, flatPages), 'utf8')
        : response.body;
      state.assets.set(assetUrl, body);
      if (type === 'text/css') {
        const cssUrls = [...sourceText.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)].map((match) => match[1]);
        for (const cssUrl of cssUrls) {
          const resolved = normalizeUrl(cssUrl, assetUrl);
          if (resolved && isSameOrigin(resolved, sourceOrigin) && !state.assets.has(resolved)) assetQueue.push(resolved);
        }
      } else if (type.includes('javascript') || /\.(?:m?js)(?:$|\?)/i.test(new URL(responseUrl).pathname)) {
        for (const embedded of embeddedUrlCandidates(sourceText, responseUrl)) {
          if (isSameOrigin(embedded, sourceOrigin) && isAssetPath(embedded) && !state.assets.has(embedded)) assetQueue.push(embedded);
        }
        for (const embedded of extractJavascriptAssetUrls(sourceText, responseUrl)) {
          if (isSameOrigin(embedded, sourceOrigin) && isAssetPath(embedded) && !state.assets.has(embedded)) assetQueue.push(embedded);
        }
      }
    } catch (error) {
      state.warnings.push(`${assetUrl}: ${(error as Error).message}`);
    }
  }

  if (state.pages.size === 0) {
    const details = state.warnings.length ? ` ${state.warnings.join(' | ')}` : '';
    throw new Error(`No HTML page was exported. Check that the Local site is running and reachable.${details}`);
  }

  onProgress({ phase: 'writing', message: 'Writing static files.' });
  for (const [url, body] of state.pages) await writeExportFile(outputDir, url, body, flatPages);
  for (const [url, body] of state.assets) await writeExportFile(outputDir, url, body, flatPages);

  const manifest = {
    publisher: 'local-static-publisher',
    generatedAt: new Date().toISOString(),
    sourceUrl,
    publicUrl: publicOrigin,
    site: { id: site.id, name: site.name, domain: site.domain },
    pages: [...state.pages.keys()],
    assets: [...state.assets.keys()],
    warnings: state.warnings,
  };
  await fs.writeFile(path.join(outputDir, 'export-manifest.json'), JSON.stringify(manifest, null, 2));
  onProgress({ phase: 'complete', message: `Export complete: ${state.pages.size} pages, ${state.assets.size} assets.`, outputDir, pages: state.pages.size, assets: state.assets.size, limitReached, pendingPages: pendingPageCount });

  return { outputDir, pages: state.pages.size, assets: state.assets.size, warnings: state.warnings, limitReached, pendingPages: pendingPageCount };
}
