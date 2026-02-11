/**
 * Minimal host-side iframe bridge for domain-forwarded extensions.
 *
 * Keeps only essentials:
 * - Optional sandbox defaulting (allow-scripts) if none provided
 * - Strict origin + source validation for incoming postMessages
 * - Resize handling with height clamping
 * - API Proxy forwarding (apiproxy -> /api/ext-proxy/...)
 */

const MIN_IFRAME_HEIGHT = 100;
const MAX_IFRAME_HEIGHT = 4000;
type ProxyMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
const ALLOWED_PROXY_METHODS = new Set<ProxyMethod>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

export interface IframeBootstrapOptions {
  iframe: HTMLIFrameElement;
  extensionId?: string; // Required for API proxy
  allowedOrigin?: string; // if omitted, derived from iframe src
  minHeight?: number;
  maxHeight?: number;
}

export function bootstrapIframe(opts: IframeBootstrapOptions): () => void {
  const { iframe, extensionId, allowedOrigin, minHeight = MIN_IFRAME_HEIGHT, maxHeight = MAX_IFRAME_HEIGHT } = opts;

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
    console.log('iframeBridge: received message', { type: data.type, origin: ev.origin });

    // Expect shape: { type: 'resize', payload: { height } }
    if (data.type === 'resize') {
      const raw = Number(data.payload?.height);
      if (Number.isFinite(raw)) {
        const clamped = Math.max(minHeight, Math.min(maxHeight, Math.floor(raw)));
        (iframe.style as any).height = `${clamped}px`;
      }
    }

    // Expect shape: { type: 'apiproxy', payload: { route, body? }, request_id }
    if (data.type === 'apiproxy') {
      console.log('iframeBridge: handling apiproxy', {
        requestId: data.request_id,
        route: data.payload?.route,
        method: data.payload?.method,
      });
      handleApiProxy(iframe, extensionId, data, acceptedOrigin);
    }
  };

  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}

function safeParseUrl(href: string, base: string): URL | null {
  try {
    if (!href) return null;
    return new URL(href, base);
  } catch {
    return null;
  }
}

function resolveProxyMethod(method: unknown): ProxyMethod {
  if (typeof method !== 'string' || method.trim().length === 0) {
    // Backward compatibility for older SDK payloads.
    return 'POST';
  }
  const normalized = method.toUpperCase();
  if (ALLOWED_PROXY_METHODS.has(normalized as ProxyMethod)) {
    return normalized as ProxyMethod;
  }
  throw new Error(`Unsupported proxy method: ${method}`);
}

async function handleApiProxy(
  iframe: HTMLIFrameElement,
  extensionId: string | undefined,
  data: any,
  targetOrigin?: string,
) {
  const { request_id, payload } = data;
  if (!request_id || !extensionId) return; // Cannot handle without ID

  const route = payload?.route || '';
  const bodyB64 = payload?.body;
  const method = resolveProxyMethod(payload?.method);

  const responseMsg = {
    alga: true,
    version: '1',
    type: 'apiproxy_response',
    request_id,
    payload: {} as any,
  };

  try {
    // Clean route
    const cleanRoute = route.startsWith('/') ? route : `/${route}`;
    const url = `/api/ext-proxy/${extensionId}${cleanRoute}`;

    // Prepare body bytes if present
    let bodyBytes: Uint8Array | undefined;
    if (bodyB64) {
      const binString = atob(bodyB64);
      bodyBytes = new Uint8Array(binString.length);
      for (let i = 0; i < binString.length; i++) {
        bodyBytes[i] = binString.charCodeAt(i);
      }
    }

    const hasBody = method !== 'GET' && !!bodyBytes;
    const res = await fetch(url, {
      method,
      headers: hasBody
        ? {
            'content-type': 'application/octet-stream',
          }
        : undefined,
      body: hasBody ? new Blob([bodyBytes as any]) : undefined,
    });
    console.log('iframeBridge: fetch completed', { status: res.status, ok: res.ok, url, method });

    if (!res.ok) {
      // Try to read error text
      const errText = await res.text().catch(() => res.statusText);
      console.warn('iframeBridge: proxy error', { status: res.status, errText });
      responseMsg.payload = { error: `Proxy error ${res.status}: ${errText}` };
    } else {
      // Read success body as blob -> base64
      const blob = await res.blob();
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64data = (reader.result as string).split(',')[1];
        responseMsg.payload = { body: base64data };
        console.log('iframeBridge: posting apiproxy_response (reader)', { requestId: request_id, targetOrigin: '*' });
        iframe.contentWindow?.postMessage(responseMsg, '*');
      };
      reader.onerror = () => {
        responseMsg.payload = { error: 'Failed to read response blob' };
        iframe.contentWindow?.postMessage(responseMsg, '*');
      };
      reader.readAsDataURL(blob);
      return; // Deferred send in callback
    }
  } catch (err: any) {
    console.error('iframeBridge: proxy fetch failed', err);
    responseMsg.payload = { error: String(err?.message || err) };
  }

  // Send (if not deferred by FileReader)
  console.log('iframeBridge: posting apiproxy_response', { requestId: request_id, targetOrigin: '*' });
  iframe.contentWindow?.postMessage(responseMsg, '*');
}
