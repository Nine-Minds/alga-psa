/**
 * An organization-name redaction hides the name on both read surfaces: the live read (`readCoManagedCustomerOrganizationName`,
 * which feeds the project list) and the Shared Tasks queue row's cached snapshot. Unlike assignedTaskQueue.test.ts, `redactedFields`
 * here is NOT hand-fed: the REAL `withCoManagedSharedWork` computes it as the union of the home policy (the authorization
 * kernel's decision) and the relationship row's `redacted_fields`. Mocked, and only these: the kernel decision, local authentication,
 * the licence gate and the workspace-served gate. Tables are the in-memory store used by the other co-managed tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFake, type FakeStore } from './fakeCoManagedDb';

const gate = vi.hoisted(() => ({ homeRedacted: [] as string[] }));

vi.mock('@alga-psa/db', async () => {
  const fake = await import('./fakeCoManagedDb');
  return {
    tenantDb: (db: any, tenant: string) => ({ ...fake.fakeTenantDb(db, tenant), tenantJoin: () => undefined }),
    tenantTableMetadata: {},
    withTransaction: async (db: any, work: any) => db.transaction(work),
    registerAfterCommit: () => undefined,
  };
});
vi.mock('@alga-psa/licensing/lifecycle', () => ({
  getCoManagedOperationalState: async () => ({ canWrite: true }),
  assertCoManagedOperationalWrite: async () => undefined,
}));
vi.mock('../projectTaskGate', () => ({ assertCoManagedProjectWorkServed: async () => undefined }));
vi.mock('../localAuthentication', () => ({
  snapshotCoManagedAuthenticatedActor: (actor: any) => ({ ...actor }),
  lockCoManagedLocalAuthentication: async (_trx: any, actor: any) => ({ actor, subject: { tenant: actor.tenant, userId: actor.userId, teamIds: [], roleIds: [] }, assertCurrent: async () => undefined }),
}));
vi.mock('../localPermission', () => ({ hasCoManagedLocalPermission: async () => true }));
vi.mock('@alga-psa/authorization', () => ({
  createAuthorizationKernel: () => ({ authorizeResource: async () => ({ allowed: true, redactedFields: [...gate.homeRedacted], scope: { constraints: [] } }) }),
  BuiltinAuthorizationKernelProvider: class {}, BundleAuthorizationKernelProvider: class {},
  resolveBundleNarrowingRulesForEvaluation: async () => [],
}));

import { listCoManagedAssignedTasks, readCoManagedCustomerOrganizationName } from '../projectTaskQueue';
import { withCoManagedSharedWork } from '../sharedWork';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const HOME = U(1), USER = U(2), SESSION = U(3), CUSTOMER = U(4), RELATIONSHIP = U(5), PROJECT = U(6), PHASE = U(7), TASK = U(8), REFERENCE = U(9);
const actor = { kind: 'session' as const, tenant: HOME, userId: USER, sessionId: SESSION };

let store: FakeStore, db: any;
/** Seeds a live relationship whose `redacted_fields` is the relationship-policy source of redactions. */
function seed(relationshipRedacted: string[]) {
  store.seed('tenants', { tenant: HOME, product_code: 'psa', suspended_at: null }, { tenant: CUSTOMER, product_code: 'co_managed', suspended_at: null, client_name: 'Acme Corp' });
  store.seed('users', { tenant: HOME, user_id: USER, user_type: 'internal', is_inactive: false });
  store.seed('sessions', { tenant: HOME, session_id: SESSION, user_id: USER, revoked_at: null });
  store.seed('co_management_relationships', { tenant: CUSTOMER, relationship_id: RELATIONSHIP, sponsor_tenant: HOME, sponsor_client_id: U(10), state: 'active', ended_at: null,
    visibility_mode: 'board_scope', revision: 1, redacted_fields: relationshipRedacted });
  store.seed('co_management_staff_assignments', { tenant: HOME, customer_tenant: CUSTOMER, relationship_id: RELATIONSHIP, principal_type: 'user', principal_id: USER, relationship_role: 'technician' });
  store.seed('projects', { tenant: CUSTOMER, project_id: PROJECT, project_name: 'Rollout' });
  store.seed('project_tasks', { tenant: CUSTOMER, task_id: TASK, phase_id: PHASE, project_id: PROJECT, task_name: 'Task 1' });
  store.seed('co_management_project_scopes', { tenant: CUSTOMER, relationship_id: RELATIONSHIP, project_id: PROJECT, can_collaborate: true });
  store.seed('co_managed_project_task_references', { tenant: HOME, active: true, reference_id: REFERENCE, customer_tenant: CUSTOMER, relationship_id: RELATIONSHIP, task_id: TASK,
    task_name: 'Task 1', project_name: 'Rollout', organization_name: 'Acme Corp', assignee_name: 'Alex', assigned_to: USER, revision: 1 });
}
const liveRead = () => withCoManagedSharedWork(db, actor, { tenant: CUSTOMER, relationshipId: RELATIONSHIP, kind: 'project', id: PROJECT }, 'read',
  context => readCoManagedCustomerOrganizationName(context.trx, CUSTOMER, context.redactedFields));
const queueRow = async () => (await listCoManagedAssignedTasks(db, actor)).rows[0];

beforeEach(() => { ({ store, db } = createFake()); gate.homeRedacted = []; });

describe('organization-name redaction through the effective policy', () => {
  const spellings = ['organization_name', 'values.organization_name', 'client_name'];
  const sources = [
    ['relationship policy', (field: string) => { seed([field]); }],
    ['home policy', (field: string) => { seed([]); gate.homeRedacted = [field]; }],
  ] as const;

  describe.each(sources)('redacted by the %s', (_source, arrange) => {
    it.each(spellings)('%s hides the name on the live read and in the queue row', async field => {
      arrange(field);
      expect(await liveRead()).toBe('');
      expect(await queueRow()).toMatchObject({ organizationName: null, taskName: 'Task 1', projectName: 'Rollout', assigneeName: 'Alex', assignedToMe: true });
    });
  });

  it('shows the real name on both surfaces when nothing is redacted (no over-masking)', async () => {
    seed([]);
    expect(await liveRead()).toBe('Acme Corp');
    expect(await queueRow()).toMatchObject({ organizationName: 'Acme Corp', taskName: 'Task 1', projectName: 'Rollout', assigneeName: 'Alex' });
  });

  it('keeps the name when an unrelated field is redacted by either policy', async () => {
    seed(['project_name']);
    gate.homeRedacted = ['task_name'];
    expect(await liveRead()).toBe('Acme Corp');
    expect(await queueRow()).toMatchObject({ organizationName: 'Acme Corp', taskName: null, projectName: null });
  });
});
