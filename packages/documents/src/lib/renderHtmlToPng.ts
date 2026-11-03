import puppeteer, { type Browser } from 'puppeteer';
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { fetchPublicBytes } from '@alga-psa/core/net/safeFetch';

export type RenderContent =
  | { kind: 'text'; text: string }
  | { kind: 'rich-html'; html: string }
  | { kind: 'file-placeholder'; fileName: string; fileType: string; fileSize: string; icon: string };

export interface RenderHtmlToPngOptions {
  width?: number;
  height?: number;
  /**
   * 'inline' (default): fetch remote http(s) images ourselves through safeFetch and embed the bytes.
   * 'block': render without any remote asset at all.
   */
  remoteAssets?: 'inline' | 'block';
  /**
   * Resolve a remote asset URL to bytes. Defaults to safeFetch's public-only fetch.
   * Injectable so tests can assert the rewritten HTML without the network.
   */
  fetchAsset?: (url: string) => Promise<{ bytes: Buffer; contentType: string }>;
}

const PLACEHOLDER_STYLE =
  'display:inline-block;min-width:60px;min-height:30px;padding:4px;background:#e5e7eb;color:#6b7280;' +
  'font-size:12px;border:1px solid #d1d5db;box-sizing:border-box;';
// 1x1 transparent PNG used for blocked CSS url() references.
const TRANSPARENT_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const REMOTE_URL = /^\s*https?:\/\//i;

const purifier = createDOMPurify(new JSDOM('').window);
const FAILURE_PLACEHOLDER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

async function fallbackPlaceholder(): Promise<Buffer> {
  try {
    const sharpModule = await import('sharp');
    const sharp = (sharpModule as any).default ?? sharpModule;
    return await sharp(Buffer.from('<svg width="400" height="300"><rect width="100%" height="100%" fill="#e5e7eb"/><text x="20" y="150" fill="#4b5563" font-size="16">Preview unavailable</text></svg>'))
      .png()
      .toBuffer();
  } catch {
    return Buffer.from(FAILURE_PLACEHOLDER);
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toHtml(content: RenderContent): string {
  if (content.kind === 'text') {
    return `<pre>${escapeHtml(content.text)}</pre>`;
  }
  if (content.kind === 'rich-html') {
    return purifier.sanitize(content.html, { USE_PROFILES: { html: true } });
  }

  return `<div style="font-family: sans-serif; padding: 20px; text-align: center; background: #f9f9f9; width: 100%; height: 100%;">
    <div style="font-size: 64px; margin-bottom: 15px;">${escapeHtml(content.icon)}</div>
    <div style="background: #607d8b; color: white; padding: 10px; margin-bottom: 15px;"><strong>${escapeHtml(content.fileType)}</strong></div>
    <div style="font-size: 14px; color: #333; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 10px;">${escapeHtml(content.fileName)}</div>
    <div style="font-size: 12px; color: #666;">${escapeHtml(content.fileSize)}</div>
    <div style="margin-top: 15px; font-size: 12px; color: #999;">Preview not available. Download to view.</div>
  </div>`;
}
type AssetResolver = (url: string) => Promise<string | null>;

function makeResolver(opts: RenderHtmlToPngOptions): AssetResolver {
  const cache = new Map<string, Promise<string | null>>();
  const fetchAsset = opts.fetchAsset ?? ((url: string) => fetchPublicBytes(url));
  return (url) => {
    let hit = cache.get(url);
    if (!hit) {
      hit = fetchAsset(url)
        .then(({ bytes, contentType }) =>
          /^image\//i.test(contentType) ? `data:${contentType};base64,${bytes.toString('base64')}` : null
        )
        .catch(() => null); // a blocked asset must never fail the preview
      cache.set(url, hit);
    }
    return hit;
  };
}

async function replaceAsync(
  input: string,
  re: RegExp,
  fn: (match: RegExpExecArray) => Promise<string>
): Promise<string> {
  const matches = [...input.matchAll(re)] as RegExpExecArray[];
  const replacements = await Promise.all(matches.map(fn));
  let out = '';
  let last = 0;
  matches.forEach((m, i) => {
    out += input.slice(last, m.index) + replacements[i];
    last = m.index! + m[0].length;
  });
  return out + input.slice(last);
}

async function resolveCssUrls(value: string, resolve: AssetResolver, mode: 'inline' | 'block'): Promise<string> {
  return replaceAsync(value, /url\(\s*(["']?)\s*(https?:\/\/[^)"']*)\1\s*\)/gi, async (match) => {
    const url = match[2].trim();
    const dataUri = mode === 'inline' ? await resolve(url) : null;
    return `url("${dataUri ?? TRANSPARENT_PIXEL}")`;
  });
}

async function rewriteCssDeclaration(style: CSSStyleDeclaration, resolve: AssetResolver, mode: 'inline' | 'block'): Promise<void> {
  const declarations = Array.from({ length: style.length }, (_, index) => style[index]);
  for (const property of declarations) {
    const value = style.getPropertyValue(property);
    const rewritten = await resolveCssUrls(value, resolve, mode);
    if (rewritten !== value) {
      style.setProperty(property, rewritten, style.getPropertyPriority(property));
    }
  }
}

async function rewriteCssRules(rules: CSSRuleList, resolve: AssetResolver, mode: 'inline' | 'block'): Promise<void> {
  for (const rule of Array.from(rules)) {
    const cssRule = rule as CSSRule & { style?: CSSStyleDeclaration; cssRules?: CSSRuleList };
    if (cssRule.style) {
      await rewriteCssDeclaration(cssRule.style, resolve, mode);
    } else if (cssRule.cssRules) {
      await rewriteCssRules(cssRule.cssRules, resolve, mode);
    }
  }
}

function isSandboxUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no usable sandbox|failed to move to new namespace|namespace.*operation not permitted/i.test(message);
}

async function launchBrowser(): Promise<Browser> {
  const args = [
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-features=IsolateOrigins',
    '--disable-site-isolation-trials',
    // Defense in depth below interception. A dead proxy prevents Chromium preconnects.
    '--proxy-server=socks5://127.0.0.1:1',
    '--proxy-bypass-list=<-loopback>',
  ];
  const launchOptions: any = {
    headless: true,
    args,
    timeout: 10000,
  };

  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  // Chromium cannot sandbox as root. Otherwise try Chromium's sandbox first, then use
  // no-sandbox only for its explicit "no usable sandbox" failure (common in restricted
  // containers without user namespaces). Request denial remains the security boundary.
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    return puppeteer.launch({
      ...launchOptions,
      args: [...args, '--no-sandbox', '--disable-setuid-sandbox'],
    });
  }

  try {
    return await puppeteer.launch(launchOptions);
  } catch (error) {
    if (!isSandboxUnavailable(error)) throw error;
    console.warn('[renderHtmlToPng] Chromium sandbox is unavailable in this runtime; retrying with network isolation only.');
    return puppeteer.launch({
      ...launchOptions,
      args: [...args, '--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
}

/**
 * Rewrites remote http(s) image references from `<img src>` and parsed CSS declarations.
 * Text nodes and ordinary metadata attributes are never interpreted as CSS or resource URLs.
 * With 'inline' they become data: URIs (fetched via safeFetch); anything refused, failed or
 * non-image becomes a neutral placeholder. With 'block' all remote references are replaced.
 * Other remote-loading constructs (iframe/script/link/@import) are denied by request
 * interception in the browser; this function only decides what survives as an image.
 */
export async function resolveRemoteAssets(
  html: string,
  opts: Pick<RenderHtmlToPngOptions, 'remoteAssets' | 'fetchAsset'> = {}
): Promise<string> {
  const mode = opts.remoteAssets ?? 'inline';
  const resolve: AssetResolver = mode === 'inline' ? makeResolver(opts) : async () => null;
  const dom = new JSDOM(`<body>${html}</body>`);
  const document = dom.window.document;

  for (const image of Array.from(document.querySelectorAll('img[src]'))) {
    const src = image.getAttribute('src') ?? '';
    if (!REMOTE_URL.test(src)) continue;
    const dataUri = mode === 'inline' ? await resolve(src.trim()) : null;
    if (dataUri) {
      image.setAttribute('src', dataUri);
    } else {
      const placeholder = document.createElement('span');
      placeholder.setAttribute('style', PLACEHOLDER_STYLE);
      placeholder.setAttribute('role', 'img');
      const alt = image.getAttribute('alt') ?? '';
      placeholder.setAttribute('aria-label', alt);
      placeholder.textContent = alt;
      image.replaceWith(placeholder);
    }
  }

  for (const image of Array.from(document.querySelectorAll('img[srcset]'))) {
    if (/https?:\/\//i.test(image.getAttribute('srcset') ?? '')) image.removeAttribute('srcset');
  }

  for (const element of Array.from(document.querySelectorAll('[style]'))) {
    await rewriteCssDeclaration((element as HTMLElement).style, resolve, mode);
  }

  for (const styleElement of Array.from(document.querySelectorAll('style'))) {
    const sheet = styleElement.sheet;
    if (sheet) {
      await rewriteCssRules(sheet.cssRules, resolve, mode);
      styleElement.textContent = Array.from(sheet.cssRules, (rule) => rule.cssText).join('\n');
    }
  }

  return document.body.innerHTML;
}

/**
 * Renders HTML to a PNG using headless Chromium with the network closed:
 * JavaScript is disabled and every request except data:/blob:/about: is aborted, so
 * caller-controlled HTML cannot make the server issue requests (SSRF) or read responses back.
 * Remote images are fetched by us through safeFetch and inlined (see resolveRemoteAssets).
 */
export async function renderHtmlToPng(content: RenderContent, opts: RenderHtmlToPngOptions = {}): Promise<Buffer> {
  const width = opts.width ?? 400;
  const height = opts.height ?? 300;
  let browser: Browser | undefined;
  try {
    // Escape structured values and sanitize all supported rich HTML before resolving image URLs.
    const sanitizedHtml = toHtml(content);
    const safeHtml = await withTimeout(resolveRemoteAssets(sanitizedHtml, opts), 6000, 'Asset resolution');
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width, height });

    // Deny network by default.
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) {
        return void req.continue();
      }
      return void req.abort('blockedbyclient');
    });

    const styledHtml = `
        <style>
          body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"; font-size: 14px; line-height: 1.4; padding: 15px; border: 1px solid #e0e0e0; box-sizing: border-box; overflow: hidden; height: ${height}px; background-color: #ffffff; }
          pre { white-space: pre-wrap; word-wrap: break-word; font-family: monospace; }
          h1, h2, h3, h4, h5, h6 { margin-top: 0; margin-bottom: 0.5em; }
          p { margin-top: 0; margin-bottom: 1em; }
          table { border-collapse: collapse; width: 100%; margin-bottom: 1em; }
          th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
          ul, ol { padding-left: 20px; margin-top: 0; margin-bottom: 1em; }
          img { max-width: 100%; height: auto; }
          /* Basic styling for BlockNote generated HTML */
          .bn-editor table { width: 100%; border-collapse: collapse; }
          .bn-editor th, .bn-editor td { border: 1px solid #ddd; padding: 8px; }
        </style>
        <div>${safeHtml}</div>
      `;
    await page.setContent(styledHtml, { waitUntil: 'domcontentloaded', timeout: 5000 });
    // Puppeteer's default screenshot encoding is a Uint8Array. Keep that byte type
    // explicit through the timeout wrapper so it cannot widen to unknown.
    const screenshotBytes: Promise<Uint8Array> = page.screenshot({ type: 'png' });
    const imageBytes = await withTimeout<Uint8Array>(screenshotBytes, 10000, 'Chromium screenshot');

    return Buffer.from(imageBytes);
  } catch (error) {
    console.error('[renderHtmlToPng] Preview rendering failed; returning placeholder image:', error);
    return await fallbackPlaceholder();
  } finally {
    if (browser) {
      try {
        await withTimeout(browser.close(), 2000, 'Chromium close');
      } catch {
        browser.process()?.kill('SIGKILL');
      }
    }
  }
}
