import { describe, expect, it } from 'vitest';
import { nativeTicketDataSource } from '../nativeTicketDataSource';
import {
  NativeTicketIdMethodCalledError,
  TICKET_ID_KEYED_GROUPS,
  createTicketIdGuardDataSource,
} from './ticketIdGuardDataSource';

describe('T003 ticket-id guard harness', () => {
  const guarded = createTicketIdGuardDataSource();

  it('throws from every native ticket-id keyed method', () => {
    for (const group of TICKET_ID_KEYED_GROUPS) {
      const methods = guarded[group] as unknown as Record<string, (...a: unknown[]) => unknown>;
      expect(Object.keys(methods).length).toBeGreaterThan(0);
      for (const [name, fn] of Object.entries(methods)) {
        expect(() => fn('ticket-1'), `${group}.${name}`).toThrow(NativeTicketIdMethodCalledError);
      }
    }
  });

  it('throws from the avatar group, which is keyed by the caller-supplied ticket tenant', () => {
    expect(TICKET_ID_KEYED_GROUPS).toContain('avatars');
    expect(() => (guarded.avatars.getUserAvatarUrlsBatchAction as any)(['u1'], 'tenant-b')).toThrow(
      NativeTicketIdMethodCalledError,
    );
    expect(() => (guarded.avatars.getTeamAvatarUrlsBatchAction as any)(['t1'], 'tenant-b')).toThrow(
      NativeTicketIdMethodCalledError,
    );
    expect(() => (guarded.avatars.getContactAvatarUrlAction as any)('c1', 'tenant-b')).toThrow(
      NativeTicketIdMethodCalledError,
    );
  });

  it('keeps configuration groups and lets overrides replace single methods', () => {
    const getTicketById = async () => ({ ticket_id: 'shared-1' }) as never;
    const ds = createTicketIdGuardDataSource({ overrides: { ticket: { getTicketById } } });
    expect(ds.ticket.getTicketById).toBe(getTicketById);
    expect(() => (ds.ticket.updateTicket as any)('x', {})).toThrow(NativeTicketIdMethodCalledError);
    expect(ds.capabilities).toBe(nativeTicketDataSource.capabilities);
  });
});
