// @vitest-environment node

/**
 * Authorization contract for the ticket CSV importer.
 *
 * Importing is the widest write surface in the product: one upload can mint
 * tickets, clients, contacts, priorities, statuses and categories at once. Each
 * of those needs its own permission, and the reference-data loader that feeds
 * the mapping UI hands back the tenant's user directory, so it needs one too.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPermissionMock = vi.hoisted(() => vi.fn());
const createTenantKnexMock = vi.hoisted(() => vi.fn());
const withTransactionMock = vi.hoisted(() => vi.fn());
const authUserRef = vi.hoisted(() => ({
  value: { user_id: 'user-1', user_type: 'internal', tenant: 'tenant-1' },
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) =>
    fn(authUserRef.value, { tenant: 'tenant-1' }, ...args),
  localizeActionError: async (result: unknown) => result,
}));

vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: hasPermissionMock }));

/**
 * Minimal thenable query builder: every chained call returns itself, and
 * awaiting it (or calling .first()) yields an empty result. Enough for the
 * reference-data loader to run to completion without a database.
 */
function stubQuery(): any {
  const builder: any = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') return undefined;
        if (prop === 'first') return async () => undefined;
        if (prop === Symbol.iterator) return [][Symbol.iterator].bind([]);
        return () => builder;
      },
    },
  );
  return builder;
}

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
  tenantDb: () => ({ table: () => stubQuery() }),
  withTransaction: withTransactionMock,
}));

vi.mock('@alga-psa/core', () => ({ unparseCSV: vi.fn(() => '') }));
vi.mock('@alga-psa/tags/actions/tagActions', () => ({
  createTagsForEntityWithTransaction: vi.fn(),
}));
vi.mock('@alga-psa/shared/models/ticketModel', () => ({
  TicketModel: { createTicket: vi.fn() },
}));
vi.mock('@alga-psa/shared/lib/ticketActivity', () => ({
  TICKET_ACTIVITY_ACTOR: {},
  TICKET_ACTIVITY_ENTITY: {},
  TICKET_ACTIVITY_EVENT: {},
  TICKET_ACTIVITY_SOURCE: {},
  writeTicketActivity: vi.fn(),
}));
vi.mock('@alga-psa/shared/lib/ticketCloseRules', () => ({
  closeRulesHaveEnabledGates: vi.fn(() => false),
  getBoardCloseRulesRow: vi.fn(async () => null),
}));

import { getTicketImportReferenceData, importTickets } from './ticketImportActions';

/** Allow every permission except the ones named. */
function allowAllExcept(...denied: Array<[string, string]>) {
  hasPermissionMock.mockImplementation(async (_u: any, resource: string, action: string) =>
    !denied.some(([r, a]) => r === resource && a === action));
}

/** A processed ticket row referencing only entities that already exist. */
function ticketRow(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Printer offline',
    description: null,
    status_id: null,
    priority_id: null,
    board_id: 'board-1',
    category_id: null,
    subcategory_id: null,
    client_id: 'client-existing',
    contact_id: null,
    assigned_to: null,
    assigned_team_id: null,
    due_date: null,
    entered_at: null,
    closed_at: null,
    is_closed: false,
    tags: [],
    rowNumber: 2,
    ...overrides,
  };
}

type Resolutions = {
  status?: unknown[];
  client?: unknown[];
  contact?: unknown[];
  priority?: unknown[];
  category?: unknown[];
};

async function runImport(resolutions: Resolutions = {}) {
  return importTickets(
    [ticketRow()] as any,
    (resolutions.status ?? []) as any,
    (resolutions.client ?? []) as any,
    (resolutions.contact ?? []) as any,
    (resolutions.priority ?? []) as any,
    (resolutions.category ?? []) as any,
    'board-1',
  );
}

/** The importer converts expected failures to a result object and rethrows the rest. */
async function importOutcome(resolutions: Resolutions = {}): Promise<'denied' | 'allowed'> {
  try {
    const result: any = await runImport(resolutions);
    return result?.success === true ? 'allowed' : 'denied';
  } catch {
    return 'denied';
  }
}

const CREATE = [{ action: 'create' }];

beforeEach(() => {
  vi.clearAllMocks();
  createTenantKnexMock.mockResolvedValue({ knex: {}, tenant: 'tenant-1' });
  withTransactionMock.mockImplementation(async (_db: unknown, cb: any) => cb(stubQuery()));
  authUserRef.value = { user_id: 'user-1', user_type: 'internal', tenant: 'tenant-1' };
});

describe('importTickets authorization', () => {
  it('refuses the import outright without ticket:create', async () => {
    allowAllExcept(['ticket', 'create']);

    expect(await importOutcome()).toBe('denied');
    expect(hasPermissionMock).toHaveBeenCalledWith(expect.anything(), 'ticket', 'create');
  });

  it('requires client:create before minting clients from the CSV', async () => {
    allowAllExcept(['client', 'create']);
    expect(await importOutcome({ client: CREATE })).toBe('denied');
  });

  it('requires contact:create before minting contacts from the CSV', async () => {
    allowAllExcept(['contact', 'create']);
    expect(await importOutcome({ contact: CREATE })).toBe('denied');
  });

  it('requires priority:create before minting priorities from the CSV', async () => {
    allowAllExcept(['priority', 'create']);
    expect(await importOutcome({ priority: CREATE })).toBe('denied');
  });

  it('requires a settings-level permission before minting statuses', async () => {
    // Statuses are board configuration, not ticket data — creating them from an
    // upload must not ride on ticket:create alone.
    allowAllExcept(['ticket_settings', 'update']);
    expect(await importOutcome({ status: CREATE })).toBe('denied');
  });

  it('requires a settings-level permission before minting categories', async () => {
    allowAllExcept(['ticket_settings', 'update']);
    expect(await importOutcome({ category: CREATE })).toBe('denied');
  });

  it('does not demand entity-creation permissions when nothing new is created', async () => {
    // A caller who may create tickets but not clients must still be able to
    // import rows that only reference entities that already exist.
    allowAllExcept(['client', 'create'], ['priority', 'create'], ['contact', 'create']);

    await runImport().catch(() => undefined);

    expect(hasPermissionMock).not.toHaveBeenCalledWith(expect.anything(), 'client', 'create');
    expect(hasPermissionMock).not.toHaveBeenCalledWith(expect.anything(), 'priority', 'create');
    expect(hasPermissionMock).not.toHaveBeenCalledWith(expect.anything(), 'contact', 'create');
  });
});

describe('getTicketImportReferenceData authorization', () => {
  it('requires ticket:read before returning tenant reference data', async () => {
    // This action returns the tenant's internal user directory, including email
    // addresses, plus every board, client and contact. It must not be reachable
    // by any authenticated caller.
    hasPermissionMock.mockResolvedValue(false);

    await expect(getTicketImportReferenceData('board-1')).rejects.toThrow(/permission/i);
  });

  it('checks the caller before touching the database', async () => {
    hasPermissionMock.mockResolvedValue(false);

    await getTicketImportReferenceData('board-1').catch(() => undefined);

    expect(hasPermissionMock).toHaveBeenCalled();
  });
});
