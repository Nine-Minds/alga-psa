import { beforeEach, describe, expect, it, vi } from 'vitest';

let knexImpl: any;

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) =>
    fn({ user_id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: knexImpl })),
  tenantDb: (conn: any, tenant: string) => ({
    table: (table: string) => {
      const builder = conn(table);
      const originalWhere = builder.where.bind(builder);
      builder.where = (value: Record<string, unknown>) => originalWhere({ tenant, ...value });
      return builder;
    },
    unscoped: (table: string) => conn(table),
  }),
}));

type Plan = {
  current?: Record<string, unknown> | null;
  /** location_id values that belong to the client being validated against */
  ownedLocations?: Record<string, string>; // locationId -> clientId
};

type Call = { table: string; op: string; where: Record<string, unknown>; payload?: unknown };

const CURRENT = {
  board_id: 'board-1',
  status_id: 'status-1',
  priority_id: 'priority-1',
  client_id: 'client-a',
  location_id: 'loc-a',
};

function createHarness(plan: Plan) {
  const calls: Call[] = [];
  const current = plan.current === undefined ? CURRENT : plan.current;
  const owned = plan.ownedLocations ?? { 'loc-a': 'client-a', 'loc-b': 'client-b' };

  const knexFn = (table: string) => {
    let whereClause: Record<string, unknown> = {};
    let pendingPayload: unknown;
    const builder: any = {
      where: vi.fn((value: Record<string, unknown>) => {
        whereClause = value ?? {};
        return builder;
      }),
      select: vi.fn(() => builder),
      first: vi.fn(async () => {
        calls.push({ table, op: 'first', where: whereClause });
        if (table === 'inbound_ticket_defaults') return current ?? undefined;
        if (table === 'statuses') return { status_id: whereClause.status_id };
        if (table === 'client_locations') {
          const locationId = String(whereClause.location_id);
          return owned[locationId] === whereClause.client_id ? { location_id: locationId } : undefined;
        }
        return undefined;
      }),
      insert: vi.fn((payload: unknown) => {
        pendingPayload = payload;
        calls.push({ table, op: 'insert', where: whereClause, payload });
        return builder;
      }),
      update: vi.fn((payload: unknown) => {
        pendingPayload = payload;
        calls.push({ table, op: 'update', where: whereClause, payload });
        return builder;
      }),
      returning: vi.fn(async () => [{ id: 'defaults-1', ...(current ?? {}), ...(pendingPayload as object) }]),
    };
    return builder;
  };

  const knex: any = Object.assign(knexFn, {
    fn: { now: () => 'now()' },
    raw: (sql: string) => sql,
  });

  return { knex, calls };
}

const updateCall = (calls: Call[]) =>
  calls.find((call) => call.table === 'inbound_ticket_defaults' && call.op === 'update');
const insertCall = (calls: Call[]) =>
  calls.find((call) => call.table === 'inbound_ticket_defaults' && call.op === 'insert');

describe('inbound ticket defaults location handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('updateInboundTicketDefaults', () => {
    it('writes null when the caller clears the location', async () => {
      const { knex, calls } = createHarness({});
      knexImpl = knex;

      const { updateInboundTicketDefaults } = await import('./inboundTicketDefaultsActions');
      const result = await updateInboundTicketDefaults('defaults-1', { location_id: null });

      expect(result).toMatchObject({ defaults: { location_id: null } });
      expect(updateCall(calls)?.payload).toMatchObject({ location_id: null });
    });

    it('drops the previous client location when the client changes without a new location', async () => {
      const { knex, calls } = createHarness({});
      knexImpl = knex;

      const { updateInboundTicketDefaults } = await import('./inboundTicketDefaultsActions');
      const result = await updateInboundTicketDefaults('defaults-1', { client_id: 'client-b' });

      expect(result).toMatchObject({ defaults: { client_id: 'client-b', location_id: null } });
      expect(updateCall(calls)?.payload).toMatchObject({ client_id: 'client-b', location_id: null });
    });

    it('keeps the stored location when neither client nor location is part of the update', async () => {
      const { knex, calls } = createHarness({});
      knexImpl = knex;

      const { updateInboundTicketDefaults } = await import('./inboundTicketDefaultsActions');
      await updateInboundTicketDefaults('defaults-1', { display_name: 'Renamed' });

      expect(updateCall(calls)?.payload).not.toHaveProperty('location_id');
      expect(calls.some((call) => call.table === 'client_locations')).toBe(false);
    });

    it('rejects a location that belongs to a different client', async () => {
      const { knex, calls } = createHarness({});
      knexImpl = knex;

      const { updateInboundTicketDefaults } = await import('./inboundTicketDefaultsActions');
      const result = await updateInboundTicketDefaults('defaults-1', {
        client_id: 'client-b',
        location_id: 'loc-a',
      });

      expect(result).toEqual({
        actionError: 'The selected location does not belong to the selected client',
        messageKey: 'msp/email-providers:errors.inboundDefaults.locationClientMismatch',
      });
      expect(calls.find((call) => call.table === 'client_locations')?.where).toEqual({
        tenant: 'tenant-1',
        location_id: 'loc-a',
        client_id: 'client-b',
      });
      expect(updateCall(calls)).toBeUndefined();
    });

    it('accepts a location owned by the stored client when only the location changes', async () => {
      const { knex, calls } = createHarness({ ownedLocations: { 'loc-a2': 'client-a' } });
      knexImpl = knex;

      const { updateInboundTicketDefaults } = await import('./inboundTicketDefaultsActions');
      const result = await updateInboundTicketDefaults('defaults-1', { location_id: 'loc-a2' });

      expect(result).toMatchObject({ defaults: { location_id: 'loc-a2' } });
      expect(updateCall(calls)?.payload).toMatchObject({ location_id: 'loc-a2' });
    });

    it('returns not found before validating anything when the row is missing', async () => {
      const { knex, calls } = createHarness({ current: null });
      knexImpl = knex;

      const { updateInboundTicketDefaults } = await import('./inboundTicketDefaultsActions');
      await expect(updateInboundTicketDefaults('missing', { location_id: 'loc-a' })).resolves.toEqual({
        actionError: 'Defaults configuration not found',
        messageKey: 'msp/email-providers:errors.inboundDefaults.notFound',
      });
      expect(updateCall(calls)).toBeUndefined();
    });
  });

  describe('createInboundTicketDefaults', () => {
    const base = {
      short_name: 'catch-all',
      display_name: 'Catch All',
      board_id: 'board-1',
      status_id: 'status-1',
      priority_id: 'priority-1',
    };

    it('stores null when no location is given', async () => {
      const { knex, calls } = createHarness({});
      knexImpl = knex;

      const { createInboundTicketDefaults } = await import('./inboundTicketDefaultsActions');
      const result = await createInboundTicketDefaults({ ...base, client_id: 'client-a' });

      expect(result).toMatchObject({ defaults: { location_id: null } });
      expect(insertCall(calls)?.payload).toMatchObject({ location_id: null });
    });

    it('rejects a location without a client', async () => {
      const { knex, calls } = createHarness({});
      knexImpl = knex;

      const { createInboundTicketDefaults } = await import('./inboundTicketDefaultsActions');
      await expect(createInboundTicketDefaults({ ...base, location_id: 'loc-a' })).resolves.toEqual({
        actionError: 'Select a client before selecting a location',
        messageKey: 'msp/email-providers:errors.inboundDefaults.locationRequiresClient',
      });
      expect(insertCall(calls)).toBeUndefined();
    });

    it('rejects a location from another client and accepts one owned by the client', async () => {
      const { knex, calls } = createHarness({});
      knexImpl = knex;

      const { createInboundTicketDefaults } = await import('./inboundTicketDefaultsActions');
      await expect(
        createInboundTicketDefaults({ ...base, client_id: 'client-a', location_id: 'loc-b' })
      ).resolves.toEqual({
        actionError: 'The selected location does not belong to the selected client',
        messageKey: 'msp/email-providers:errors.inboundDefaults.locationClientMismatch',
      });
      expect(insertCall(calls)).toBeUndefined();

      const ok = await createInboundTicketDefaults({ ...base, client_id: 'client-a', location_id: 'loc-a' });
      expect(ok).toMatchObject({ defaults: { client_id: 'client-a', location_id: 'loc-a' } });
    });
  });
});
