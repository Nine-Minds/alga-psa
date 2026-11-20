import type { HocuspocusProvider } from '@hocuspocus/provider';

export interface DocumentRoomCredential {
  token: string;
  expiresAt: number;
}

const RENEWAL_LEAD_MS = 60_000;
const RECONNECT_GRACE_MS = 100;
const CLOSE_WAIT_MS = 500;

function waitForSocketClose(provider: HocuspocusProvider): Promise<void> {
  if (!provider.isConnected) return Promise.resolve();
  return new Promise(resolve => {
    let timeout: ReturnType<typeof setTimeout>;
    const finish = () => {
      clearTimeout(timeout);
      provider.off('close', finish);
      resolve();
    };
    provider.on('close', finish);
    timeout = setTimeout(finish, CLOSE_WAIT_MS);
    provider.disconnect();
  });
}

/** Connects with a server credential and rotates it before expiration. */
export function startDocumentRoomConnection(
  provider: HocuspocusProvider,
  issueCredential: () => Promise<DocumentRoomCredential>,
  onRenewalDenied: (error: unknown) => void,
): { ready: Promise<void>; stop: () => void } {
  let stopped = false;
  let renewalTimer: ReturnType<typeof setTimeout> | undefined;

  const stop = () => {
    stopped = true;
    if (renewalTimer) clearTimeout(renewalTimer);
    provider.off('authenticationFailed', handleAuthenticationFailed);
  };

  const handleAuthenticationFailed = () => stop();
  provider.on('authenticationFailed', handleAuthenticationFailed);

  const scheduleRenewal = (expiresAt: number) => {
    if (renewalTimer) clearTimeout(renewalTimer);
    const remaining = Math.max(0, expiresAt - Date.now());
    const lead = Math.min(RENEWAL_LEAD_MS, remaining / 5);
    renewalTimer = setTimeout(() => { void renew(); }, Math.max(1, remaining - lead));
  };

  const renew = async () => {
    try {
      const credential = await issueCredential();
      if (stopped) return;

      provider.setConfiguration({ token: credential.token });
      await waitForSocketClose(provider);
      await new Promise(resolve => setTimeout(resolve, RECONNECT_GRACE_MS));
      if (stopped) return;

      await provider.connect();
      scheduleRenewal(credential.expiresAt);
    } catch (error) {
      if (stopped) return;
      provider.disconnect();
      onRenewalDenied(error);
    }
  };

  const ready = issueCredential().then(async credential => {
    if (stopped) return;
    provider.setConfiguration({ token: credential.token });
    await provider.connect();
    scheduleRenewal(credential.expiresAt);
  });

  return { ready, stop };
}
