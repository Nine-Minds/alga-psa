/**
 * A sponsoring MSP with more than one live customer must still be able to reach
 * every sponsor-side co-managed route. Before this coverage existed, the three
 * policy-family routes answered an unqualified sponsor with FORBIDDEN, because
 * the action layer collapsed "you have not said which workspace" into the same
 * error as "you may not see this workspace".
 */
import { beforeEach, expect, it, vi } from 'vitest';
import { getCoManagedPolicyScreen, getCoManagedSlaPolicyScreen } from '../../../lib/actions/coManagedPolicyActions';
import { getCoManagedDepartureScreenAction } from '../../../lib/actions/coManagedDepartureActions';
import { getCoManagedDelegatedAdministration } from '../../../lib/actions/coManagedDelegatedAdministrationActions';
import { getCoManagedClientOverviewAction } from '../../../lib/actions/coManagedActions';

const mocks = vi.hoisted(() => ({
  browser: vi.fn(), overview: vi.fn(), policy: vi.fn(), sla: vi.fn(), departure: vi.fn(),
  delegatedScreen: vi.fn(), delegatedList: vi.fn(), resolve: vi.fn(), lifecycle: vi.fn(), db: {},
  user: { tenant: '00000000-0000-4000-8000-000000000001', user_id: '00000000-0000-4000-8000-000000000002', user_type: 'internal' },
  rows: {} as Record<string, any[]>,
}));
const SPONSOR = mocks.user.tenant;
const OP_RABBIT = '00000000-0000-4000-8000-00000000000a';
const OP_MUNCHKIN = '00000000-0000-4000-8000-00000000000b';
const OP_GONE = '00000000-0000-4000-8000-00000000000c';

vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: any) => (...args: any[]) => fn(mocks.user, { tenant: mocks.user.tenant }, ...args) }));
vi.mock('../../../lib/co-managed/browserActor', () => ({ coManagedBrowserActor: mocks.browser }));
vi.mock('@alga-psa/licensing', () => ({ getCoManagedOperationalState: mocks.lifecycle }));
vi.mock('@alga-psa/email', () => ({ sendTeamInvitationEmail: vi.fn() }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async () => true }));
vi.mock('@alga-psa/co-managed', () => ({
  CoManagedPolicyError: class extends Error { constructor(public code: string) { super(code); } },
  CoManagedSharedWorkError: class extends Error { constructor() { super('Forbidden'); } },
  isCoManagedUuid: (value: any) => typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value),
  getCoManagedClientOverview: mocks.overview,
  resolveCoManagedManagementTarget: mocks.resolve,
  getCoManagedCollaborationPolicy: mocks.policy,
  getCoManagedSlaPriorityMappings: mocks.sla,
  getCoManagedDepartureScreen: mocks.departure,
  getCoManagedDelegatedScreen: mocks.delegatedScreen,
  listCoManagedDelegatedWorkspaces: mocks.delegatedList,
  readCoManagedClientManagement: vi.fn(), getCoManagedClientOverviewPage: vi.fn(),
  replaceCoManagedCustomerScope: vi.fn(), replaceCoManagedStaffAssignments: vi.fn(),
  replaceCoManagedSlaPriorityMappings: vi.fn(), departCoManagedRelationship: vi.fn(),
  saveCoManagedDelegatedGrant: vi.fn(), revokeCoManagedDelegatedGrant: vi.fn(),
  searchCoManagedDelegatedOptions: vi.fn(), executeCoManagedDelegatedCommand: vi.fn(),
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: mocks.db }),
  withTransaction: async (db: any, fn: any) => fn(db),
  tenantDb: (_db: any, tenant: string) => ({
    table: (table: string) => {
      let rows = mocks.rows[`${tenant}:${table}`] ?? [];
      const query: any = {
        where: (key: any, value: any) => { rows = rows.filter(row => typeof key === 'string' ? row[key] === value : Object.entries(key).every(([k, v]) => row[k] === v)); return query; },
        whereNull: (key: string) => { rows = rows.filter(row => row[key] == null); return query; },
        first: async () => rows[0],
      };
      return query;
    },
  }),
}));

/** Two live customers, which is the normal MSP shape and the fixture shape. */
function twoLiveCustomers() {
  return {
    rows: [
      { operationId: OP_RABBIT, clientId: 'client-rabbit', workspaceName: 'White Rabbit', clientName: 'White Rabbit', ended: false },
      { operationId: OP_MUNCHKIN, clientId: 'client-munchkin', workspaceName: 'Munchkin Country IT', clientName: 'Munchkin Country IT', ended: false },
    ],
    totalCount: 2, page: 1, pageSize: 100,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.browser.mockResolvedValue({ kind: 'session', tenant: SPONSOR, userId: mocks.user.user_id, sessionId: 'tracked' });
  mocks.overview.mockResolvedValue(twoLiveCustomers());
  mocks.delegatedList.mockResolvedValue([{ operationId: OP_RABBIT, name: 'White Rabbit' }, { operationId: OP_MUNCHKIN, name: 'Munchkin Country IT' }]);
  mocks.rows = {
    [`${SPONSOR}:tenants`]: [{ product_code: 'psa' }],
    [`${SPONSOR}:co_managed_provisioning_operations`]: [
      { operation_id: OP_RABBIT, customer_tenant: 'tenant-rabbit', relationship_id: 'rel-rabbit' },
      { operation_id: OP_MUNCHKIN, customer_tenant: 'tenant-munchkin', relationship_id: 'rel-munchkin' },
    ],
  };
});

it('offers both workspaces on the policy, SLA and departure routes instead of denying', async () => {
  const expected = { side: 'directory', workspaces: [
    { operationId: OP_RABBIT, clientId: 'client-rabbit', name: 'White Rabbit' },
    { operationId: OP_MUNCHKIN, clientId: 'client-munchkin', name: 'Munchkin Country IT' },
  ] };
  await expect(getCoManagedPolicyScreen()).resolves.toEqual(expected);
  await expect(getCoManagedSlaPolicyScreen()).resolves.toEqual(expected);
  await expect(getCoManagedDepartureScreenAction()).resolves.toEqual(expected);
  // The choice replaces resolution; no target is resolved and no screen is read.
  expect(mocks.resolve).not.toHaveBeenCalled();
  expect(mocks.policy).not.toHaveBeenCalled();
  expect(mocks.sla).not.toHaveBeenCalled();
  expect(mocks.departure).not.toHaveBeenCalled();
});

it('reaches the other two sponsor-side routes with the same two customers', async () => {
  await expect(getCoManagedClientOverviewAction({})).resolves.toMatchObject({ totalCount: 2 });
  await expect(getCoManagedDelegatedAdministration()).resolves.toMatchObject({ side: 'directory', workspaces: [
    { operationId: OP_RABBIT }, { operationId: OP_MUNCHKIN }] });
});

it('does not prompt a sponsor that has only one live workspace', async () => {
  mocks.overview.mockResolvedValue({ rows: [twoLiveCustomers().rows[0]], totalCount: 1, page: 1, pageSize: 100 });
  mocks.resolve.mockResolvedValue({ kind: 'resolved', target: { side: 'sponsor', customerTenant: 'customer', relationshipId: 'rel', otherTenant: 'customer' } });
  mocks.policy.mockResolvedValue({ visibilityMode: 'board_scope', boards: [], projects: [], assignments: [], revision: 1 });
  mocks.lifecycle.mockResolvedValue({ canWrite: true });
  const screen = await getCoManagedPolicyScreen() as any;
  expect(screen.side).toBe('sponsor');
  expect(screen.target).toEqual({ customerTenant: 'tenant-rabbit', relationshipId: 'rel-rabbit' });
});

it('ignores ended relationships when counting live workspaces', async () => {
  mocks.overview.mockResolvedValue({ rows: [
    ...twoLiveCustomers().rows,
    { operationId: OP_GONE, clientId: 'client-gone', workspaceName: 'Departed', clientName: 'Departed', ended: true },
  ], totalCount: 3, page: 1, pageSize: 100 });
  const screen = await getCoManagedPolicyScreen() as any;
  expect(screen.workspaces.map((entry: any) => entry.operationId)).toEqual([OP_RABBIT, OP_MUNCHKIN]);
});

it('leaves a customer tenant on its own home resolution, with no choice to make', async () => {
  mocks.rows = { [`${SPONSOR}:tenants`]: [{ product_code: 'co_managed' }] };
  mocks.resolve.mockResolvedValue({ kind: 'resolved', target: { side: 'customer', customerTenant: SPONSOR, relationshipId: 'rel', otherTenant: 'sponsor' } });
  mocks.policy.mockResolvedValue({ visibilityMode: 'board_scope', boards: [], projects: [], assignments: [], revision: 1 });
  mocks.lifecycle.mockResolvedValue({ canWrite: true });
  const screen = await getCoManagedPolicyScreen() as any;
  expect(screen.side).toBe('customer');
  expect(mocks.overview).not.toHaveBeenCalled();
  expect(mocks.resolve).toHaveBeenCalledWith(mocks.db, expect.anything(), { kind: 'customer-home' });
});
