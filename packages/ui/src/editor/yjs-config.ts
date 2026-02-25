import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';

/**
 * Build the Hocuspocus WebSocket URL.
 *
 * Priority:
 *   1. NEXT_PUBLIC_HOCUSPOCUS_URL env var (full URL, e.g. "wss://algapsa.com/hocuspocus")
 *   2. Server-side only: HOCUSPOCUS_INTERNAL_URL (e.g. "ws://hocuspocus:1234" for Docker service networking)
 *   3. In the browser (production): derive from window.location (same domain, /hocuspocus path)
 *   4. Fallback for local dev: ws://localhost:1234
 */
function getHocuspocusUrl(): string {
  // Explicit env var (must be NEXT_PUBLIC_ to reach the client bundle)
  const envUrl = process.env.NEXT_PUBLIC_HOCUSPOCUS_URL;
  if (envUrl) return envUrl;

  // Server-side: use internal URL for container-to-container communication
  // (not prefixed with NEXT_PUBLIC_ so it stays server-only)
  if (typeof window === 'undefined') {
    const internalUrl = process.env.HOCUSPOCUS_INTERNAL_URL;
    if (internalUrl) return internalUrl;
  }

  // Browser in production: derive from current origin (assumes reverse proxy at /hocuspocus)
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost') {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/hocuspocus`;
  }

  // Local dev fallback
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
