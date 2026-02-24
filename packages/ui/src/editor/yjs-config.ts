import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';

/**
 * Build the Hocuspocus WebSocket URL.
 *
 * Priority:
 *   1. NEXT_PUBLIC_HOCUSPOCUS_URL env var (full URL, e.g. "wss://algapsa.com/hocuspocus")
 *   2. In the browser: derive from window.location (same domain, /hocuspocus path)
 *   3. Fallback for local dev: ws://localhost:1234
 */
function getHocuspocusUrl(): string {
  // Explicit env var (must be NEXT_PUBLIC_ to reach the client bundle)
  const envUrl = process.env.NEXT_PUBLIC_HOCUSPOCUS_URL;
  if (envUrl) return envUrl;

  // Browser: derive from current origin
  if (typeof window !== 'undefined') {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/hocuspocus`;
  }

  // SSR / local dev fallback
  return 'ws://localhost:1234';
}

type YjsProviderOptions = {
  parameters?: Record<string, string>;
  token?: string | null;
};

export const createYjsProvider = (roomName: string, options: YjsProviderOptions = {}) => {
  const ydoc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: getHocuspocusUrl(),
    name: roomName,
    document: ydoc,
    parameters: options.parameters ?? {},
    token: options.token ?? null,
  });

  return { ydoc, provider };
};
