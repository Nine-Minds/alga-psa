import type { HocuspocusProvider } from '@hocuspocus/provider';

export interface DocumentRoomCredential {
  token: string;
  expiresAt: number;
}

/** A denied credential request is terminal; only transport/service failures retry. */
export class DocumentRoomCredentialDeniedError extends Error {
  readonly authorizationDenied = true;

  constructor(message: string) {
    super(message);
    this.name = 'DocumentRoomCredentialDeniedError';
  }
}

const RENEWAL_LEAD_MS = 60_000;
const CLOSE_WAIT_MS = 10_000;
export const DOCUMENT_ROOM_RETRY_DELAYS_MS = [250, 500, 1_000] as const;

function waitForSocketClose(
  provider: HocuspocusProvider,
  registerCancellation: (cancel: () => void) => void,
): Promise<void> {
  const socket = provider.configuration.websocketProvider;
  if (!socket.webSocket) {
    provider.disconnect();
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      socket.off('close', finish);
      resolve();
    };
    const timeout = setTimeout(() => {
      if (finished) return;
      finished = true;
      socket.off('close', finish);
      reject(new Error('Timed out closing the document socket for credential renewal.'));
    }, CLOSE_WAIT_MS);
    registerCancellation(finish);
    socket.on('close', finish);
    provider.disconnect();
  });
}

/** Connects with a server credential and rotates it before expiration. */
export function startDocumentRoomConnection(
  provider: HocuspocusProvider,
  issueCredential: () => Promise<DocumentRoomCredential>,
  onRenewalFailure: (error: unknown) => void,
): { ready: Promise<void>; stop: () => void } {
  // This lifecycle owns the socket. Hocuspocus only authenticates a document
  // once per socket, so disconnect must close it before rotating credentials.
  provider.setConfiguration({ preserveConnection: false });

  let stopped = false;
  let renewalTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveRetryWait: (() => void) | undefined;
  let cancelSocketWait: (() => void) | undefined;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (renewalTimer) clearTimeout(renewalTimer);
    renewalTimer = undefined;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = undefined;
    resolveRetryWait?.();
    resolveRetryWait = undefined;
    cancelSocketWait?.();
    cancelSocketWait = undefined;
    provider.off('authenticationFailed', handleAuthenticationFailed);
  };

  const handleAuthenticationFailed = () => stop();
  provider.on('authenticationFailed', handleAuthenticationFailed);

  const scheduleRenewal = (expiresAt: number) => {
    if (renewalTimer) clearTimeout(renewalTimer);
    const remaining = Math.max(0, expiresAt - Date.now());
    const lead = Math.min(RENEWAL_LEAD_MS, remaining / 5);
    renewalTimer = setTimeout(() => {
      renewalTimer = undefined;
      if (!stopped) void runConnection(0, false);
    }, Math.max(1, remaining - lead));
  };

  const waitForRetry = (delayMs: number) => new Promise<void>(resolve => {
    resolveRetryWait = resolve;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      resolveRetryWait = undefined;
      resolve();
    }, delayMs);
  });

  const finishWithFailure = (error: unknown) => {
    if (stopped) return;
    stop();
    onRenewalFailure(error);
  };

  const runConnection = async (retryIndex: number, initial: boolean): Promise<void> => {
    if (stopped) return;
    try {
      const credential = await issueCredential();
      if (stopped) return;

      provider.setConfiguration({ token: credential.token });
      if (!initial) {
        await waitForSocketClose(provider, cancel => { cancelSocketWait = cancel; });
        cancelSocketWait = undefined;
        if (stopped) return;
      }

      await provider.connect();
      if (stopped) {
        provider.disconnect();
        return;
      }
      scheduleRenewal(credential.expiresAt);
    } catch (error) {
      if (stopped) return;
      provider.disconnect();

      if (error instanceof DocumentRoomCredentialDeniedError) {
        if (initial) throw error;
        finishWithFailure(error);
        return;
      }

      if (retryIndex < DOCUMENT_ROOM_RETRY_DELAYS_MS.length) {
        await waitForRetry(DOCUMENT_ROOM_RETRY_DELAYS_MS[retryIndex]);
        if (!stopped) await runConnection(retryIndex + 1, initial);
        return;
      }

      const exhausted = new Error(
        `Unable to renew collaborative editing credentials after ${retryIndex + 1} attempts. Check your connection and document access, then reload the editor.`,
        { cause: error },
      );
      if (initial) throw exhausted;
      finishWithFailure(exhausted);
    }
  };

  const ready = runConnection(0, true);
  return { ready, stop };
}
