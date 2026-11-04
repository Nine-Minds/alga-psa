import puppeteer from 'puppeteer';
import type { Page } from 'puppeteer';
import { fetchPublicBytes } from '@alga-psa/core/net/safeFetch';
import { JSDOM } from 'jsdom';
import postcss from 'postcss';
import valueParser from 'postcss-value-parser';

/** These flags close Chromium's speculative connection path as well as page requests. */
export const ISOLATED_RENDERER_BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-features=IsolateOrigins',
  '--disable-site-isolation-trials',
  '--proxy-server=socks5://127.0.0.1:1',
  '--proxy-bypass-list=<-loopback>',
];

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
const DATA_IMAGE_URL = /^data:image\//i;

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

type CssValueNode = {
  type: string;
  value: string;
  quote?: string;
  nodes?: CssValueNode[];
};

function decodeCssEscapes(value: string): string {
  return value.replace(/\\([\da-f]{1,6})(?:\s)?|\\([^\r\n\f])/gi, (_match, hex: string | undefined, escaped: string | undefined) =>
    hex ? String.fromCodePoint(Number.parseInt(hex, 16)) : escaped ?? ''
  );
}

function cssResourceIsAllowed(url: string): boolean {
  return decodeCssEscapes(url).trim().toLowerCase().startsWith('data:');
}

function hasUnsupportedCssResource(value: string): boolean {
  // Comments are removed before tokenization because CSS comments may split an identifier.
  const parsed = valueParser(value.replace(/\/\*[\s\S]*?\*\//g, ''));
  let unsupported = false;

  parsed.walk((node: CssValueNode) => {
    if (node.type !== 'function') return;
    const functionName = decodeCssEscapes(node.value).toLowerCase();
    if (functionName === 'url') {
      const argument = (node.nodes ?? []).map((part) => part.value).join('').trim();
      if (!cssResourceIsAllowed(argument)) unsupported = true;
      return;
    }

    // CSS image-set() accepts URL strings as well as url() functions.
    if (functionName === 'image-set' || functionName === '-webkit-image-set') {
      for (const part of node.nodes ?? []) {
        if (part.type === 'string' && !cssResourceIsAllowed(part.value)) unsupported = true;
      }
    }
  });

  return unsupported;
}

function sanitizeStylesheet(css: string): string {
  try {
    const root = postcss.parse(css);
    root.walkAtRules((rule) => {
      if (rule.name.toLowerCase() === 'import' || hasUnsupportedCssResource(rule.params)) {
        rule.remove();
      }
    });
    root.walkDecls((declaration) => {
      if (hasUnsupportedCssResource(declaration.value)) declaration.remove();
    });
    return root.toString();
  } catch {
    return '';
  }
}

function removeCssImports(css: string): string {
  try {
    const root = postcss.parse(css);
    root.walkAtRules(/^import$/i, (rule) => {
      rule.remove();
    });
    return root.toString();
  } catch {
    return '';
  }
}

function removeInlineCssImports(style: string): string {
  try {
    const root = postcss.parse(`.__render_policy__ { ${style} }`);
    root.walkAtRules(/^import$/i, (rule) => {
      rule.remove();
    });
    const rule = root.first;
    return rule?.type === 'rule' ? rule.nodes?.map((node) => node.toString()).join(' ') ?? '' : '';
  } catch {
    return '';
  }
}

function sanitizeInlineStyle(style: string): string {
  const sanitized = sanitizeStylesheet(`.__render_policy__ { ${style} }`);
  const declarations = postcss.parse(sanitized).first;
  if (!declarations || declarations.type !== 'rule') return '';
  return declarations.nodes?.map((node) => node.toString()).join(' ') ?? '';
}

/**
 * Apply the rendering resource allowlist after server-side asset inlining.
 * Only data:image resources survive on image elements and in CSS; imports,
 * browser-fetched media, and all other resource schemes are removed.
 */
export function applyRenderingResourcePolicy(html: string): string {
  const dom = new JSDOM(html);
  const { document } = dom.window;

  document.querySelectorAll('script, iframe, object, embed, link, base').forEach((element) => element.remove());
  document.querySelectorAll('meta[http-equiv="refresh" i]').forEach((element) => element.remove());

  document.querySelectorAll('*').forEach((element) => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc') {
        element.removeAttribute(attribute.name);
        continue;
      }

      if (name === 'style') {
        const style = sanitizeInlineStyle(attribute.value);
        if (style) element.setAttribute('style', style);
        else element.removeAttribute('style');
        continue;
      }

      if (name === 'srcset' || name === 'poster' || name === 'data' || name === 'src') {
        const isAllowedImageSource = element.tagName.toLowerCase() === 'img' && name === 'src' &&
          DATA_IMAGE_URL.test(attribute.value.trim());
        if (!isAllowedImageSource) element.removeAttribute(attribute.name);
        continue;
      }

      if ((name === 'href' || name === 'xlink:href') && element.namespaceURI === 'http://www.w3.org/2000/svg') {
        const value = attribute.value.trim();
        if (!value.startsWith('#') && !DATA_IMAGE_URL.test(value)) element.removeAttribute(attribute.name);
      }
    }
  });

  document.querySelectorAll('style').forEach((element) => {
    element.textContent = sanitizeStylesheet(element.textContent ?? '');
  });

  return `<!DOCTYPE html>${document.documentElement.outerHTML}`;
}

/**
 * Prepare HTML for isolated rendering by fetching remote image assets through
 * safeFetch and embedding only validated image bytes before Chromium sees it.
 */
export async function prepareHtmlForIsolatedRendering(
  html: string,
  opts: Pick<RenderHtmlToPngOptions, 'remoteAssets' | 'fetchAsset'> = {}
): Promise<string> {
  const beforeInlining = new JSDOM(html);
  beforeInlining.window.document.querySelectorAll('style').forEach((element) => {
    element.textContent = removeCssImports(element.textContent ?? '');
  });
  beforeInlining.window.document.querySelectorAll('[style]').forEach((element) => {
    element.setAttribute('style', removeInlineCssImports(element.getAttribute('style') ?? ''));
  });
  const withInlineAssets = await resolveRemoteAssets(beforeInlining.window.document.documentElement.outerHTML, opts);
  return applyRenderingResourcePolicy(withInlineAssets);
}

/** Apply the shared browser request boundary before setting page content. */
export async function configureIsolatedPage(page: Page): Promise<void> {
  await page.setJavaScriptEnabled(false);
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) {
      void request.continue();
      return;
    }
    void request.abort('blockedbyclient');
  });
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
  const safeHtml = await prepareHtmlForIsolatedRendering(html, opts);

  let browser;
  try {
    const puppeteerOptions: any = {
      headless: true,
      // --no-sandbox etc. are kept for the container runtime; they are unrelated to the SSRF
      // fix and intentionally out of scope for it.
      args: ISOLATED_RENDERER_BROWSER_ARGS,
    };

    // Use system chromium if available (Docker environment)
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      puppeteerOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    browser = await puppeteer.launch(puppeteerOptions);
    const page = await browser.newPage();
    await page.setViewport({ width, height });

    await configureIsolatedPage(page);

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
