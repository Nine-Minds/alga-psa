import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import {
  DOCUMENT_ROOM_RETRY_DELAYS_MS,
  DocumentRoomCredentialDeniedError,
  startDocumentRoomConnection,
} from '@alga-psa/documents/lib/documentRoomConnection';

class ProviderStub extends EventEmitter {
  configuration = { websocketProvider: { webSocket: null as WebSocket | null } };
  setConfiguration = vi.fn((configuration: Record<string, unknown>) => {
    Object.assign(this.configuration, configuration);
  });
  connect = vi.fn(async () => undefined);
  disconnect = vi.fn();
}

function createProvider() {
  return new ProviderStub() as unknown as HocuspocusProvider & ProviderStub;
}

const credential = (expiresInMs = 60_000) => ({ token: 'signed-credential', expiresAt: Date.now() + expiresInMs });

afterEach(() => vi.useRealTimers());

describe('document room credential renewal lifecycle', () => {
  it('bounds transient renewal retries and reports an actionable exhausted state', async () => {
    vi.useFakeTimers();
    const provider = createProvider();
    const failure = vi.fn();
    const issueCredential = vi.fn()
      .mockResolvedValueOnce(credential())
      .mockRejectedValue(new Error('credential service unavailable'));
    const connection = startDocumentRoomConnection(provider, issueCredential, failure);
    await connection.ready;

    await vi.advanceTimersByTimeAsync(48_000);
    for (const delay of DOCUMENT_ROOM_RETRY_DELAYS_MS) await vi.advanceTimersByTimeAsync(delay);

    expect(issueCredential).toHaveBeenCalledTimes(1 + DOCUMENT_ROOM_RETRY_DELAYS_MS.length + 1);
    expect(failure).toHaveBeenCalledTimes(1);
    expect(failure.mock.calls[0][0]).toMatchObject({
      message: expect.stringContaining('Check your connection and document access, then reload the editor.'),
    });
    expect(provider.configuration).toMatchObject({ preserveConnection: false });
    connection.stop();
  });

  it('does not retry a credential authorization denial', async () => {
    vi.useFakeTimers();
    const provider = createProvider();
    const failure = vi.fn();
    const denied = new DocumentRoomCredentialDeniedError('Permission denied: document access was revoked');
    const issueCredential = vi.fn().mockResolvedValueOnce(credential()).mockRejectedValue(denied);
    const connection = startDocumentRoomConnection(provider, issueCredential, failure);
    await connection.ready;

    await vi.advanceTimersByTimeAsync(48_000);

    expect(issueCredential).toHaveBeenCalledTimes(2);
    expect(failure).toHaveBeenCalledWith(denied);
    expect(provider.connect).toHaveBeenCalledTimes(1);
  });

  it('cancels a scheduled retry when the document lifecycle stops', async () => {
    vi.useFakeTimers();
    const provider = createProvider();
    const failure = vi.fn();
    const issueCredential = vi.fn().mockResolvedValueOnce(credential()).mockRejectedValue(new Error('offline'));
    const connection = startDocumentRoomConnection(provider, issueCredential, failure);
    await connection.ready;

    await vi.advanceTimersByTimeAsync(48_000);
    expect(issueCredential).toHaveBeenCalledTimes(2);
    connection.stop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(issueCredential).toHaveBeenCalledTimes(2);
    expect(failure).not.toHaveBeenCalled();
  });

  it('ignores a credential request that completes after teardown', async () => {
    let resolveCredential!: (value: ReturnType<typeof credential>) => void;
    const provider = createProvider();
    const issueCredential = vi.fn(() => new Promise<ReturnType<typeof credential>>(resolve => {
      resolveCredential = resolve;
    }));
    const connection = startDocumentRoomConnection(provider, issueCredential, vi.fn());

    connection.stop();
    resolveCredential(credential());
    await connection.ready;

    expect(provider.setConfiguration).toHaveBeenCalledTimes(1);
    expect(provider.setConfiguration).toHaveBeenCalledWith({ preserveConnection: false });
    expect(provider.connect).not.toHaveBeenCalled();
  });

  it('disconnects a connection attempt that completes after teardown', async () => {
    let resolveConnect!: () => void;
    const provider = createProvider();
    provider.connect = vi.fn(() => new Promise<void>(resolve => { resolveConnect = resolve; }));
    const connection = startDocumentRoomConnection(provider, async () => credential(), vi.fn());
    await Promise.resolve();
    await Promise.resolve();

    connection.stop();
    resolveConnect();
    await connection.ready;

    expect(provider.disconnect).toHaveBeenCalled();
    expect(provider.setConfiguration).toHaveBeenCalledTimes(2);
  });
});
