import puppeteer from 'puppeteer';
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
function decodeAttr(s: string): string {
  return s.replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&#x27;/gi, "'");
}
function getAttr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? decodeAttr(m[1] ?? m[2] ?? '') : undefined;
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

/**
 * Rewrites remote http(s) image references in `html`: `<img src>` and CSS `url(...)`.
 * With 'inline' they become data: URIs (fetched via safeFetch); anything refused, failed or
 * non-image becomes a neutral placeholder. With 'block' all remote references are replaced.
 * Other remote-loading constructs (iframe/script/link/@import) are dropped by request
 * interception in the browser; this function only decides what survives as an image.
 */
export async function resolveRemoteAssets(
  html: string,
  opts: Pick<RenderHtmlToPngOptions, 'remoteAssets' | 'fetchAsset'> = {}
): Promise<string> {
  const mode = opts.remoteAssets ?? 'inline';
  const resolve: AssetResolver = mode === 'inline' ? makeResolver(opts) : async () => null;

  // <img ... src="http...">
  let out = await replaceAsync(html, /<img\b[^>]*>/gi, async (m) => {
    const tag = m[0];
    const src = getAttr(tag, 'src');
    if (src === undefined || !REMOTE_URL.test(src)) return tag;
    const dataUri = await resolve(src.trim());
    if (dataUri) {
      return tag.replace(/(\ssrc\s*=\s*)(?:"[^"]*"|'[^']*')/i, (_m, pre: string) => pre + '"' + dataUri + '"');
    }
    const alt = getAttr(tag, 'alt') ?? '';
    return `<span style="${PLACEHOLDER_STYLE}" role="img" aria-label="${escapeHtml(alt)}">${escapeHtml(alt)}</span>`;
  });

  // srcset can also load remote images; drop it when it references remote URLs.
  out = out.replace(/(<img\b[^>]*?)\s(?:srcset)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '$1');

  // CSS url(http...)
  out = await replaceAsync(out, /url\(\s*(["']?)\s*(https?:\/\/[^)"']*)\1\s*\)/gi, async (m) => {
    const dataUri = await resolve(decodeAttr(m[2]).trim());
    return `url("${dataUri ?? TRANSPARENT_PIXEL}")`;
  });

  return out;
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
  let browser;
  try {
    // Escape structured values and sanitize all supported rich HTML before resolving image URLs.
    const sanitizedHtml = toHtml(content);
    const safeHtml = await withTimeout(resolveRemoteAssets(sanitizedHtml, opts), 6000, 'Asset resolution');
    const puppeteerOptions: any = {
      headless: true,
      args: [
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-features=IsolateOrigins',
        '--disable-site-isolation-trials',
        // Defense in depth below interception. A dead proxy prevents Chromium preconnects.
        '--proxy-server=socks5://127.0.0.1:1',
        '--proxy-bypass-list=<-loopback>',
      ],
    };

    // Chromium sandboxing is active whenever the process is not root. Root containers cannot
    // use Chromium's sandbox; the request-deny policy below remains the security boundary.
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      puppeteerOptions.args.push('--no-sandbox', '--disable-setuid-sandbox');
    }

    // Use system chromium if available (Docker environment)
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      puppeteerOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    puppeteerOptions.timeout = 10000;
    browser = await puppeteer.launch(puppeteerOptions);
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
    const imageBuffer = await withTimeout(page.screenshot({ type: 'png' }), 10000, 'Chromium screenshot');

    return Buffer.from(imageBuffer);
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
