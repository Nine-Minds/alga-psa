import { beforeEach, describe, expect, it, vi } from 'vitest';

// alga-2026-0002502 — getTicketWorkflowBlueprint: internal-only, ticket:read, row-level read
// authorization (same loader as Duplicate), allowlisted custom-field values, checklist provenance.
import { getTicketWorkflowBlueprint } from '../ticketActions';

const { withTransactionMock, createTenantKnexMock, hasPermissionMock, authorizeResourceMock, tagsMock } = vi.hoisted(() => ({
  withTransactionMock: vi.fn(),
  createTenantKnexMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  authorizeResourceMock: vi.fn(),
  tagsMock: vi.fn(),
}));

let currentUser: any = { user_id: 'u1', user_type: 'internal', roles: [{ role_id: 'r1' }] };

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn(currentUser, { tenant: 'tenant-1' }, ...args),
  withOptionalAuth: (fn: any) => fn,
  hasPermission: vi.fn(async () => true),
  getCurrentUser: vi.fn(async () => null),
  localizeActionError: (e: any) => e,
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: hasPermissionMock }));
vi.mock('@alga-psa/db', () => ({
  withTransaction: withTransactionMock,
  createTenantKnex: createTenantKnexMock,
  registerAfterCommit: vi.fn(),
  tenantDb: (conn: any) => ({
    table: (table: string) => conn(table),
    unscoped: (table: string) => conn(table),
    tenantJoin: () => undefined,
  }),
}));
vi.mock('@alga-psa/tags/models/tagMapping', () => ({ default: { getByEntity: (...a: unknown[]) => tagsMock(...a) } }));
vi.mock('@alga-psa/authorization/kernel', () => ({
  BuiltinAuthorizationKernelProvider: class {},
  BundleAuthorizationKernelProvider: class {},
  RequestLocalAuthorizationCache: class {},
  createAuthorizationKernel: () => ({ authorizeResource: (...a: unknown[]) => authorizeResourceMock(...a) }),
}));
vi.mock('@alga-psa/authorization/bundles/service', () => ({ resolveBundleNarrowingRulesForEvaluation: vi.fn(async () => []) }));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(), publishWorkflowEvent: vi.fn(), publishNonCatalogWorkflowEvent: vi.fn(),
  publishStoredWorkflowEvent: vi.fn(), publishBuiltWorkflowPayload: vi.fn(), publishNonCatalogEventByName: vi.fn(),
  publishUnregisteredEventType: vi.fn(),
}));
vi.mock('@alga-psa/event-bus', () => ({ getEventBus: () => ({ publish: vi.fn() }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const TICKET_ID = '11111111-1111-4111-8111-111111111111';
const TEMPLATE_A = '22222222-2222-4222-8222-222222222222';
const TEMPLATE_B = '33333333-3333-4333-8333-333333333333';

const ticketRow = {
  ticket_id: TICKET_ID,
  ticket_number: 'T-1',
  title: 'Onboard',
  client_id: 'c1',
  contact_name_id: null,
  board_id: 'b1',
  priority_id: 'p1',
  assigned_to: 'u9',
  assigned_team_id: null,
  attributes: {
    description: 'desc',
    custom_fields: { f1: 'v1' },
    watch_list: ['secret'],
    sla_last_threshold_notified: 80,
  },
};

const tableRows: Record<string, any> = {};
const selectedTables: string[] = [];

function createTrx() {
  return (table: string) => {
    selectedTables.push(table);
    const rows = tableRows[table];
    const chain: any = {
      where: () => chain,
      whereIn: () => chain,
      orderBy: () => chain,
      select: () => chain,
      first: async () => (Array.isArray(rows) ? rows[0] : rows),
      then: (resolve: any, reject: any) => Promise.resolve(Array.isArray(rows) ? rows : rows ? [rows] : []).then(resolve, reject),
    };
    return chain;
  };
}

describe('getTicketWorkflowBlueprint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectedTables.length = 0;
    currentUser = { user_id: 'u1', user_type: 'internal', roles: [{ role_id: 'r1' }] };
    createTenantKnexMock.mockResolvedValue({ knex: {} });
    hasPermissionMock.mockResolvedValue(true);
    authorizeResourceMock.mockResolvedValue({ allowed: true });
    tagsMock.mockResolvedValue([{ tag_id: 't1', tag_text: 'hr', background_color: null, text_color: null }]);
    withTransactionMock.mockImplementation(async (_db: any, cb: any) => cb(createTrx()));
    for (const key of Object.keys(tableRows)) delete tableRows[key];
    tableRows.tickets = ticketRow;
    tableRows.clients = { client_id: 'c1', client_name: 'Acme', client_type: 'company' };
    tableRows['ticket_resources as tr'] = [{ user_id: 'u2', first_name: 'A', last_name: 'B' }];
    tableRows.ticket_checklist_items = [
      { item_name: 'from tpl', description: null, is_required: true, template_id: TEMPLATE_A },
      { item_name: 'orphan', description: 'd', is_required: false, template_id: TEMPLATE_B },
      { item_name: 'manual', description: null, is_required: false, template_id: null },
    ];
    tableRows.checklist_templates = [{ template_id: TEMPLATE_A, name: 'Tpl A', is_active: true }];
  });

  it('is internal-only', async () => {
    currentUser = { user_id: 'c', user_type: 'client', roles: [] };
    const result: any = await getTicketWorkflowBlueprint(TICKET_ID);
    expect(result.permissionError ?? result.message ?? JSON.stringify(result)).toMatch(/client portal/i);
    expect(withTransactionMock).not.toHaveBeenCalled();
  });

  it('requires ticket:read (and not ticket:create)', async () => {
    hasPermissionMock.mockImplementation(async (_u: any, resource: string, action: string) => !(resource === 'ticket' && action === 'read'));
    const result: any = await getTicketWorkflowBlueprint(TICKET_ID);
    expect(JSON.stringify(result)).toContain('Permission denied: Cannot view ticket');

    hasPermissionMock.mockImplementation(async (_u: any, resource: string, action: string) => resource === 'ticket' && action === 'read');
    const ok: any = await getTicketWorkflowBlueprint(TICKET_ID);
    expect(ok.ticket_id).toBe(TICKET_ID);
    expect(hasPermissionMock.mock.calls.some((c) => c[2] === 'create')).toBe(false);
  });

  it('denies with the standard message when row-level authorization fails, loading nothing else', async () => {
    authorizeResourceMock.mockResolvedValue({ allowed: false });
    const result: any = await getTicketWorkflowBlueprint(TICKET_ID);
    expect(JSON.stringify(result)).toContain('Permission denied: Cannot view ticket');
    expect(selectedTables).not.toContain('clients');
    expect(tagsMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed id as not found', async () => {
    const result: any = await getTicketWorkflowBlueprint('nope');
    expect(JSON.stringify(result)).toContain('Source ticket not found');
  });

  it('returns allowlisted custom-field values and checklist provenance', async () => {
    const result: any = await getTicketWorkflowBlueprint(TICKET_ID);
    expect(result.custom_fields).toEqual({ f1: 'v1' });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result).not.toHaveProperty('attributes');
    expect(result).toMatchObject({
      description: 'desc',
      assigned_to: 'u9',
      tags: [{ tag_id: 't1', tag_text: 'hr' }],
      additional_agents: [{ user_id: 'u2' }],
    });
    expect(result.checklist).toEqual([
      { item_name: 'from tpl', description: null, is_required: true, template_id: TEMPLATE_A, template_name: 'Tpl A', template_is_active: true },
      { item_name: 'orphan', description: 'd', is_required: false, template_id: TEMPLATE_B, template_name: null, template_is_active: null },
      { item_name: 'manual', description: null, is_required: false, template_id: null, template_name: null, template_is_active: null },
    ]);
  });
});
