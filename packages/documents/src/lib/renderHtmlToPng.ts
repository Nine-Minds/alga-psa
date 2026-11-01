import puppeteer from 'puppeteer';
import { fetchPublicBytes } from '@alga-psa/core/net/safeFetch';
import { createAssetBudget, mapWithConcurrency, validateRemoteAssetLimits, type RemoteAssetLimits } from './remoteAssetBudget';

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
  limits?: Partial<RemoteAssetLimits>;
}

const PLACEHOLDER_STYLE =
  'display:inline-block;min-width:60px;min-height:30px;padding:4px;background:#e5e7eb;color:#6b7280;' +
  'font-size:12px;border:1px solid #d1d5db;box-sizing:border-box;';
// 1x1 transparent PNG used for blocked CSS url() references.
const TRANSPARENT_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const REMOTE_URL = /^\s*https?:\/\//i;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function decodeAttr(s: string): string {
  return s.replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&#x27;/gi, "'");
}
function getAttr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? decodeAttr(m[1] ?? m[2] ?? '') : undefined;
}

type AssetResolver = (url: string) => Promise<string | null>;

function makeResolver(opts: RenderHtmlToPngOptions, orderedUrls: string[]): { resolve: AssetResolver; finish: () => void } {
  const cache = new Map<string, Promise<string | null>>();
  const assetIndices = new Map(orderedUrls.map((url, index) => [url, index]));
  const limits = validateRemoteAssetLimits(opts.limits);
  const budget = createAssetBudget(limits);
  let considered = orderedUrls.length;
  let skippedByBytes = 0;
  let chargeQueue = Promise.resolve();
  const fetchAsset = opts.fetchAsset ?? ((url: string) => fetchPublicBytes(url));
  const resolve: AssetResolver = (url) => {
    let hit = cache.get(url);
    if (!hit) {
      const index = assetIndices.get(url) ?? considered++;
      const admitted = budget.admit(index);
      if (!admitted) {
        hit = Promise.resolve(null);
      } else {
        const previousCharge = chargeQueue;
        let releaseCharge!: () => void;
        chargeQueue = new Promise<void>((resolveCharge) => { releaseCharge = resolveCharge; });
        const fetched = Promise.resolve().then(() => fetchAsset(url)).catch(() => null);
        hit = fetched.then(async (result) => {
          await previousCharge;
          try {
            if (!result || !/^image\//i.test(result.contentType)) return null;
            if (!budget.charge(result.bytes.length)) {
              skippedByBytes += 1;
              return null;
            }
            return `data:${result.contentType};base64,${result.bytes.toString('base64')}`;
          } finally {
            releaseCharge();
          }
        });
      }
      cache.set(url, hit);
    }
    return hit;
  };
  return {
    resolve,
    finish: () => {
      const skippedByCount = Math.max(0, considered - limits.maxAssets);
      if (skippedByCount || skippedByBytes) {
        console.warn('[renderHtmlToPng] remote asset budget exhausted', {
          considered,
          admitted: budget.admitted,
          skipped: skippedByCount + skippedByBytes,
          skippedByCount,
          skippedByBytes,
          spentBytes: budget.spentBytes,
          maxTotalBytes: limits.maxTotalBytes,
        });
      }
    },
  };
}

function collectRemoteAssetUrls(html: string): string[] {
  const references: Array<{ index: number; url: string }> = [];
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const src = getAttr(match[0], 'src');
    if (src !== undefined && REMOTE_URL.test(src)) references.push({ index: match.index!, url: src.trim() });
  }
  for (const match of html.matchAll(/url\(\s*(["']?)\s*(https?:\/\/[^)"']*)\1\s*\)/gi)) {
    references.push({ index: match.index!, url: decodeAttr(match[2]).trim() });
  }
  references.sort((a, b) => a.index - b.index);
  return [...new Set(references.map(({ url }) => url))];
}

async function replaceAsync(
  input: string,
  re: RegExp,
  fn: (match: RegExpExecArray) => Promise<string>,
  concurrency: number
): Promise<string> {
  const matches = [...input.matchAll(re)] as RegExpExecArray[];
  const replacements = await mapWithConcurrency(matches, concurrency, fn);
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
  opts: Pick<RenderHtmlToPngOptions, 'remoteAssets' | 'fetchAsset' | 'limits'> = {}
): Promise<string> {
  const mode = opts.remoteAssets ?? 'inline';
  const resolver = mode === 'inline' ? makeResolver(opts, collectRemoteAssetUrls(html)) : null;
  const resolve: AssetResolver = resolver?.resolve ?? (async () => null);
  const limits = validateRemoteAssetLimits(opts.limits);

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
  }, limits.concurrency);

  // srcset can also load remote images; drop it when it references remote URLs.
  out = out.replace(/(<img\b[^>]*?)\s(?:srcset)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '$1');

  // CSS url(http...)
  out = await replaceAsync(out, /url\(\s*(["']?)\s*(https?:\/\/[^)"']*)\1\s*\)/gi, async (m) => {
    const dataUri = await resolve(decodeAttr(m[2]).trim());
    return `url("${dataUri ?? TRANSPARENT_PIXEL}")`;
  }, limits.concurrency);

  resolver?.finish();

  return out;
}

/**
 * Renders HTML to a PNG using headless Chromium with the network closed:
 * JavaScript is disabled and every request except data:/blob:/about: is aborted, so
 * caller-controlled HTML cannot make the server issue requests (SSRF) or read responses back.
 * Remote images are fetched by us through safeFetch and inlined (see resolveRemoteAssets).
 */
export async function renderHtmlToPng(html: string, opts: RenderHtmlToPngOptions = {}): Promise<Buffer> {
  const width = opts.width ?? 400;
  const height = opts.height ?? 300;
  const safeHtml = await resolveRemoteAssets(html, opts);

  let browser;
  try {
    const puppeteerOptions: any = {
      headless: true,
      // --no-sandbox etc. are kept for the container runtime; they are unrelated to the SSRF
      // fix and intentionally out of scope for it.
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-features=IsolateOrigins',
        '--disable-site-isolation-trials',
        // Defense in depth below request interception: route everything through a dead proxy
        // (and do not bypass it for loopback) so no socket can be opened even by Chromium's own
        // pre-connect logic for <iframe>/<object> navigations.
        '--proxy-server=socks5://127.0.0.1:1',
        '--proxy-bypass-list=<-loopback>',
      ],
    };

    // Use system chromium if available (Docker environment)
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      puppeteerOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }

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
    await page.setContent(styledHtml, { waitUntil: 'domcontentloaded' });
    const imageBuffer = await page.screenshot({ type: 'png' });

    return Buffer.from(imageBuffer);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
