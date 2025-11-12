/**
 * Host-side iframe bridge bootstrap to securely initialize extension iframes.
 *
 * Behavior:
 * - Validates contentHash format
 * - Enforces origin validation when RUNNER_PUBLIC_BASE is absolute and allowedOrigin provided
 * - Sets sandbox="allow-scripts" unless explicitly provided by author (never add allow-same-origin by default)
 * - Injects theme tokens into the parent document :root and also sends them to the iframe via postMessage
 * - Sends versioned bootstrap envelope to the iframe on load or after a "ready" handshake from client
 * - Listens for resize and navigate messages from the child (validated envelope), applies height and optional src param updates
 *
 * Security:
 * - Never uses targetOrigin="*" except in dev explicitly guarded via NODE_ENV !== 'production' or global __ALGA_DEV__ flag
 */

import { buildExtUiSrc as buildExtUiSrcShared } from '../assets/url.shared';

const ENVELOPE_VERSION = '1' as const;
const HASH_REGEX = /^sha256:[0-9a-f]{64}$/i;
const THEME_STYLE_ID = 'alga-ext-theme-tokens';
const MIN_IFRAME_HEIGHT = 100;
const MAX_IFRAME_HEIGHT = 4000;

export interface IframeBootstrapOptions {
  iframe: HTMLIFrameElement;
  extensionId: string;
  contentHash: string; // must match /^sha256:[0-9a-f]{64}$/i
  initialPath?: string; // e.g. "/settings"
  session: { token: string; expiresAt: string }; // short-lived JWT or service token
  themeTokens: Record<string, string>; // CSS variables (e.g. --alga-color-primary)
  allowedOrigin?: string; // absolute origin expected for the iframe app (required when RUNNER_PUBLIC_BASE absolute)
  requestId?: string; // optional correlation id forwarded in bootstrap
}

/**
 * Build ext UI iframe src. Delegate to shared single-source-of-truth.
 */
export function buildExtUiSrc(
  extensionId: string,
  contentHash: string,
  clientPath: string,
  opts?: { tenantId?: string; publicBaseOverride?: string }
): string {
  return buildExtUiSrcShared(extensionId, contentHash, clientPath || '/', opts);
}

/**
 * Bootstrap an iframe hosting an extension UI.
 */
export function bootstrapIframe(opts: IframeBootstrapOptions): void {
  const {
    iframe,
    extensionId,
    contentHash,
    initialPath = '/',
    session,
    themeTokens,
    allowedOrigin,
    requestId,
  } = opts;

  if (!iframe || !(iframe instanceof HTMLIFrameElement)) {
    throw new Error('bootstrapIframe: opts.iframe must be an HTMLIFrameElement');
  }

  if (!HASH_REGEX.test(contentHash)) {
    throw new Error("bootstrapIframe: Invalid contentHash; expected format 'sha256:<hex64>'");
  }

  const devWildcard =
    (typeof window !== 'undefined' && (window as any).__ALGA_DEV__ === true) ||
    (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production');

  // Ensure sandbox attribute: default to allow-scripts only if author hasn't provided one.
  if (!iframe.hasAttribute('sandbox')) {
    // IMPORTANT: Do NOT include allow-same-origin by default. Authors must opt-in after security review.
    iframe.setAttribute('sandbox', 'allow-scripts');
  }

  // Derive iframe src and origin for validation and targetOrigin enforcement.
  const iframeSrc = iframe.getAttribute('src') || '';
  const srcUrl = safeParseUrl(iframeSrc, window.location.origin);

  // If RUNNER_PUBLIC_BASE is set and absolute, require allowedOrigin to match src origin exactly.
  const runnerBase = process.env.RUNNER_PUBLIC_BASE || '';
  const isRunnerBaseAbsolute = isAbsoluteUrl(runnerBase);

  if (isRunnerBaseAbsolute) {
    if (!allowedOrigin) {
      throw new Error('bootstrapIframe: allowedOrigin is required when RUNNER_PUBLIC_BASE is absolute');
    }
    if (!srcUrl) {
      throw new Error('bootstrapIframe: iframe src must be set before bootstrap when RUNNER_PUBLIC_BASE is absolute');
    }
    const srcOrigin = srcUrl.origin;
    if (allowedOrigin !== srcOrigin) {
      throw new Error(`bootstrapIframe: allowedOrigin mismatch. expected='${allowedOrigin}' actual='${srcOrigin}'`);
    }
  } else {
    // When src is relative or same-origin, avoid cross-origin assumptions beyond same-origin heuristics.
    // Documentation note: relative src assumes same-origin delivery by server; no cross-origin enforcement applied here.
  }

  // Inject theme tokens into parent document as :root CSS variables
  injectThemeIntoParent(themeTokens);

  // Also send tokens via postMessage so child can fall back
  const targetOrigin = deriveTargetOrigin({ srcUrl, allowedOrigin, devWildcard });

  // Build bootstrap envelope
  const bootstrapEnvelope = {
    alga: true,
    version: ENVELOPE_VERSION,
    type: 'bootstrap',
    request_id: requestId,
    payload: {
      session: { token: session.token, expires_at: session.expiresAt },
      theme_tokens: themeTokens,
      navigation: { path: initialPath || '/' },
    },
  } as const;

  // Send bootstrap on load OR after a 'ready' handshake, whichever occurs
  const onLoad = () => {
    try {
      postToIframe(iframe, bootstrapEnvelope, targetOrigin);
    } catch {
      // ignore
    }
  };

  // Attach load listener once
  const loadHandler = () => {
    onLoad();
  };
  iframe.addEventListener('load', loadHandler, { once: true });

  // Listen to child messages for:
  // - ready: send bootstrap
  // - resize: apply height with clamping
  // - navigate: optionally update ?path param (may cause reload)
  const messageHandler = (ev: MessageEvent) => {
    // Origin validation for incoming messages from this iframe only
    if (!srcUrl) return;
    // Only accept messages that originated from the same browsing context of this iframe's contentWindow
    if (iframe.contentWindow && ev.source !== iframe.contentWindow) return;

    // Enforce origin match if absolute origins are being used; otherwise only heuristic
    if (allowedOrigin && ev.origin !== allowedOrigin) return;
    if (!allowedOrigin && isRunnerBaseAbsolute && srcUrl && ev.origin !== srcUrl.origin) return;

    const data = ev.data as any;
    if (!data || typeof data !== 'object') return;
    if (data.alga !== true || data.version !== ENVELOPE_VERSION || typeof data.type !== 'string') return;

    switch (data.type) {
      case 'ready': {
        onLoad();
        break;
      }
      case 'resize': {
        const raw = Number(data.payload?.height);
        if (Number.isFinite(raw)) {
          const clamped = Math.max(MIN_IFRAME_HEIGHT, Math.min(MAX_IFRAME_HEIGHT, Math.floor(raw)));
          (iframe.style as any).height = `${clamped}px`;
        }
        break;
      }
      case 'navigate': {
        const path = String(data.payload?.path || '');
        if (path) {
          tryUpdateIframePath(iframe, path);
        }
        break;
      }
      default:
        // Unknown type ignored
        break;
    }
  };

  window.addEventListener('message', messageHandler);

  // Cleanup helper if needed by caller (not exported; documented usage can remove listener manually if creating multiple bootstraps)
  // Authors embedding multiple iframes should manage lifecycle and remove event listeners explicitly if detaching.
}

/**
 * Helpers
 */

function injectThemeIntoParent(tokens: Record<string, string>): void {
  const doc = window.document;
  const head = doc.head || doc.getElementsByTagName('head')[0];
  const root = doc.documentElement;

  // Apply inline to :root style for immediate effect
  Object.entries(tokens || {}).forEach(([k, v]) => {
    try {
      root.style.setProperty(k, String(v));
    } catch {
      // ignore invalid css var names
    }
  });

  // Maintain a dedicated <style> block so tokens persist if other code overwrites inline styles
  let styleEl = doc.getElementById(THEME_STYLE_ID) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = doc.createElement('style');
    styleEl.id = THEME_STYLE_ID;
    head.appendChild(styleEl);
  }

  const cssVars = Object.entries(tokens || {})
    .map(([k, v]) => `${k}: ${String(v)};`)
    .join(' ');
  styleEl.textContent = `:root { ${cssVars} }`;
}

function deriveTargetOrigin(params: {
  srcUrl: URL | null;
  allowedOrigin?: string;
  devWildcard: boolean;
}): string {
  const { srcUrl, allowedOrigin, devWildcard } = params;
  if (devWildcard) {
    // Dev/test only. Never use "*" in production.
    return '*';
  }
  if (allowedOrigin) return allowedOrigin;
  if (srcUrl) return srcUrl.origin;
  // Fallback (should not generally happen if src is set)
  return window.location.origin;
}

function postToIframe(iframe: HTMLIFrameElement, message: any, targetOrigin: string): void {
  if (!iframe.contentWindow) return;
  iframe.contentWindow.postMessage(message, targetOrigin);
}

function tryUpdateIframePath(iframe: HTMLIFrameElement, clientPath: string): void {
  const current = iframe.getAttribute('src') || '';
  const base = window.location.origin;
  const url = safeParseUrl(current, base);
  if (!url) return;

  // Update only the 'path' query parameter. Note: this may cause a reload.
  const sp = url.searchParams;
  sp.set('path', clientPath || '/');
  url.search = sp.toString();

  iframe.setAttribute('src', url.toString());
  // Caveat: this will reload the iframe. Authors should consider routing inside the app to avoid reloads.
}

function safeParseUrl(href: string, base: string): URL | null {
  try {
    if (!href) return null;
    // Supports relative by providing base
    return new URL(href, base);
  } catch {
    return null;
  }
}

function isAbsoluteUrl(maybe: string): boolean {
  try {
    const u = new URL(maybe);
    return !!u.protocol && !!u.host;
  } catch {
    return false;
  }
}
