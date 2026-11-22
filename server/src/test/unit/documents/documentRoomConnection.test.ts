import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
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
  it('connects and tears down through the package export without server aliases', () => {
    // Vitest's source aliases bypass package exports. Exercise a real consumer
    // in Node so an unpublished entry cannot be hidden by those aliases.
    execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { EventEmitter } from 'node:events';
      import { startDocumentRoomConnection } from '@alga-psa/documents/lib/documentRoomConnection';

      let connected = false;
      const provider = Object.assign(new EventEmitter(), {
        configuration: { websocketProvider: { webSocket: null } },
        setConfiguration(config) { Object.assign(this.configuration, config); },
        async connect() { connected = true; },
        disconnect() {},
      });
      const connection = startDocumentRoomConnection(
        provider,
        async () => ({ token: 'consumer-credential', expiresAt: Date.now() + 60_000 }),
        error => { throw error; },
      );
      try {
        await connection.ready;
        assert.equal(connected, true);
        assert.equal(provider.configuration.token, 'consumer-credential');
        assert.equal(provider.configuration.preserveConnection, false);
        assert.equal(provider.listenerCount('authenticationFailed'), 1);
      } finally {
        connection.stop();
      }
      assert.equal(provider.listenerCount('authenticationFailed'), 0);
    `], { cwd: __dirname, timeout: 10_000, stdio: 'pipe' });
  });

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

  it('stops the initial connection lifecycle on an authorization denial', async () => {
    const provider = createProvider();
    const denied = new DocumentRoomCredentialDeniedError('Permission denied: document access was revoked');
    const issueCredential = vi.fn().mockRejectedValue(denied);
    const connection = startDocumentRoomConnection(provider, issueCredential, vi.fn());

    await expect(connection.ready).rejects.toBe(denied);

    expect(issueCredential).toHaveBeenCalledTimes(1);
    expect(provider.listenerCount('authenticationFailed')).toBe(0);
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
