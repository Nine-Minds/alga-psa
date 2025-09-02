/**
 * Minimal host-side iframe bridge for domain-forwarded extensions.
 *
 * Keeps only essentials:
 * - Optional sandbox defaulting (allow-scripts) if none provided
 * - Strict origin + source validation for incoming postMessages
 * - Resize handling with height clamping
 */

const MIN_IFRAME_HEIGHT = 100;
const MAX_IFRAME_HEIGHT = 4000;

export interface IframeBootstrapOptions {
  iframe: HTMLIFrameElement;
  allowedOrigin?: string; // if omitted, derived from iframe src
  minHeight?: number;
  maxHeight?: number;
}

export function bootstrapIframe(opts: IframeBootstrapOptions): void {
  const { iframe, allowedOrigin, minHeight = MIN_IFRAME_HEIGHT, maxHeight = MAX_IFRAME_HEIGHT } = opts;

  if (!iframe || !(iframe instanceof HTMLIFrameElement)) {
    throw new Error('bootstrapIframe: opts.iframe must be an HTMLIFrameElement');
  }

  // Ensure sandbox attribute: default to allow-scripts only if author hasn't provided one.
  if (!iframe.hasAttribute('sandbox')) {
    iframe.setAttribute('sandbox', 'allow-scripts, allow-same-origin');
  }

  // Derive origin from src if not provided
  const iframeSrc = iframe.getAttribute('src') || '';
  const srcUrl = safeParseUrl(iframeSrc, window.location.origin);
  const acceptedOrigin = allowedOrigin || (srcUrl ? srcUrl.origin : undefined);

  const onMessage = (ev: MessageEvent) => {
    // Validate source window
    if (iframe.contentWindow && ev.source !== iframe.contentWindow) return;
    // Validate origin if known
    if (acceptedOrigin && ev.origin !== acceptedOrigin) return;

    const data: any = ev.data;
    if (!data || typeof data !== 'object') return;

    // Expect shape: { type: 'resize', payload: { height } }
    if (data.type === 'resize') {
      const raw = Number(data.payload?.height);
      if (Number.isFinite(raw)) {
        const clamped = Math.max(minHeight, Math.min(maxHeight, Math.floor(raw)));
        (iframe.style as any).height = `${clamped}px`;
      }
    }
  };

  window.addEventListener('message', onMessage);
}

function safeParseUrl(href: string, base: string): URL | null {
  try {
    if (!href) return null;
    return new URL(href, base);
  } catch {
    return null;
  }
}
