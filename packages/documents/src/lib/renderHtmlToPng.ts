import puppeteer, { type Browser } from 'puppeteer';
import type { Page } from 'puppeteer';
import createDOMPurify from 'dompurify';
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
const DATA_IMAGE_URL = /^data:image\//i;

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
  // Retain the shared network-isolation flags while preferring Chromium's sandbox
  // whenever this runtime supports it. The pooled PDF renderer uses the exported
  // argument list directly for root/container compatibility.
  const args = ISOLATED_RENDERER_BROWSER_ARGS.filter(
    (argument) => argument !== '--no-sandbox' && argument !== '--disable-setuid-sandbox'
  );
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

function isCssImportRule(rule: { name: string; params: string }): boolean {
  // PostCSS currently stops rule.name at a backslash, leaving the escaped tail
  // of an at-rule identifier at the beginning of params (for example,
  // `@im\\70ort ...` becomes name=`im`, params=`\\70ort ...`). Reassemble
  // that identifier before applying the resource policy.
  const escapedIdentifierTail = rule.params.startsWith('\\')
    ? rule.params.match(/^(?:\\(?:[\da-f]{1,6}\s?|[^\r\n\f])|[-_a-z\d])+/i)?.[0] ?? ''
    : '';
  return decodeCssEscapes(`${rule.name}${escapedIdentifierTail}`).toLowerCase() === 'import';
}

function serializeInlineDeclarations(nodes: Array<{ toString(): string }> | undefined): string {
  return nodes?.map((node) => node.toString()).join('; ') ?? '';
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
      if (isCssImportRule(rule) || hasUnsupportedCssResource(rule.params)) {
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
    root.walkAtRules((rule) => {
      if (isCssImportRule(rule)) rule.remove();
    });
    return root.toString();
  } catch {
    return '';
  }
}

function removeInlineCssImports(style: string): string {
  try {
    const root = postcss.parse(`.__render_policy__ { ${style} }`);
    root.walkAtRules((rule) => {
      if (isCssImportRule(rule)) rule.remove();
    });
    const rule = root.first;
    return rule?.type === 'rule' ? serializeInlineDeclarations(rule.nodes) : '';
  } catch {
    return '';
  }
}

function sanitizeInlineStyle(style: string): string {
  const sanitized = sanitizeStylesheet(`.__render_policy__ { ${style} }`);
  const declarations = postcss.parse(sanitized).first;
  if (!declarations || declarations.type !== 'rule') return '';
  return serializeInlineDeclarations(declarations.nodes);
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
export async function renderHtmlToPng(content: RenderContent, opts: RenderHtmlToPngOptions = {}): Promise<Buffer> {
  const width = opts.width ?? 400;
  const height = opts.height ?? 300;
  let browser: Browser | undefined;
  try {
    // Escape structured values and sanitize all supported rich HTML before resolving image URLs.
    const sanitizedHtml = toHtml(content);
    const safeHtml = await withTimeout(prepareHtmlForIsolatedRendering(sanitizedHtml, opts), 6000, 'Asset resolution');
    browser = await launchBrowser();
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
