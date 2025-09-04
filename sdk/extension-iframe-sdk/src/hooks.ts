import { useEffect, useMemo, useState } from 'react';
import { IframeBridge } from './bridge';
import type { HostToClientMessage } from './types';

/**
 * Provides a single bridge instance per component tree and signals readiness.
 */
export function useBridge(): IframeBridge {
  const bridge = useMemo(() => new IframeBridge(), []);
  useEffect(() => {
    // Send ready handshake once mounted
    bridge.ready();
  }, [bridge]);
  return bridge;
}

/**
 * Returns theme tokens provided by the parent via bootstrap.
 * Applies last-known tokens from the bridge immediately if available.
 */
export function useTheme(bridge: IframeBridge): Record<string, string> | null {
  const [theme, setTheme] = useState<Record<string, string> | null>(() => {
    const initial = bridge.getThemeTokens?.();
    return initial && Object.keys(initial).length > 0 ? initial : null;
  });

  useEffect(() => {
    const off = bridge.on((evt: HostToClientMessage) => {
      if (evt.type === 'bootstrap') {
        const tokens = evt.payload?.theme_tokens ?? {};
        setTheme(tokens);
      }
    });
    return () => { off(); };
  }, [bridge]);

  return theme;
}

/**
 * Returns the short-lived session token from bootstrap, and updates when refreshed.
 */
export function useAuthToken(bridge: IframeBridge): string | null {
  const [token, setToken] = useState<string | null>(() => bridge.getSessionToken?.() ?? null);

  useEffect(() => {
    const off = bridge.on((evt: HostToClientMessage) => {
      if (evt.type === 'bootstrap' && evt.payload?.session?.token) {
        setToken(evt.payload.session.token);
      }
    });
    return () => { off(); };
  }, [bridge]);

  return token;
}

/**
 * Emits resize notifications to the parent with protocol envelope.
 */
export function useResize(bridge: IframeBridge): (height: number) => void {
  return useMemo(() => (h: number) => bridge.emitToHost('resize', { height: h }), [bridge]);
}

