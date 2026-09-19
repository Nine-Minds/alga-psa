import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';

/**
 * Build the Hocuspocus WebSocket URL.
 *
 * Selection is driven by NODE_ENV, never by sniffing the browser hostname, so
 * a dev server reached over a LAN/tailnet address still targets the configured
 * local Hocuspocus instance instead of deriving a same-origin URL.
 *
 * Development: NEXT_PUBLIC_HOCUSPOCUS_URL, defaulting to ws://localhost:1234.
 * Production: NEXT_PUBLIC_HOCUSPOCUS_URL, otherwise the same-origin
 *   ws(s)://{host}/hocuspocus URL (assuming a reverse proxy at /hocuspocus).
 */
function getHocuspocusUrl(): string {
  // Explicit env var (must be NEXT_PUBLIC_ to reach the client bundle).
  const envUrl = process.env.NEXT_PUBLIC_HOCUSPOCUS_URL;

  if (process.env.NODE_ENV !== 'production') {
    return envUrl || 'ws://localhost:1234';
  }

  if (envUrl) return envUrl;

  if (typeof window !== 'undefined') {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/hocuspocus`;
  }

  // Server-side production: use internal URL for container-to-container
  // communication (not prefixed with NEXT_PUBLIC_ so it stays server-only).
  const internalUrl = process.env.HOCUSPOCUS_INTERNAL_URL;
  if (internalUrl) return internalUrl;

  return 'ws://localhost:1234';
}

type YjsProviderOptions = {
  parameters?: Record<string, string>;
  token?: string | (() => string) | (() => Promise<string>) | null;
  connect?: boolean;
  preserveConnection?: boolean;
  delay?: number;
  initialDelay?: number;
  factor?: number;
  maxAttempts?: number;
  maxDelay?: number;
  jitter?: boolean;
};

export const createYjsProvider = (roomName: string, options: YjsProviderOptions = {}) => {
  const ydoc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: getHocuspocusUrl(),
    name: roomName,
    document: ydoc,
    parameters: options.parameters ?? {},
    token: options.token ?? null,
    connect: options.connect ?? true,
    preserveConnection: options.preserveConnection ?? true,
    delay: options.delay,
    initialDelay: options.initialDelay,
    factor: options.factor,
    maxAttempts: options.maxAttempts,
    maxDelay: options.maxDelay,
    jitter: options.jitter,
  } as any);

  return { ydoc, provider };
};
