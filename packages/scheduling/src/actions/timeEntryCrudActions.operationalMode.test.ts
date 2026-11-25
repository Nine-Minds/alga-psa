// @vitest-environment node
/**
 * F067 / D7: `saveTimeEntry` decides the billing mode on the server, from the authenticated principal. A seat
 * technician's save goes to the write core as `operational` (the core then builds the row from
 * `operationalTimeEntryFields()` and skips contract resolution and allocation). Nobody else's does, whatever the
 * payload claims.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  surfaceKind: null as string | null,
  persist: vi.fn(),
  logSession: vi.fn(),
  loadProductPrincipal: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({
    knex: { transaction: async (cb: (trx: unknown) => unknown) => cb({}) },
    tenant: 'tenant-1',
  })),
  tenantDb: vi.fn(() => ({ table: () => ({ where: () => ({ select: async () => [] }) }), tenantJoin: () => undefined })),
}));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: unknown[]) => action({ user_id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
  hasPermission: vi.fn(async () => true),
}));
vi.mock('@shared/services/productPrincipal', () => ({
  loadProductPrincipal: (...a: unknown[]) => h.loadProductPrincipal(...a),
}));
vi.mock('../lib/timeEntryWriteCore', () => ({
  deleteTimeEntryCore: vi.fn(),
  persistTimeEntry: (...a: unknown[]) => h.persist(...a),
  publishPersistedTimeEntryEvents: vi.fn(),
}));
vi.mock('../lib/stopwatch/stopwatchCore', () => ({ logSession: (...a: unknown[]) => h.logSession(...a) }));
vi.mock('../lib/timeEntryAuthorizationSql', () => ({ resolveTimeEntryReadScope: vi.fn() }));
vi.mock('./timeEntryDelegationAuth', () => ({ assertCanActOnBehalf: vi.fn(), assertCanApproveSubject: vi.fn() }));
vi.mock('./timeEntryChangeRequestActions', () => ({
  createTimeEntryChangeRequestRecord: vi.fn(), fetchTimeEntryChangeRequestsForEntryIdsFromDb: vi.fn(),
}));
vi.mock('../lib/timeEntryChangeRequests', () => ({ attachTimeEntryChangeRequests: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: vi.fn(), publishWorkflowEvent: vi.fn() }));
vi.mock('@alga-psa/workflow-streams', () => ({
  buildTimeEntryApprovedPayload: vi.fn(), buildTimeEntrySubmittedPayload: vi.fn(), toWorkflowTimeEntryWorkItemType: vi.fn(),
}));

import { saveTimeEntry } from './timeEntryCrudActions';

const payload = (extra: Record<string, unknown> = {}) => ({
  work_item_id: 'cat-1', work_item_type: 'non_billable_category', notes: 'n', user_id: 'user-1',
  start_time: '2026-09-01T12:00:00Z', end_time: '2026-09-01T13:00:00Z',
  created_at: '2026-09-01T12:00:00Z', updated_at: '2026-09-01T12:00:00Z',
  billable_duration: 60, approval_status: 'DRAFT', ...extra,
}) as any;

const save = (entry: unknown) => (saveTimeEntry as any)(entry);

describe('saveTimeEntry billing mode', () => {
  beforeEach(() => {
    h.persist.mockReset();
    h.persist.mockImplementation(async (_trx: unknown, input: any) => ({
      entry: { ...input.entry, entry_id: 'e1' }, isUpdate: false, finalBillableDuration: 0,
      searchEvent: { eventType: 'TIME_ENTRY_CREATED', payload: { tenantId: 'tenant-1' } },
    }));
    h.logSession.mockReset();
    h.logSession.mockImplementation(async (_trx: unknown, _tenant: string, _actor: unknown, _sessionId: string, input: any) => ({
      persisted: input.entries.map((entry: any) => ({
        entry: { ...entry, entry_id: 'e-sw' }, isUpdate: false, finalBillableDuration: 0,
        searchEvent: { eventType: 'TIME_ENTRY_CREATED', payload: { tenantId: 'tenant-1' } },
      })),
    }));
    h.loadProductPrincipal.mockReset();
    h.loadProductPrincipal.mockImplementation(async () => ({ rawProductCode: 'psa', surfaceKind: h.surfaceKind }));
  });

  describe('seat principal', () => {
    beforeEach(() => { h.surfaceKind = 'co_managed_seat'; });

    it('saves with no service and hands the write core operational mode', async () => {
      await save(payload());
      expect(h.persist).toHaveBeenCalledTimes(1);
      expect(h.persist.mock.calls[0][1]).toMatchObject({ mode: 'operational', tenant: 'tenant-1' });
    });

    it('stays operational when the client sends commercial fields (the core rejects them)', async () => {
      await save(payload({ service_id: 'service-1', billing_mode: 'commercial' }));
      expect(h.persist.mock.calls[0][1].mode).toBe('operational');
    });

    // alga-2026-0003428: a seat technician's stopwatch save is logged, as client IT effort. The session is handed to
    // logSession, which resolves the billing mode from the actor itself; the action passes no mode it could get wrong.
    it('logs a stopwatch session through logSession, which decides the mode itself', async () => {
      const sessionId = '6f1d1a3e-0000-4000-8000-000000000001';
      const result = await save(payload({ billable_duration: 0, stopwatch_session_id: sessionId }));
      expect(result).not.toHaveProperty('actionError');
      expect(h.logSession).toHaveBeenCalledTimes(1);
      const [, tenant, actor, loggedSession, input] = h.logSession.mock.calls[0];
      expect({ tenant, actor: (actor as any).user_id, loggedSession }).toEqual({ tenant: 'tenant-1', actor: 'user-1', loggedSession: sessionId });
      expect(input).not.toHaveProperty('mode');
      expect(input.entries).toHaveLength(1);
      expect(input.entries[0]).not.toHaveProperty('mode');
      expect(h.persist).not.toHaveBeenCalled();
    });
  });

  describe.each([['an ordinary user', null], ['an unregistered principal kind', 'something_else']])('%s', (_n, kind) => {
    beforeEach(() => { h.surfaceKind = kind; });

    it('still requires a service and writes nothing without one', async () => {
      await expect(save(payload())).rejects.toThrow(/service_id is required for time entries/);
      expect(h.persist).not.toHaveBeenCalled();
    });

    it('stays commercial when the client claims operational mode', async () => {
      await save(payload({ service_id: 'service-1', billing_mode: 'operational', mode: 'operational' }));
      const input = h.persist.mock.calls[0][1];
      expect(input.mode).toBeUndefined();
      expect(input.entry.service_id).toBe('service-1');
      expect(input.entry).not.toHaveProperty('billing_mode');
    });
  });

  it('fails the save, not open, when the principal cannot be read', async () => {
    h.loadProductPrincipal.mockRejectedValue(new Error('db down'));
    await expect(save(payload({ service_id: 'service-1' }))).rejects.toThrow('db down');
    expect(h.persist).not.toHaveBeenCalled();
  });
});
