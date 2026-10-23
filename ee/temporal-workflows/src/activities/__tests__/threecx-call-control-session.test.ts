import { describe, expect, it, vi } from 'vitest';
import {
  runThreecxCallControlSession,
  type CallControlSocket,
  type ThreecxSessionDeps,
} from '../../lib/threecxCallControlSession';

type Listener = (...args: any[]) => void;

class FakeSocket implements CallControlSocket {
  private listeners = new Map<string, Listener[]>();
  closed = false;

  on(event: string, listener: Listener): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.emit('close', 1000);
  }

  terminate(): void {
    this.close();
  }
}

const participantEntity = '/callcontrol/100/participants/7';
const upsert = (sequence: number) => JSON.stringify({ sequence, event: { event_type: 0, entity: participantEntity } });
const remove = (sequence: number) => JSON.stringify({ sequence, event: { event_type: 1, entity: participantEntity } });

interface Harness {
  deps: ThreecxSessionDeps;
  sockets: FakeSocket[];
  cancel(): void;
  clock: { now: number };
  getToken: ReturnType<typeof vi.fn>;
  fetchParticipant: ReturnType<typeof vi.fn>;
  forward: ReturnType<typeof vi.fn>;
  heartbeat: ReturnType<typeof vi.fn>;
  onPersistentFailure: ReturnType<typeof vi.fn>;
}

function harness(
  script: (socket: FakeSocket, index: number) => void,
  overrides: Partial<ThreecxSessionDeps> = {},
): Harness {
  const sockets: FakeSocket[] = [];
  const clock = { now: 1_000_000 };
  let rejectCancelled!: (error: Error) => void;
  const cancelled = new Promise<never>((_, reject) => {
    rejectCancelled = reject;
  });
  cancelled.catch(() => undefined);

  const getToken = vi.fn(async (force: boolean) => (force ? 'token-fresh' : 'token-1'));
  const fetchParticipant = vi.fn(async () => ({ status: 200, body: { id: 7, status: 'Ringing', dn: '100', callid: 55, party_caller_id: '+15551112222' } }));
  const forward = vi.fn(async () => undefined);
  const heartbeat = vi.fn();
  const onPersistentFailure = vi.fn(async () => undefined);

  const deps: ThreecxSessionDeps = {
    tenantId: 'tenant-1',
    mappedDns: new Set(['100']),
    getToken,
    openSocket: vi.fn((_token: string) => {
      const socket = new FakeSocket();
      sockets.push(socket);
      queueMicrotask(() => script(socket, sockets.length));
      return socket;
    }),
    fetchParticipant,
    forward,
    heartbeat,
    cancelled,
    onPersistentFailure,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    now: () => clock.now,
    sleep: async (ms) => {
      clock.now += ms;
    },
    heartbeatIntervalMs: 5,
    ...overrides,
  };

  return {
    deps,
    sockets,
    clock,
    cancel: () => rejectCancelled(new Error('cancelled')),
    getToken,
    fetchParticipant,
    forward,
    heartbeat,
    onPersistentFailure,
  };
}

describe('runThreecxCallControlSession', () => {
  it('opens the socket with the bearer token, heartbeats, fetches on Upsert and forwards transitions (T030, T031, T033-T035)', async () => {
    const h = harness((socket, index) => {
      if (index === 1) socket.emit('open');
    });
    const run = runThreecxCallControlSession(h.deps);

    await vi.waitFor(() => expect(h.sockets).toHaveLength(1));
    expect(h.deps.openSocket).toHaveBeenCalledWith('token-1');

    h.sockets[0].emit('message', Buffer.from(upsert(1)));
    await vi.waitFor(() => expect(h.forward).toHaveBeenCalledTimes(1));
    expect(h.fetchParticipant).toHaveBeenCalledWith(participantEntity, 'token-1');
    expect(h.forward.mock.calls[0][0]).toMatchObject({ kind: 'ringing', dn: '100', participantId: '7', callId: '55', partyCallerId: '+15551112222' });

    h.fetchParticipant.mockResolvedValueOnce({ status: 200, body: { id: 7, status: 'Connected', dn: '100', callid: 55 } });
    h.sockets[0].emit('message', upsert(2));
    await vi.waitFor(() => expect(h.forward).toHaveBeenCalledTimes(2));
    expect(h.forward.mock.calls[1][0]).toEqual({ kind: 'connected', dn: '100', participantId: '7', callId: '55' });

    h.sockets[0].emit('message', remove(3));
    await vi.waitFor(() => expect(h.forward).toHaveBeenCalledTimes(3));
    expect(h.forward.mock.calls[2][0]).toEqual({ kind: 'ended', dn: '100', participantId: '7', callId: '55' });
    expect(h.fetchParticipant).toHaveBeenCalledTimes(2);

    await vi.waitFor(() => expect(h.heartbeat.mock.calls.length).toBeGreaterThan(1));
    h.cancel();
    await expect(run).resolves.toMatchObject({ reason: 'cancelled', forwarded: 3, connections: 1 });
    expect(h.sockets[0].closed).toBe(true);
  });

  it('skips the participant fetch for DNs outside the extension map (T036)', async () => {
    const h = harness((socket) => socket.emit('open'));
    const run = runThreecxCallControlSession(h.deps);
    await vi.waitFor(() => expect(h.sockets).toHaveLength(1));
    h.sockets[0].emit('message', JSON.stringify({ sequence: 1, event: { event_type: 0, entity: '/callcontrol/999/participants/1' } }));
    h.sockets[0].emit('message', JSON.stringify({ sequence: 2, event: { event_type: 0, entity: '/callcontrol/100' } }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(h.fetchParticipant).not.toHaveBeenCalled();
    expect(h.forward).not.toHaveBeenCalled();
    h.cancel();
    await run;
  });

  it('refreshes the token after a 401 handshake before reconnecting (T039)', async () => {
    const h = harness((socket, index) => {
      if (index === 1) socket.emit('unexpected-response', { destroy: vi.fn() }, { statusCode: 401 });
      else socket.emit('open');
    });
    const run = runThreecxCallControlSession(h.deps);
    await vi.waitFor(() => expect(h.sockets).toHaveLength(2));
    expect(h.getToken.mock.calls.map(([force]) => force)).toEqual([false, true]);
    expect(h.deps.openSocket).toHaveBeenNthCalledWith(2, 'token-fresh');
    h.cancel();
    await expect(run).resolves.toMatchObject({ reason: 'cancelled', connections: 1 });
  });

  it('refreshes the token when the participant GET answers 401', async () => {
    const h = harness((socket) => socket.emit('open'));
    h.fetchParticipant.mockResolvedValueOnce({ status: 401, body: null });
    const run = runThreecxCallControlSession(h.deps);
    await vi.waitFor(() => expect(h.sockets).toHaveLength(1));
    h.sockets[0].emit('message', upsert(1));
    await vi.waitFor(() => expect(h.forward).toHaveBeenCalledTimes(1));
    expect(h.fetchParticipant).toHaveBeenNthCalledWith(2, participantEntity, 'token-fresh');
    h.cancel();
    await run;
  });

  it('marks the PBX errored and fails after ten minutes of failed connects (T040)', async () => {
    const h = harness((socket) => {
      socket.emit('error', new Error('ECONNREFUSED'));
      socket.close();
    });
    const start = h.clock.now;
    await expect(runThreecxCallControlSession(h.deps)).rejects.toThrow(/unreachable for 10 minutes/);
    expect(h.onPersistentFailure).toHaveBeenCalledWith('ECONNREFUSED');
    expect(h.clock.now - start).toBeGreaterThanOrEqual(10 * 60 * 1000);
    expect(h.clock.now - start).toBeLessThan(13 * 60 * 1000);
  });

  it('returns after the run duration elapses', async () => {
    const h = harness((socket) => socket.emit('open'), { now: undefined, sleep: undefined, runDurationMs: 30 });
    delete (h.deps as Partial<ThreecxSessionDeps>).now;
    delete (h.deps as Partial<ThreecxSessionDeps>).sleep;
    await expect(runThreecxCallControlSession(h.deps)).resolves.toMatchObject({ reason: 'deadline', connections: 1 });
    expect(h.sockets[0].closed).toBe(true);
  });
});
