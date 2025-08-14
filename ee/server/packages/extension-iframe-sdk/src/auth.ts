import { IframeBridge } from './bridge';
import type { HostToClientMessage } from './types';

/**
 * Returns the current short-lived session token after bootstrap.
 * Resolves immediately if already available, otherwise waits for the next bootstrap.
 */
export function getToken(bridge: IframeBridge): Promise<string> {
  const existing = bridge.getSessionToken?.();
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    const off = bridge.on((evt: HostToClientMessage) => {
      if (evt.type === 'bootstrap' && evt.payload.session.token) {
        off();
        resolve(evt.payload.session.token);
      }
    });
  });
}

