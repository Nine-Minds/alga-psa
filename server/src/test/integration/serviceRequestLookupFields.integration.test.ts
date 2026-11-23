import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { submitPortalServiceRequest } from '../../lib/service-requests/submissionService';
import {
  resolveLookupLabels,
  resolveLookupOptions,
  validateLookupAnswers,
} from '../../lib/service-requests/lookupFields';
import {
  registerServiceRequestProviders,
  resetServiceRequestProviderRegistry,
} from '../../lib/service-requests/providers/registry';
import { getServiceRequestEnterpriseProviderRegistrations } from '../../../../ee/server/src/lib/service-requests/providers';

type ColumnInfoMap = Record<string, unknown>;

interface Tenant {
  tenant: string;
  requesterUserId: string;
  clientId: string;
  otherClientId: string;
  boardId: string;
  statusId: string;
  priorityId: string;
  /** Active contact of `clientId`. */
  managerId: string;
  inactiveContactId: string;
  /** Active contact of `otherClientId` in the same tenant. */
  otherClientContactId: string;
}

let db: Knex;
let columns: Record<string, ColumnInfoMap> = {};
const tenantsToCleanup = new Set<string>();

const has = (table: string, column: string) => Object.prototype.hasOwnProperty.call(columns[table], column);
const tenantTable = (tenant: string, table: string) => tenantDb(db, tenant).table(table);
const tenantRows = () =>
  tenantDb(db, '__test_tenant_fixture__').unscoped('tenants', 'test fixture creates and removes tenant rows');
const schemaTable = (table: string) =>
  tenantDb(db, '__test_schema__').unscoped(table, 'columnInfo reads schema metadata, not tenant rows');

async function cleanupTenant(tenant: string) {
  for (const table of [
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
    await tenantTable(tenant, table).del();
  }
  await tenantRows().where({ tenant }).del();
}

async function insertClient(tenant: string, name: string): Promise<string> {
  const clientId = uuidv4();
  await tenantTable(tenant, 'clients').insert({
    tenant,
    client_id: clientId,
    client_name: name,
    ...(has('clients', 'is_inactive') ? { is_inactive: false } : {}),
    ...(has('clients', 'billing_cycle') ? { billing_cycle: 'monthly' } : {}),
    ...(has('clients', 'is_tax_exempt') ? { is_tax_exempt: false } : {}),
  });
  return clientId;
}

async function insertContact(
  tenant: string,
  clientId: string,
  fullName: string,
  overrides: Record<string, unknown> = {}
): Promise<string> {
  const contactId = uuidv4();
  await tenantTable(tenant, 'contacts').insert({
    tenant,
    contact_name_id: contactId,
    full_name: fullName,
    email: `${contactId.slice(0, 8)}@example.com`,
    client_id: clientId,
    is_inactive: false,
    ...overrides,
  });
  return contactId;
}

async function insertUser(tenant: string, firstName: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const userId = uuidv4();
  await tenantTable(tenant, 'users').insert({
    tenant,
    user_id: userId,
    username: `u-${userId.slice(0, 8)}`,
    hashed_password: 'not-used',
    email: `${userId.slice(0, 8)}@example.com`,
    first_name: firstName,
    last_name: 'Tester',
    user_type: 'internal',
    is_inactive: false,
    ...(has('users', 'role') ? { role: 'admin' } : {}),
    ...overrides,
  });
  return userId;
}

async function createTenant(): Promise<Tenant> {
  const tenant = uuidv4();
  const boardId = uuidv4();
  const statusId = uuidv4();
  const priorityId = uuidv4();
  tenantsToCleanup.add(tenant);

  await tenantRows().insert({
    tenant,
    ...(has('tenants', 'company_name')
      ? { company_name: `Tenant ${tenant.slice(0, 8)}` }
      : { client_name: `Tenant ${tenant.slice(0, 8)}` }),
    email: `tenant-${tenant.slice(0, 8)}@example.com`,
  });
  const requesterUserId = await insertUser(tenant, 'Requester', { user_type: 'client' });
  const clientId = await insertClient(tenant, `Client A ${tenant.slice(0, 8)}`);
  const otherClientId = await insertClient(tenant, `Client B ${tenant.slice(0, 8)}`);
  const managerId = await insertContact(tenant, clientId, 'Jane Manager');
  const inactiveContactId = await insertContact(tenant, clientId, 'Ina Inactive', { is_inactive: true });
  const otherClientContactId = await insertContact(tenant, otherClientId, 'Olga Other-Client');

  await tenantTable(tenant, 'boards').insert({
    tenant,
    board_id: boardId,
    board_name: `Support ${tenant.slice(0, 8)}`,
    ...(has('boards', 'description') ? { description: 'Support board' } : {}),
    ...(has('boards', 'display_order') ? { display_order: 10 } : {}),
    ...(has('boards', 'is_default') ? { is_default: true } : {}),
    ...(has('boards', 'is_inactive') ? { is_inactive: false } : {}),
    ...(has('boards', 'category_type') ? { category_type: 'custom' } : {}),
    ...(has('boards', 'priority_type') ? { priority_type: 'custom' } : {}),
  });
  await tenantTable(tenant, 'priorities').insert({
    tenant,
    priority_id: priorityId,
    priority_name: 'High',
    ...(has('priorities', 'item_type') ? { item_type: 'ticket' } : {}),
    ...(has('priorities', 'order_number') ? { order_number: 10 } : {}),
    ...(has('priorities', 'color') ? { color: '#EF4444' } : {}),
    ...(has('priorities', 'created_by') ? { created_by: requesterUserId } : {}),
    ...(has('priorities', 'updated_by') ? { updated_by: requesterUserId } : {}),
  });
  await tenantTable(tenant, 'statuses').insert({
    tenant,
    status_id: statusId,
    ...(has('statuses', 'board_id') ? { board_id: boardId } : {}),
    name: 'Open',
    ...(has('statuses', 'status_type') ? { status_type: 'ticket' } : {}),
    ...(has('statuses', 'item_type') ? { item_type: 'ticket' } : {}),
    is_closed: false,
    is_default: true,
    order_number: 10,
    created_by: requesterUserId,
    ...(has('statuses', 'is_custom') ? { is_custom: true } : {}),
    ...(has('statuses', 'standard_status_id') ? { standard_status_id: null } : {}),
  });

  return {
    tenant,
    requesterUserId,
    clientId,
    otherClientId,
    boardId,
    statusId,
    priorityId,
    managerId,
    inactiveContactId,
    otherClientContactId,
  };
}

const MANAGER_FIELDS = [
  { key: 'summary', type: 'short-text', label: 'Summary', required: false },
  {
    key: 'manager',
    type: 'lookup',
    label: 'Manager',
    required: true,
    lookup: { entity: 'contact', scope: 'requester-client' },
  },
];

async function publishDefinition(
  fx: Tenant,
  opts: {
    fields?: unknown[];
    formBehaviorProvider?: string;
    formBehaviorConfig?: Record<string, unknown>;
  } = {}
): Promise<string> {
  const definitionId = uuidv4();
  const executionConfig = {
    boardId: fx.boardId,
    statusId: fx.statusId,
    priorityId: fx.priorityId,
    descriptionPrefix: 'Manager is {{manager}}',
  };
  const schema = { fields: opts.fields ?? MANAGER_FIELDS };
  await tenantTable(fx.tenant, 'service_request_definitions').insert({
    tenant: fx.tenant,
    definition_id: definitionId,
    name: 'Employee Onboarding',
    form_schema: schema,
    execution_provider: 'ticket-only',
    execution_config: executionConfig,
    form_behavior_provider: opts.formBehaviorProvider ?? 'basic',
    form_behavior_config: opts.formBehaviorConfig ?? {},
    visibility_provider: 'all-authenticated-client-users',
    visibility_config: {},
    lifecycle_state: 'published',
  });
  await tenantTable(fx.tenant, 'service_request_definition_versions').insert({
    tenant: fx.tenant,
    version_id: uuidv4(),
    definition_id: definitionId,
    version_number: 1,
    name: 'Employee Onboarding',
    form_schema_snapshot: schema,
    execution_provider: 'ticket-only',
    execution_config: executionConfig,
    form_behavior_provider: opts.formBehaviorProvider ?? 'basic',
    form_behavior_config: opts.formBehaviorConfig ?? {},
    visibility_provider: 'all-authenticated-client-users',
    visibility_config: {},
  });
  return definitionId;
}

const submit = (fx: Tenant, definitionId: string, payload: Record<string, unknown>) =>
  submitPortalServiceRequest({
    knex: db,
    tenant: fx.tenant,
    definitionId,
    requesterUserId: fx.requesterUserId,
    clientId: fx.clientId,
    payload,
  });

const submissionCount = async (tenant: string) =>
  (await tenantTable(tenant, 'service_request_submissions').count<{ count: string }[]>('* as count'))[0].count;

describe('service request lookup fields', () => {
  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
    for (const table of ['tenants', 'users', 'clients', 'boards', 'statuses', 'priorities']) {
      columns[table] = await schemaTable(table).columnInfo();
    }
  });

  beforeEach(async () => {
    resetServiceRequestProviderRegistry();
    registerServiceRequestProviders(await getServiceRequestEnterpriseProviderRegistrations());
  });

  afterEach(async () => {
    for (const tenant of tenantsToCleanup) {
      await cleanupTenant(tenant);
      tenantsToCleanup.delete(tenant);
    }
  });

  afterAll(async () => {
    resetServiceRequestProviderRegistry();
    if (db) await db.destroy();
  });

  it('stores the contact id in submitted_payload and shows the contact name (not the uuid) on the ticket', async () => {
    const fx = await createTenant();
    const definitionId = await publishDefinition(fx);

    const result = await submit(fx, definitionId, { summary: 'New hire', manager: fx.managerId });

    expect(result.executionStatus).toBe('succeeded');
    const submission = await tenantTable(fx.tenant, 'service_request_submissions')
      .where({ submission_id: result.submissionId })
      .first();
    expect(submission.submitted_payload).toMatchObject({ manager: fx.managerId });

    const ticket = await tenantTable(fx.tenant, 'tickets').where({ ticket_id: result.createdTicketId }).first();
    const description = (ticket.attributes as { description?: string }).description!;
    expect(description).toContain('Manager is Jane Manager');
    expect(description).toContain('"text":"Jane Manager"'); // the answers table row
    expect(description).not.toContain(fx.managerId);
  });

  describe('security: a posted id must resolve inside the field\'s own options', () => {
    it('refuses another client\'s contact, naming the field, and inserts nothing', async () => {
      const fx = await createTenant();
      const definitionId = await publishDefinition(fx);

      await expect(submit(fx, definitionId, { manager: fx.otherClientContactId })).rejects.toThrow(
        /Submission validation failed: Invalid selection for "Manager"/
      );
      expect(await submissionCount(fx.tenant)).toBe('0');
    });

    it('refuses a contact id from another tenant and inserts nothing', async () => {
      const fx = await createTenant();
      const foreign = await createTenant();
      const definitionId = await publishDefinition(fx);

      await expect(submit(fx, definitionId, { manager: foreign.managerId })).rejects.toThrow(
        /Invalid selection for "Manager"/
      );
      expect(await submissionCount(fx.tenant)).toBe('0');
    });

    it('refuses an inactive contact, a non-uuid, and a non-string answer', async () => {
      const fx = await createTenant();
      const definitionId = await publishDefinition(fx);

      for (const bad of [fx.inactiveContactId, 'not-a-uuid', ['x']]) {
        await expect(submit(fx, definitionId, { manager: bad })).rejects.toThrow(/Invalid selection for "Manager"/);
      }
      expect(await submissionCount(fx.tenant)).toBe('0');
    });

    it('a user lookup accepts an active MSP user and refuses inactive, client-type and foreign-tenant users', async () => {
      const fx = await createTenant();
      const foreign = await createTenant();
      const fields = [{ key: 'owner', type: 'lookup', label: 'Owner', required: true, lookup: { entity: 'user', scope: 'tenant' } }];
      const definitionId = await publishDefinition(fx, { fields });
      const activeStaff = await insertUser(fx.tenant, 'Stacy');
      const inactiveStaff = await insertUser(fx.tenant, 'Ivan', { is_inactive: true });
      const foreignStaff = await insertUser(foreign.tenant, 'Frank');

      for (const bad of [inactiveStaff, fx.requesterUserId, foreignStaff]) {
        await expect(submit(fx, definitionId, { owner: bad })).rejects.toThrow(/Invalid selection for "Owner"/);
      }
      const ok = await submit(fx, definitionId, { owner: activeStaff });
      expect(ok.submissionId).toBeTruthy();
    });
  });

  it('a required lookup that is missing fails with the field label', async () => {
    const fx = await createTenant();
    const definitionId = await publishDefinition(fx);

    await expect(submit(fx, definitionId, { summary: 'x' })).rejects.toThrow(/Required field missing: "Manager"/);
    expect(await submissionCount(fx.tenant)).toBe('0');
  });

  describe('legacy published version with an unsupported field type', () => {
    // Publishable on main (the type check was unreachable), so such versions may exist in live use.
    const legacyFields = (required: boolean) => [
      { key: 'summary', type: 'short-text', label: 'Summary', required: true },
      { key: 'satisfaction', type: 'rating', label: 'Satisfaction score', required },
    ];

    it('stays submittable when the unsupported question is required (the portal shows it as unavailable)', async () => {
      const fx = await createTenant();
      const definitionId = await publishDefinition(fx, { fields: legacyFields(true) });

      const result = await submit(fx, definitionId, { summary: 'Printer jams' });
      expect(result.executionStatus).toBe('succeeded');
      expect(result.createdTicketId).toBeTruthy();
    });

    it('stays submittable when the unsupported question is optional', async () => {
      const fx = await createTenant();
      const definitionId = await publishDefinition(fx, { fields: legacyFields(false) });

      const result = await submit(fx, definitionId, { summary: 'Printer jams' });
      expect(result.executionStatus).toBe('succeeded');
    });

    it('drops a value posted for the unsupported question instead of storing it as free text', async () => {
      const fx = await createTenant();
      const definitionId = await publishDefinition(fx, { fields: legacyFields(true) });

      const result = await submit(fx, definitionId, { summary: 'Printer jams', satisfaction: '5' });
      const submission = await tenantTable(fx.tenant, 'service_request_submissions')
        .where({ submission_id: result.submissionId })
        .first();
      expect(submission.submitted_payload).toEqual({ summary: 'Printer jams' });
    });

    it('still enforces its supported required questions', async () => {
      const fx = await createTenant();
      const definitionId = await publishDefinition(fx, { fields: legacyFields(true) });

      await expect(submit(fx, definitionId, {})).rejects.toThrow(/Required field missing: "Summary"/);
      await expect(submit(fx, definitionId, {})).rejects.not.toThrow(/Satisfaction score/);
      expect(await submissionCount(fx.tenant)).toBe('0');
    });
  });

  describe('hidden lookup', () => {
    const fields = [
      { key: 'needs_manager', type: 'checkbox', label: 'Needs manager', required: false },
      { key: 'manager', type: 'lookup', label: 'Manager', required: true, lookup: { entity: 'contact', scope: 'requester-client' } },
    ];
    const formBehaviorConfig = {
      visibilityRules: [{ fieldKey: 'manager', source: 'payload.needs_manager', operator: 'is-true' }],
    };

    it('is not required while hidden', async () => {
      const fx = await createTenant();
      const definitionId = await publishDefinition(fx, { fields, formBehaviorProvider: 'advanced', formBehaviorConfig });

      const result = await submit(fx, definitionId, { needs_manager: false });
      expect(result.executionStatus).toBe('succeeded');
    });

    it('ignores (does not validate and does not store) a value posted for it', async () => {
      const fx = await createTenant();
      const definitionId = await publishDefinition(fx, { fields, formBehaviorProvider: 'advanced', formBehaviorConfig });

      const result = await submit(fx, definitionId, { needs_manager: false, manager: fx.otherClientContactId });
      const submission = await tenantTable(fx.tenant, 'service_request_submissions')
        .where({ submission_id: result.submissionId })
        .first();
      expect(submission.submitted_payload).not.toHaveProperty('manager');
    });

    it('is validated again once visible', async () => {
      const fx = await createTenant();
      const definitionId = await publishDefinition(fx, { fields, formBehaviorProvider: 'advanced', formBehaviorConfig });

      await expect(
        submit(fx, definitionId, { needs_manager: true, manager: fx.otherClientContactId })
      ).rejects.toThrow(/Invalid selection for "Manager"/);
    });
  });

  describe('resolver', () => {
    it('contact options are the requester client\'s active contacts only', async () => {
      const fx = await createTenant();
      const foreign = await createTenant();

      const options = await resolveLookupOptions(db, fx.tenant, 'contact', 'requester-client', { clientId: fx.clientId });
      expect(options.map((option) => option.id)).toEqual([fx.managerId]);

      const other = await resolveLookupOptions(db, fx.tenant, 'contact', 'requester-client', { clientId: fx.otherClientId });
      expect(other.map((option) => option.id)).toEqual([fx.otherClientContactId]);

      // A client id from another tenant yields nothing: the tenant predicate always applies.
      const crossTenant = await resolveLookupOptions(db, fx.tenant, 'contact', 'requester-client', { clientId: foreign.clientId });
      expect(crossTenant).toEqual([]);
    });

    it('contact lookups never widen to tenant scope', async () => {
      const fx = await createTenant();
      expect(await resolveLookupOptions(db, fx.tenant, 'contact', 'tenant', { clientId: fx.clientId })).toEqual([]);
    });

    it('user options are active internal users of the tenant', async () => {
      const fx = await createTenant();
      const foreign = await createTenant();
      const active = await insertUser(fx.tenant, 'Stacy');
      await insertUser(fx.tenant, 'Ivan', { is_inactive: true });
      await insertUser(foreign.tenant, 'Frank');

      const options = await resolveLookupOptions(db, fx.tenant, 'user', 'tenant', { clientId: fx.clientId });
      expect(options.map((option) => option.id)).toEqual([active]);
    });

    it('labels resolve within scope and still show a since-deactivated contact; validate skips empty answers', async () => {
      const fx = await createTenant();
      const fields = MANAGER_FIELDS;
      const requester = { clientId: fx.clientId };

      expect(
        await resolveLookupLabels(db, fx.tenant, fields, { manager: fx.inactiveContactId }, requester)
      ).toEqual({ manager: 'Ina Inactive' });
      expect(
        await resolveLookupLabels(db, fx.tenant, fields, { manager: fx.otherClientContactId }, requester)
      ).toEqual({});
      expect(await validateLookupAnswers(db, fx.tenant, fields, { manager: '' }, requester, ['manager'])).toEqual([]);
    });
  });
});
