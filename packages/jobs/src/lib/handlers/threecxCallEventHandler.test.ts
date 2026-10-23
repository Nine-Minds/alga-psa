import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The incoming-call card's data path: a PBX event for a mapped extension turns
 * into one realtime message on that user's channel. The ringing payload is the
 * only one that looks anything up; the rest exist to close the card.
 */
type FakeBuilder = {
  calls: Array<[string, unknown[]]>;
  rows: unknown[];
  [method: string]: any;
};

const mocks = vi.hoisted(() => {
  const tables = new Map<string, unknown[]>();
  const builders: FakeBuilder[] = [];
  const makeBuilder = (name: string): FakeBuilder => {
    const builder: FakeBuilder = { calls: [], rows: tables.get(name) ?? [] };
    for (const method of ['where', 'whereIn', 'orderBy', 'limit', 'select', 'distinct']) {
      builder[method] = (...args: unknown[]) => {
        builder.calls.push([method, args]);
        return builder;
      };
    }
    builder.first = async (...args: unknown[]) => {
      builder.calls.push(['first', args]);
      return builder.rows[0] ?? null;
    };
    builder.then = (resolve: (rows: unknown[]) => unknown, reject?: (error: unknown) => unknown) =>
      Promise.resolve(builder.rows).then(resolve, reject);
    builders.push(builder);
    return builder;
  };
  return {
    tables,
    builders,
    tenantScopes: [] as string[],
    tenantJoin: vi.fn(),
    tenantDb: vi.fn((_knex: unknown, _tenant: string) => ({
      table: (expression: string) => makeBuilder(expression.split(' ')[0]),
      tenantJoin: (...args: unknown[]) => (mocks.tenantJoin as any)(...args),
    })),
    knex: { raw: vi.fn((sql: string) => ({ sql })) },
    matchCallParty: vi.fn(),
    resolveCountry: vi.fn(async () => 'US'),
    providerConfig: vi.fn(),
    broadcast: vi.fn(async () => undefined),
  };
});

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alga-psa/db', () => ({
  runWithTenant: async (tenantId: string, fn: () => Promise<unknown>) => {
    mocks.tenantScopes.push(tenantId);
    return fn();
  },
  createTenantKnex: async () => ({ knex: mocks.knex }),
  tenantDb: mocks.tenantDb,
}));

vi.mock('@alga-psa/telephony', () => ({
  matchCallParty: mocks.matchCallParty,
  resolveTenantPhoneCountryCode: mocks.resolveCountry,
}));

vi.mock('@alga-psa/ee-threecx/lib', () => ({
  getThreecxProviderConfig: mocks.providerConfig,
  userForExtension: (config: { extensions: Array<{ dn: string; userId: string | null }> }, dn: string) =>
    config.extensions.find((row) => row.dn === dn)?.userId ?? null,
}));

vi.mock('@alga-psa/notifications/realtime/internalNotificationBroadcaster', () => ({
  broadcastTelephonyIncomingCall: mocks.broadcast,
}));

let handler: typeof import('./threecxCallEventHandler');

const ringing = {
  kind: 'ringing' as const,
  dn: '101',
  participantId: 'p-1',
  callId: 'call-1',
  partyCallerId: '5551234567',
  partyCallerName: 'PBX Name',
  at: '2026-09-15T10:00:00.000Z',
};

const unmatched = { status: 'unmatched', contactId: null, clientId: null, candidates: [] };

function fakeLookups(overrides: Partial<import('./threecxCallEventHandler').IncomingCallLookups> = {}) {
  return {
    matchCallParty: vi.fn(async () => unmatched as any),
    loadContact: vi.fn(async () => null),
    loadClient: vi.fn(async () => null),
    loadOpenTickets: vi.fn(async () => []),
    loadRecentInteractions: vi.fn(async () => []),
    ...overrides,
  };
}

beforeAll(async () => {
  process.env.EDITION = 'ee';
  handler = await import('./threecxCallEventHandler');
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tables.clear();
  mocks.builders.length = 0;
  mocks.tenantScopes.length = 0;
  mocks.providerConfig.mockResolvedValue({
    row: {},
    config: { extensions: [{ dn: '101', userId: 'user-101' }, { dn: '102', userId: null }] },
  });
  mocks.matchCallParty.mockResolvedValue(unmatched);
});

describe('buildIncomingCallPayload', () => {
  it('T046: ringing with a known number publishes the matched contact and client', async () => {
    const lookups = fakeLookups({
      matchCallParty: vi.fn(async () => ({ status: 'matched', contactId: 'c-1', clientId: 'cl-1', candidates: [] }) as any),
      loadContact: vi.fn(async () => ({ id: 'c-1', name: 'Ada Lovelace', email: 'ada@example.com', phone: '+15551234567', clientId: 'cl-1' })),
      loadClient: vi.fn(async () => ({ id: 'cl-1', name: 'Analytical Engines' })),
    });

    const message = await handler.buildIncomingCallPayload(ringing, lookups, 'US');

    expect(message.event).toBe('ringing');
    expect(message.call).toMatchObject({
      callId: 'call-1',
      participantId: 'p-1',
      dn: '101',
      numberE164: '+15551234567',
      callerName: 'Ada Lovelace',
      matchStatus: 'matched',
      contact: { id: 'c-1', name: 'Ada Lovelace', email: 'ada@example.com', phone: '+15551234567' },
      client: { id: 'cl-1', name: 'Analytical Engines' },
      at: ringing.at,
    });
    expect(lookups.matchCallParty).toHaveBeenCalledWith('+15551234567');
  });

  it('T047: ringing with an unknown number publishes an unmatched call carrying the number', async () => {
    const message = await handler.buildIncomingCallPayload(ringing, fakeLookups(), 'US');

    expect(message.call).toMatchObject({
      numberE164: '+15551234567',
      matchStatus: 'unmatched',
      contact: null,
      client: null,
      tickets: [],
      interactions: [],
      callerName: 'PBX Name',
    });
    expect(message.call.number).toContain('555');
  });

  it('T048/T050: a contact match carries its open tickets and last interactions', async () => {
    const tickets = [{ id: 't-1', number: '1001', title: 'Printer', status: 'Open' }];
    const interactions = [{ id: 'i-1', type: 'Call', title: 'Follow-up', date: '2026-09-14T09:00:00.000Z' }];
    const lookups = fakeLookups({
      matchCallParty: vi.fn(async () => ({ status: 'matched', contactId: 'c-1', clientId: 'cl-1', candidates: [] }) as any),
      loadContact: vi.fn(async () => ({ id: 'c-1', name: 'Ada', email: null, phone: null, clientId: 'cl-1' })),
      loadClient: vi.fn(async () => ({ id: 'cl-1', name: 'AE' })),
      loadOpenTickets: vi.fn(async () => tickets),
      loadRecentInteractions: vi.fn(async () => interactions),
    });

    const message = await handler.buildIncomingCallPayload(ringing, lookups, 'US');

    expect(lookups.loadOpenTickets).toHaveBeenCalledWith({ contactId: 'c-1' });
    expect(lookups.loadOpenTickets).toHaveBeenCalledTimes(1);
    expect(lookups.loadRecentInteractions).toHaveBeenCalledWith('c-1');
    expect(message.call.tickets).toEqual(tickets);
    expect(message.call.interactions).toEqual(interactions);
  });

  it('T049: a client-only match lists the client tickets and no interactions', async () => {
    const lookups = fakeLookups({
      matchCallParty: vi.fn(async () => ({ status: 'matched', contactId: null, clientId: 'cl-1', candidates: [] }) as any),
      loadClient: vi.fn(async () => ({ id: 'cl-1', name: 'AE' })),
      loadOpenTickets: vi.fn(async () => [{ id: 't-9', number: '1009', title: 'Router', status: 'New' }]),
    });

    const message = await handler.buildIncomingCallPayload(ringing, lookups, 'US');

    expect(lookups.loadContact).not.toHaveBeenCalled();
    expect(lookups.loadOpenTickets).toHaveBeenCalledWith({ clientId: 'cl-1' });
    expect(lookups.loadRecentInteractions).not.toHaveBeenCalled();
    expect(message.call.contact).toBeNull();
    expect(message.call.tickets).toHaveLength(1);
  });

  it('falls back to client tickets when the contact has none open', async () => {
    const lookups = fakeLookups({
      matchCallParty: vi.fn(async () => ({ status: 'matched', contactId: 'c-1', clientId: 'cl-1', candidates: [] }) as any),
      loadContact: vi.fn(async () => ({ id: 'c-1', name: 'Ada', email: null, phone: null, clientId: 'cl-1' })),
      loadClient: vi.fn(async () => ({ id: 'cl-1', name: 'AE' })),
      loadOpenTickets: vi.fn(async (scope: any) => ('contactId' in scope ? [] : [{ id: 't-2', number: '1002', title: 'VPN', status: 'Open' }])),
    });

    const message = await handler.buildIncomingCallPayload(ringing, lookups, 'US');

    expect(lookups.loadOpenTickets).toHaveBeenNthCalledWith(1, { contactId: 'c-1' });
    expect(lookups.loadOpenTickets).toHaveBeenNthCalledWith(2, { clientId: 'cl-1' });
    expect(message.call.tickets?.[0]?.id).toBe('t-2');
  });

  it('T052: connected and ended carry only the call identity and skip every lookup', async () => {
    const lookups = fakeLookups();
    for (const kind of ['connected', 'ended'] as const) {
      const message = await handler.buildIncomingCallPayload({ ...ringing, kind }, lookups, 'US');
      expect(message).toEqual({ event: kind, call: { callId: 'call-1', participantId: 'p-1', dn: '101' } });
    }
    expect(lookups.matchCallParty).not.toHaveBeenCalled();
    expect(lookups.loadContact).not.toHaveBeenCalled();
  });
});

describe('createIncomingCallLookups', () => {
  it('T048: open tickets exclude closed statuses, order by updated_at desc and cap at 5', async () => {
    mocks.tables.set('tickets', [
      { ticket_id: 't-1', ticket_number: '1001', title: 'One', status_name: 'Open' },
    ]);
    const lookups = handler.createIncomingCallLookups({
      knex: mocks.knex,
      tenantId: 'tenant-1',
      defaultCountryCode: 'US',
      matchCallParty: mocks.matchCallParty,
    });

    const tickets = await lookups.loadOpenTickets({ contactId: 'c-1' });

    expect(mocks.tenantDb).toHaveBeenCalledWith(mocks.knex, 'tenant-1');
    expect(tickets).toEqual([{ id: 't-1', number: '1001', title: 'One', status: 'Open' }]);
    const builder = mocks.builders.find((b) => b.calls.some(([m, args]) => m === 'limit' && args[0] === 5));
    expect(builder).toBeDefined();
    expect(builder!.calls).toContainEqual(['where', ['s.is_closed', false]]);
    expect(builder!.calls).toContainEqual(['where', [{ 't.contact_name_id': 'c-1' }]]);
    expect(builder!.calls).toContainEqual(['orderBy', ['t.updated_at', 'desc']]);
    expect(mocks.tenantJoin).toHaveBeenCalledWith(expect.anything(), 'statuses as s', 't.status_id', 's.status_id');
  });

  it('T050: recent interactions are the contact\'s last 3 by interaction_date with a type name', async () => {
    mocks.tables.set('interactions', [
      { interaction_id: 'i-1', title: 'Call', interaction_date: new Date('2026-09-14T09:00:00Z'), type_name: 'Phone' },
    ]);
    const lookups = handler.createIncomingCallLookups({
      knex: mocks.knex,
      tenantId: 'tenant-1',
      defaultCountryCode: 'US',
      matchCallParty: mocks.matchCallParty,
    });

    const interactions = await lookups.loadRecentInteractions('c-1');

    expect(interactions).toEqual([{ id: 'i-1', type: 'Phone', title: 'Call', date: '2026-09-14T09:00:00.000Z' }]);
    const builder = mocks.builders.find((b) => b.calls.some(([m, args]) => m === 'limit' && args[0] === 3));
    expect(builder!.calls).toContainEqual(['where', ['i.contact_name_id', 'c-1']]);
    expect(builder!.calls).toContainEqual(['orderBy', ['i.interaction_date', 'desc']]);
  });

  it('matchCallParty is scoped to the tenant with the default country', async () => {
    const lookups = handler.createIncomingCallLookups({
      knex: mocks.knex,
      tenantId: 'tenant-1',
      defaultCountryCode: 'GB',
      matchCallParty: mocks.matchCallParty,
    });
    await lookups.matchCallParty('+441234567890');
    expect(mocks.matchCallParty).toHaveBeenCalledWith({
      knex: mocks.knex,
      tenantId: 'tenant-1',
      phoneNumber: '+441234567890',
      defaultCountryCode: 'GB',
    });
  });
});

describe('processThreecxCallEvent', () => {
  it('T045: drops an event for a DN with no mapped user', async () => {
    await handler.processThreecxCallEvent({ tenantId: 'tenant-1', event: { ...ringing, dn: '102' } });
    await handler.processThreecxCallEvent({ tenantId: 'tenant-1', event: { ...ringing, dn: '999' } });

    expect(mocks.broadcast).not.toHaveBeenCalled();
    expect(mocks.matchCallParty).not.toHaveBeenCalled();
    expect(mocks.tenantScopes).toEqual(['tenant-1', 'tenant-1']);
  });

  it('T051: publishes on the mapped user channel only, inside the tenant scope', async () => {
    await handler.processThreecxCallEvent({ tenantId: 'tenant-1', event: ringing });

    expect(mocks.broadcast).toHaveBeenCalledTimes(1);
    const [tenant, userId, message] = mocks.broadcast.mock.calls[0] as unknown as [string, string, any];
    expect(tenant).toBe('tenant-1');
    expect(userId).toBe('user-101');
    expect(message.event).toBe('ringing');
    expect(message.call).toMatchObject({ callId: 'call-1', dn: '101', matchStatus: 'unmatched' });
    expect(mocks.resolveCountry).toHaveBeenCalledWith(mocks.knex, 'tenant-1');
    expect(mocks.matchCallParty).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', defaultCountryCode: 'US' }),
    );
  });

  it('T052: connected and ended publish the minimal call without any lookup', async () => {
    await handler.processThreecxCallEvent({ tenantId: 'tenant-1', event: { ...ringing, kind: 'ended' } });

    expect(mocks.broadcast).toHaveBeenCalledWith('tenant-1', 'user-101', {
      event: 'ended',
      call: { callId: 'call-1', participantId: 'p-1', dn: '101' },
    });
    expect(mocks.matchCallParty).not.toHaveBeenCalled();
    expect(mocks.resolveCountry).not.toHaveBeenCalled();
  });
});
