import { useEffect, useMemo, useState } from 'react';
import { IframeBridge } from './bridge';

export function useBridge(): IframeBridge {
  // one bridge per component tree
  return useMemo(() => new IframeBridge(), []);
}

export function useTheme(bridge: IframeBridge): Record<string, string> | null {
  const [theme, setTheme] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    const off = bridge.on((evt: any) => { if (evt.type === 'theme') setTheme(evt.payload || {}); });
    return () => { off(); };
  }, [bridge]);
  return theme;
}

export function useAuthToken(bridge: IframeBridge): string | null {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    const off = bridge.on((evt: any) => { if (evt.type === 'auth' && evt.payload?.token) setToken(evt.payload.token); });
    bridge.emitToHost('auth.request', {});
    return () => { off(); };
  }, [bridge]);
  return token;
}

export function useResize(bridge: IframeBridge): (height: number) => void {
  return useMemo(() => (h: number) => bridge.emitToHost('resize', { height: h }), [bridge]);
}
