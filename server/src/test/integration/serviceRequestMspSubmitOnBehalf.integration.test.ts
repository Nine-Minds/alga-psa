import { createRequire } from 'node:module';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { submitPortalServiceRequest } from '../../lib/service-requests/submissionService';
import {
  listDefinitionsForRequester,
  MspSubmissionError,
  resolveRequesterForMspSubmission,
  submitOnBehalfOfMsp,
} from '../../lib/service-requests/mspSubmissions';

// The actions and the API controller resolve identity and connections through these seams; the suite
// points them at the real test database and a per-test "current user". RBAC itself is NOT mocked:
// hasPermission reads the real roles/permissions rows.
const seam = vi.hoisted(() => ({ db: null as any, user: null as any }));

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return { ...actual, createTenantKnex: vi.fn(async () => ({ knex: seam.db, tenant: seam.user?.tenant })) };
});
vi.mock('../../lib/db/db', async () => {
  const actual = await vi.importActual<typeof import('../../lib/db/db')>('../../lib/db/db');
  return { ...actual, getConnection: vi.fn(async () => seam.db) };
});
vi.mock('@alga-psa/auth', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/auth')>('@alga-psa/auth');
  return {
    ...actual,
    withAuth: (action: any) => (...args: any[]) => action(seam.user, { tenant: seam.user.tenant }, ...args),
  };
});

// The action words a rejected submission in the signed-in user's language; `server-only` is not
// resolvable outside Next, so the translator is stood in for by one that echoes the key.
vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

import { submitOnBehalfServiceRequestAction } from '../../app/msp/service-requests/onBehalfActions';
import { ApiServiceRequestController } from '../../lib/api/controllers/ApiServiceRequestController';

const nodeRequire = createRequire(import.meta.url);
const permissionsDir = path.resolve(__dirname, '../../../migrations/utils/permissions');
const { DEFAULT_ROLES } = nodeRequire(path.join(permissionsDir, 'roleGrants.cjs'));
const { syncPermissionCatalog } = nodeRequire(path.join(permissionsDir, 'syncPermissionCatalog.cjs'));

let db: Knex;
const tenantsToCleanup = new Set<string>();

const t = (tenant: string, table: string) => tenantDb(db, tenant).table(table);
const tenantRows = () =>
  tenantDb(db, '__test_tenant_fixture__').unscoped('tenants', 'test fixture creates and removes tenant rows');

interface Fixture {
  tenant: string;
  technicianId: string;
  portalUserId: string;
  clientId: string;
  otherClientId: string;
  contactWithUser: string;
  contactWithoutUser: string;
  otherClientContact: string;
  boardId: string;
  statusId: string;
  priorityId: string;
}

async function createUser(tenant: string, userId: string, name: string, extra: Record<string, unknown> = {}) {
  await t(tenant, 'users').insert({
    tenant,
    user_id: userId,
    username: `${name}-${userId.slice(0, 8)}`,
    hashed_password: 'not-used',
    email: `${name}-${userId.slice(0, 8)}@example.com`,
    ...extra,
  });
}

async function createFixture(): Promise<Fixture> {
  const f: Fixture = {
    tenant: uuidv4(),
    technicianId: uuidv4(),
    portalUserId: uuidv4(),
    clientId: uuidv4(),
    otherClientId: uuidv4(),
    contactWithUser: uuidv4(),
    contactWithoutUser: uuidv4(),
    otherClientContact: uuidv4(),
    boardId: uuidv4(),
    statusId: uuidv4(),
    priorityId: uuidv4(),
  };
  const { tenant } = f;
  tenantsToCleanup.add(tenant);

  await tenantRows().insert({
    tenant,
    client_name: `Tenant ${tenant.slice(0, 8)}`,
    email: `tenant-${tenant.slice(0, 8)}@example.com`,
  });
  await createUser(tenant, f.technicianId, 'tech', { user_type: 'internal' });
  for (const [clientId, name] of [[f.clientId, 'A'], [f.otherClientId, 'B']] as const) {
    await t(tenant, 'clients').insert({
      tenant,
      client_id: clientId,
      client_name: `Client ${name} ${tenant.slice(0, 8)}`,
      is_inactive: false,
      billing_cycle: 'monthly',
      is_tax_exempt: false,
    });
  }
  for (const [contactId, clientId, name] of [
    [f.contactWithUser, f.clientId, 'with-user'],
    [f.contactWithoutUser, f.clientId, 'no-user'],
    [f.otherClientContact, f.otherClientId, 'other'],
  ] as const) {
    await t(tenant, 'contacts').insert({
      tenant,
      contact_name_id: contactId,
      full_name: `Contact ${name}`,
      email: `${name}-${tenant.slice(0, 8)}@example.com`,
      client_id: clientId,
    });
  }
  await createUser(tenant, f.portalUserId, 'portal', {
    user_type: 'client',
    contact_id: f.contactWithUser,
    is_inactive: false,
  });

  await t(tenant, 'boards').insert({
    tenant,
    board_id: f.boardId,
    board_name: `Support ${tenant.slice(0, 8)}`,
    description: 'Support board',
    display_order: 10,
    is_default: true,
    is_inactive: false,
    category_type: 'custom',
    priority_type: 'custom',
  });
  await t(tenant, 'priorities').insert({
    tenant,
    priority_id: f.priorityId,
    priority_name: 'High',
    item_type: 'ticket',
    order_number: 10,
    color: '#EF4444',
    created_by: f.technicianId,
  });
  await t(tenant, 'statuses').insert({
    tenant,
    status_id: f.statusId,
    board_id: f.boardId,
    name: 'Open',
    status_type: 'ticket',
    item_type: 'ticket',
    is_closed: false,
    is_default: true,
    order_number: 10,
    created_by: f.technicianId,
  });
  return f;
}

async function createDefinition(f: Fixture, audience?: Record<string, unknown>): Promise<string> {
  const definitionId = uuidv4();
  const executionConfig = {
    boardId: f.boardId,
    statusId: f.statusId,
    priorityId: f.priorityId,
    titleFieldKey: 'request_title',
  };
  const formSchema = {
    fields: [{ key: 'request_title', type: 'short-text', label: 'Request Title', required: true }],
  };
  await t(f.tenant, 'service_request_definitions').insert({
    tenant: f.tenant,
    definition_id: definitionId,
    name: 'Employee Onboarding',
    form_schema: formSchema,
    execution_provider: 'ticket-only',
    execution_config: executionConfig,
    form_behavior_provider: 'basic',
    form_behavior_config: {},
    visibility_provider: 'all-authenticated-client-users',
    visibility_config: {},
    lifecycle_state: 'published',
    published_at: db.fn.now(),
    ...(audience ? { audience: JSON.stringify(audience) } : {}),
  });
  await t(f.tenant, 'service_request_definition_versions').insert({
    tenant: f.tenant,
    version_id: uuidv4(),
    definition_id: definitionId,
    version_number: 1,
    name: 'Employee Onboarding',
    form_schema_snapshot: formSchema,
    execution_provider: 'ticket-only',
    execution_config: executionConfig,
    form_behavior_provider: 'basic',
    form_behavior_config: {},
    visibility_provider: 'all-authenticated-client-users',
    visibility_config: {},
  });
  return definitionId;
}

async function cleanupTenant(tenant: string) {
  for (const table of [
    'user_roles',
    'role_permissions',
    'roles',
    'permissions',
    'ticket_audit_logs',
    'service_request_submission_attachments',
    'service_request_submissions',
    'service_request_definition_versions',
    'service_request_definitions',
    'tickets',
    'next_number',
    'statuses',
    'priorities',
    'boards',
    'contacts',
    'clients',
    'users',
    'tenant_settings',
  ]) {
    await t(tenant, table).del();
  }
  await tenantRows().where({ tenant }).del();
}

async function submitMsp(
  f: Fixture,
  definitionId: string,
  contactId: string,
  extra: { clientSubmissionKey?: string | null; clientId?: string } = {}
) {
  const requester = await resolveRequesterForMspSubmission(
    db,
    f.tenant,
    extra.clientId ?? f.clientId,
    contactId,
    f.technicianId
  );
  return submitOnBehalfOfMsp({
    knex: db,
    tenant: f.tenant,
    definitionId,
    requester,
    payload: { request_title: 'Laptop for new hire' },
    clientSubmissionKey: extra.clientSubmissionKey ?? null,
  });
}

const countRows = async (tenant: string, table: string) =>
  Number((await t(tenant, table).count('* as n').first())?.n ?? 0);

describe('MSP submit service request on behalf of a client contact', () => {
  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
    seam.db = db;
  });
  afterEach(async () => {
    for (const tenant of tenantsToCleanup) {
      await cleanupTenant(tenant);
      tenantsToCleanup.delete(tenant);
    }
  });
  afterAll(async () => {
    await db?.destroy();
  });

  it('contact WITH a portal user: portal user is requester, technician is submitter/entered_by', async () => {
    const f = await createFixture();
    const definitionId = await createDefinition(f);
    const result = await submitMsp(f, definitionId, f.contactWithUser);
    expect(result.executionStatus).toBe('succeeded');

    const submission = await t(f.tenant, 'service_request_submissions').where({ submission_id: result.submissionId }).first();
    expect(submission).toMatchObject({
      requester_user_id: f.portalUserId,
      submitted_by_user_id: f.technicianId,
      contact_id: f.contactWithUser,
      client_id: f.clientId,
    });
    const ticket = await t(f.tenant, 'tickets').where({ ticket_id: result.createdTicketId }).first();
    expect(ticket).toMatchObject({
      contact_name_id: f.contactWithUser,
      client_id: f.clientId,
      entered_by: f.technicianId,
      ticket_origin: 'internal',
      source: 'msp',
    });
    const audit = await db('audit_logs')
      .where({ tenant: f.tenant, operation: 'service_request_submission_created' })
      .first();
    expect(audit?.user_id).toBe(f.technicianId);
    expect(JSON.stringify(audit?.details)).toContain(f.portalUserId);
  });

  it('contact WITHOUT a portal user: requester_user_id is NULL, technician is never the requester', async () => {
    const f = await createFixture();
    const definitionId = await createDefinition(f);
    const result = await submitMsp(f, definitionId, f.contactWithoutUser);
    expect(result.executionStatus).toBe('succeeded');

    const submission = await t(f.tenant, 'service_request_submissions').where({ submission_id: result.submissionId }).first();
    expect(submission.requester_user_id).toBeNull();
    expect(submission.submitted_by_user_id).toBe(f.technicianId);
    expect(submission.contact_id).toBe(f.contactWithoutUser);
    const ticket = await t(f.tenant, 'tickets').where({ ticket_id: result.createdTicketId }).first();
    expect(ticket).toMatchObject({
      contact_name_id: f.contactWithoutUser,
      client_id: f.clientId,
      entered_by: f.technicianId,
      ticket_origin: 'internal',
      source: 'msp',
    });
  });

  it('an inactive portal user is treated as no portal user', async () => {
    const f = await createFixture();
    await t(f.tenant, 'users').where({ user_id: f.portalUserId }).update({ is_inactive: true });
    const requester = await resolveRequesterForMspSubmission(db, f.tenant, f.clientId, f.contactWithUser, f.technicianId);
    expect(requester.requesterUserId).toBeNull();
    expect(requester.submittedByUserId).toBe(f.technicianId);
  });

  it('audience refusal: an excluded contact cannot be submitted for; no submission or ticket is created', async () => {
    const f = await createFixture();
    const audience = {
      join: 'or',
      clauses: [{ path: 'contact.id', operator: 'in', value: [f.contactWithUser] }],
    };
    const definitionId = await createDefinition(f, audience);

    const requester = await resolveRequesterForMspSubmission(db, f.tenant, f.clientId, f.contactWithoutUser, f.technicianId);
    expect((await listDefinitionsForRequester(db, f.tenant, requester)).map((item) => item.definitionId)).not.toContain(definitionId);

    await expect(submitMsp(f, definitionId, f.contactWithoutUser)).rejects.toMatchObject({
      code: 'definition_not_visible',
    });
    expect(await countRows(f.tenant, 'service_request_submissions')).toBe(0);
    expect(await countRows(f.tenant, 'tickets')).toBe(0);

    // The included contact still sees and can file it.
    const visible = await listDefinitionsForRequester(
      db,
      f.tenant,
      await resolveRequesterForMspSubmission(db, f.tenant, f.clientId, f.contactWithUser, f.technicianId)
    );
    expect(visible.map((item) => item.definitionId)).toContain(definitionId);
    expect((await submitMsp(f, definitionId, f.contactWithUser)).executionStatus).toBe('succeeded');
  });

  it('rejects a contact that does not belong to the client', async () => {
    const f = await createFixture();
    const definitionId = await createDefinition(f);
    await expect(submitMsp(f, definitionId, f.otherClientContact)).rejects.toBeInstanceOf(MspSubmissionError);
    await expect(submitMsp(f, definitionId, uuidv4())).rejects.toMatchObject({ code: 'contact_not_found' });
    expect(await countRows(f.tenant, 'service_request_submissions')).toBe(0);
    expect(await countRows(f.tenant, 'tickets')).toBe(0);
  });

  for (const [label, pick] of [
    ['portal-user contact', (f: Fixture) => f.contactWithUser],
    ['NULL-requester contact', (f: Fixture) => f.contactWithoutUser],
  ] as const) {
    it(`same-key replay yields one submission and one ticket (${label})`, async () => {
      const f = await createFixture();
      const definitionId = await createDefinition(f);
      const key = uuidv4();
      const first = await submitMsp(f, definitionId, pick(f), { clientSubmissionKey: key });
      const second = await submitMsp(f, definitionId, pick(f), { clientSubmissionKey: key });
      expect(second.replayed).toBe(true);
      expect(second.submissionId).toBe(first.submissionId);
      expect(second.createdTicketId).toBe(first.createdTicketId);
      expect(await countRows(f.tenant, 'service_request_submissions')).toBe(1);
      expect(await countRows(f.tenant, 'tickets')).toBe(1);
    });
  }

  it('concurrent same-key submits for a NULL-requester contact collapse to one submission', async () => {
    const f = await createFixture();
    const definitionId = await createDefinition(f);
    const key = uuidv4();
    const results = await Promise.all([
      submitMsp(f, definitionId, f.contactWithoutUser, { clientSubmissionKey: key }),
      submitMsp(f, definitionId, f.contactWithoutUser, { clientSubmissionKey: key }),
    ]);
    expect(new Set(results.map((r) => r.submissionId)).size).toBe(1);
    expect(await countRows(f.tenant, 'service_request_submissions')).toBe(1);
  });

  it('portal regression: portal submissions stay client_portal, requester-owned, with no submitter', async () => {
    const f = await createFixture();
    const definitionId = await createDefinition(f);
    const result = await submitPortalServiceRequest({
      knex: db,
      tenant: f.tenant,
      definitionId,
      requesterUserId: f.portalUserId,
      clientId: f.clientId,
      contactId: f.contactWithUser,
      payload: { request_title: 'From the portal' },
    });
    expect(result.executionStatus).toBe('succeeded');
    const submission = await t(f.tenant, 'service_request_submissions').where({ submission_id: result.submissionId }).first();
    expect(submission.requester_user_id).toBe(f.portalUserId);
    expect(submission.submitted_by_user_id).toBeNull();
    const ticket = await t(f.tenant, 'tickets').where({ ticket_id: result.createdTicketId }).first();
    expect(ticket).toMatchObject({
      entered_by: f.portalUserId,
      ticket_origin: 'client_portal',
      source: 'client_portal',
      contact_name_id: f.contactWithUser,
    });
  });

  describe('submit permission gate (ticket:create + client:read + contact:read)', () => {
    /** Creates the tenant's default psa roles and syncs the catalog's default grants onto them. */
    async function seedDefaultRoles(f: Fixture) {
      await t(f.tenant, 'roles').insert(
        DEFAULT_ROLES.psa
          .filter((role: any) => !role.legacy)
          .map((role: any) => ({
            tenant: f.tenant,
            role_name: role.roleName,
            description: `${role.roleName} (${role.msp ? 'msp' : 'client'})`,
            msp: role.msp,
            client: role.client,
          }))
      );
      await syncPermissionCatalog(db, f.tenant, 'psa');
    }

    async function assignDefaultRole(f: Fixture, userId: string, roleName: string) {
      const role = await t(f.tenant, 'roles').where({ role_name: roleName, msp: true, client: false }).first('role_id');
      await t(f.tenant, 'user_roles').insert({ tenant: f.tenant, user_id: userId, role_id: role.role_id });
    }

    /** A custom role holding exactly the given resource:action pairs. */
    async function assignCustomRole(f: Fixture, userId: string, grants: Array<[string, string]>) {
      const roleId = uuidv4();
      await t(f.tenant, 'roles').insert({ tenant: f.tenant, role_id: roleId, role_name: `Custom ${roleId.slice(0, 6)}`, msp: true, client: false });
      for (const [resource, action] of grants) {
        const permission = await t(f.tenant, 'permissions').where({ resource, action, msp: true }).first('permission_id');
        await t(f.tenant, 'role_permissions').insert({ tenant: f.tenant, role_id: roleId, permission_id: permission.permission_id });
      }
      await t(f.tenant, 'user_roles').insert({ tenant: f.tenant, user_id: userId, role_id: roleId });
    }

    const asUser = (f: Fixture, userId: string) => {
      seam.user = { user_id: userId, tenant: f.tenant, user_type: 'internal', roles: [] };
    };

    const submitForm = (definitionId: string, f: Fixture) => {
      const form = new FormData();
      form.set('request_title', 'Laptop for new hire');
      return submitOnBehalfServiceRequestAction(f.clientId, f.contactWithUser, definitionId, form);
    };

    const apiSubmit = async (f: Fixture, userId: string, definitionId: string) => {
      const controller = new ApiServiceRequestController();
      const request = new NextRequest(`http://localhost/api/v1/service-requests/${definitionId}/submissions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId: f.clientId,
          contactId: f.contactWithUser,
          payload: { request_title: 'Laptop for new hire' },
        }),
      });
      Object.assign(request, { context: { tenant: f.tenant, userId, user: seam.user } });
      vi.spyOn(controller as any, 'authenticate').mockResolvedValue(request);
      return controller.submit()(request);
    };

    it('a user holding ONLY the default Technician role can submit through the server action', async () => {
      const f = await createFixture();
      await seedDefaultRoles(f);
      await assignDefaultRole(f, f.technicianId, 'Technician');
      const definitionId = await createDefinition(f);
      asUser(f, f.technicianId);

      const outcome = await submitForm(definitionId, f);
      expect(outcome).toMatchObject({ status: 'success', replayed: false });

      expect(await countRows(f.tenant, 'service_request_submissions')).toBe(1);
      const submission = await t(f.tenant, 'service_request_submissions').first();
      expect(submission.submitted_by_user_id).toBe(f.technicianId);
      expect(submission.requester_user_id).toBe(f.portalUserId);
      expect(await countRows(f.tenant, 'tickets')).toBe(1);
      expect((outcome as any).ticketId).toBeTruthy();
    });

    it('the same Technician gets a 201 from POST /api/v1/service-requests/{definitionId}/submissions', async () => {
      const f = await createFixture();
      await seedDefaultRoles(f);
      await assignDefaultRole(f, f.technicianId, 'Technician');
      const definitionId = await createDefinition(f);
      asUser(f, f.technicianId);

      const response = await apiSubmit(f, f.technicianId, definitionId);
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.data.ticketId).toBeTruthy();
      expect(await countRows(f.tenant, 'service_request_submissions')).toBe(1);
      expect((await t(f.tenant, 'service_request_submissions').first()).submitted_by_user_id).toBe(f.technicianId);
    });

    it('a role without ticket:create is refused by the action and by the API (403); nothing is written', async () => {
      const f = await createFixture();
      await seedDefaultRoles(f);
      await assignCustomRole(f, f.technicianId, [['client', 'read'], ['contact', 'read']]);
      const definitionId = await createDefinition(f);
      asUser(f, f.technicianId);

      const outcome = await submitForm(definitionId, f);
      expect(outcome).toMatchObject({ status: 'error', code: 'forbidden' });
      const response = await apiSubmit(f, f.technicianId, definitionId);
      expect(response.status).toBe(403);

      expect(await countRows(f.tenant, 'service_request_submissions')).toBe(0);
      expect(await countRows(f.tenant, 'tickets')).toBe(0);
    });

    it('service:create is not what gates submission: a role holding it but not ticket:create is refused', async () => {
      const f = await createFixture();
      await seedDefaultRoles(f);
      await assignCustomRole(f, f.technicianId, [['service', 'create'], ['client', 'read'], ['contact', 'read']]);
      const definitionId = await createDefinition(f);
      asUser(f, f.technicianId);
      expect(await submitForm(definitionId, f)).toMatchObject({ status: 'error', code: 'forbidden' });
      expect((await apiSubmit(f, f.technicianId, definitionId)).status).toBe(403);
    });

    it('a client-type user holding all three permissions is refused (403) by both API endpoints; nothing is written', async () => {
      const f = await createFixture();
      await seedDefaultRoles(f);
      const clientTypeUserId = uuidv4();
      await createUser(f.tenant, clientTypeUserId, 'client-type', { user_type: 'client' });
      // hasPermission only counts client-flagged roles/permissions for a client-type user, so the role and
      // the grants are client-flagged: the permission rows alone grant everything, leaving user_type the
      // only thing that can refuse.
      const roleId = uuidv4();
      await t(f.tenant, 'roles').insert({ tenant: f.tenant, role_id: roleId, role_name: 'Client-type full grants', msp: false, client: true });
      for (const [resource, action] of [['ticket', 'create'], ['client', 'read'], ['contact', 'read']]) {
        let permission = await t(f.tenant, 'permissions').where({ resource, action, client: true }).first('permission_id');
        if (!permission) {
          permission = { permission_id: uuidv4() };
          await t(f.tenant, 'permissions').insert({ tenant: f.tenant, permission_id: permission.permission_id, resource, action, msp: false, client: true });
        }
        await t(f.tenant, 'role_permissions').insert({ tenant: f.tenant, role_id: roleId, permission_id: permission.permission_id });
      }
      await t(f.tenant, 'user_roles').insert({ tenant: f.tenant, user_id: clientTypeUserId, role_id: roleId });
      const definitionId = await createDefinition(f);
      seam.user = { user_id: clientTypeUserId, tenant: f.tenant, user_type: 'client', roles: [] };

      // Sanity: the permission rows alone would pass; only the user-type rule can be refusing.
      const { hasPermission } = await import('@alga-psa/auth');
      for (const [resource, action] of [['ticket', 'create'], ['client', 'read'], ['contact', 'read']]) {
        expect(await hasPermission(seam.user, resource, action, db)).toBe(true);
      }

      const submitResponse = await apiSubmit(f, clientTypeUserId, definitionId);
      expect(submitResponse.status).toBe(403);

      const controller = new ApiServiceRequestController();
      const catalogRequest = new NextRequest(
        `http://localhost/api/v1/service-requests/catalog?clientId=${f.clientId}&contactId=${f.contactWithUser}`
      );
      Object.assign(catalogRequest, { context: { tenant: f.tenant, userId: clientTypeUserId, user: seam.user } });
      vi.spyOn(controller as any, 'authenticate').mockResolvedValue(catalogRequest);
      expect((await controller.catalog()(catalogRequest)).status).toBe(403);

      expect(await countRows(f.tenant, 'service_request_submissions')).toBe(0);
      expect(await countRows(f.tenant, 'tickets')).toBe(0);
    });
  });
});
