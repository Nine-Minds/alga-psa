import { IframeBridge } from './bridge';

export function applyTheme(vars: Record<string, string>) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
}

export function subscribeTheme(bridge: IframeBridge) {
  return bridge.on((evt: any) => {
    if (evt.type === 'theme') applyTheme(evt.payload || {});
  });
}

