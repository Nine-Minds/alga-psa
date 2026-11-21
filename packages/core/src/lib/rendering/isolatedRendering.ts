import type { Page } from 'puppeteer';
import { JSDOM } from 'jsdom';
import postcss from 'postcss';
import valueParser from 'postcss-value-parser';
import { fetchPublicBytes } from '../net/safeFetch';

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

export interface IsolatedRenderingOptions {
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

type AssetResolver = (url: string) => Promise<string | null>;

function makeResolver(opts: IsolatedRenderingOptions): AssetResolver {
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
  opts: IsolatedRenderingOptions = {}
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
  opts: IsolatedRenderingOptions = {}
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

