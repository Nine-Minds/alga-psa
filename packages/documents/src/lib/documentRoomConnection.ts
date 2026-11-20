import type { HocuspocusProvider } from '@hocuspocus/provider';

export interface DocumentRoomCredential {
  token: string;
  expiresAt: number;
}

const RENEWAL_LEAD_MS = 60_000;
const CLOSE_WAIT_MS = 10_000;

function waitForSocketClose(provider: HocuspocusProvider): Promise<void> {
  const socket = provider.configuration.websocketProvider;
  if (!socket.webSocket) {
    provider.disconnect();
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const finish = () => {
      clearTimeout(timeout);
      socket.off('close', finish);
      resolve();
    };
    const timeout = setTimeout(() => {
      socket.off('close', finish);
      reject(new Error('Timed out closing the document socket for credential renewal.'));
    }, CLOSE_WAIT_MS);
    socket.on('close', finish);
    provider.disconnect();
  });
}

/** Connects with a server credential and rotates it before expiration. */
export function startDocumentRoomConnection(
  provider: HocuspocusProvider,
  issueCredential: () => Promise<DocumentRoomCredential>,
  onRenewalDenied: (error: unknown) => void,
): { ready: Promise<void>; stop: () => void } {
  // This lifecycle owns the socket. Hocuspocus only authenticates a document
  // once per socket, so disconnect must close it before rotating credentials.
  provider.setConfiguration({ preserveConnection: false });

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
