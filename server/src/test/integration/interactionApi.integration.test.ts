import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import type { Knex } from 'knex';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn().mockResolvedValue(undefined),
  publishWorkflowEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

const HOOK_TIMEOUT = 180_000;
type ColumnInfoMap = Record<string, unknown>;

type Fixture = {
  tenantId: string;
  otherTenantId: string;
  allowedApiKey: string;
  deniedApiKey: string;
  clientId: string;
  contactId: string;
  opportunityId: string;
  otherTenantInteractionId: string;
  callTypeId: string;
  initialOpportunityActivity: string;
};

let db: Knex;
let ApiInteractionController: typeof import('../../lib/api/controllers/ApiInteractionController').ApiInteractionController;
const tenantsToCleanup = new Set<string>();
const columns: Record<string, ColumnInfoMap> = {};

function hasColumn(table: string, column: string): boolean {
  return Object.prototype.hasOwnProperty.call(columns[table], column);
}

function hashApiKey(plainTextKey: string): string {
  return createHash('sha256').update(plainTextKey).digest('hex');
}

function tenantTable(tenantId: string, table: string) {
  return tenantDb(db, tenantId).table(table);
}

function tenantRows() {
  return tenantDb(db, '__interaction_api_test_fixture__')
    .unscoped('tenants', 'interaction API integration fixture creates and removes tenant rows');
}

function schemaTable(table: string) {
  return tenantDb(db, '__interaction_api_test_schema__')
    .unscoped(table, 'columnInfo reads schema metadata, not tenant rows');
}

function tenantInsert(tenantId: string, label: string) {
  return {
    tenant: tenantId,
    ...(hasColumn('tenants', 'company_name')
      ? { company_name: label }
      : { client_name: label }),
    email: `${tenantId}@example.com`,
    ...(hasColumn('tenants', 'product_code') ? { product_code: 'psa' } : {}),
    ...(hasColumn('tenants', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('tenants', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  };
}

function userInsert(tenantId: string, userId: string, label: string) {
  return {
    tenant: tenantId,
    user_id: userId,
    username: label,
    hashed_password: 'not-used',
    ...(hasColumn('users', 'role') ? { role: 'admin' } : {}),
    ...(hasColumn('users', 'email') ? { email: `${label}@example.com` } : {}),
    ...(hasColumn('users', 'user_type') ? { user_type: 'internal' } : {}),
    ...(hasColumn('users', 'is_inactive') ? { is_inactive: false } : {}),
    ...(hasColumn('users', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('users', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  };
}

function clientInsert(tenantId: string, clientId: string, label: string) {
  return {
    tenant: tenantId,
    client_id: clientId,
    client_name: label,
    ...(hasColumn('clients', 'is_inactive') ? { is_inactive: false } : {}),
    ...(hasColumn('clients', 'billing_cycle') ? { billing_cycle: 'monthly' } : {}),
    ...(hasColumn('clients', 'is_tax_exempt') ? { is_tax_exempt: false } : {}),
    ...(hasColumn('clients', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('clients', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  };
}

function statusInsert(tenantId: string, statusId: string, userId: string) {
  return {
    tenant: tenantId,
    status_id: statusId,
    name: 'Completed',
    status_type: 'interaction',
    order_number: 10,
    is_closed: true,
    is_default: true,
    created_by: userId,
    ...(hasColumn('statuses', 'item_type') ? { item_type: 'interaction' } : {}),
    ...(hasColumn('statuses', 'is_custom') ? { is_custom: true } : {}),
    ...(hasColumn('statuses', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('statuses', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  };
}

function apiKeyInsert(tenantId: string, userId: string, plainTextKey: string, description: string) {
  return {
    tenant: tenantId,
    api_key_id: randomUUID(),
    user_id: userId,
    api_key: hashApiKey(plainTextKey),
    description,
    active: true,
    ...(hasColumn('api_keys', 'usage_count') ? { usage_count: 0 } : {}),
    ...(hasColumn('api_keys', 'usage_limit') ? { usage_limit: null } : {}),
    ...(hasColumn('api_keys', 'last_used_at') ? { last_used_at: null } : {}),
    ...(hasColumn('api_keys', 'expires_at') ? { expires_at: null } : {}),
    ...(hasColumn('api_keys', 'purpose') ? { purpose: 'integration_test' } : {}),
    ...(hasColumn('api_keys', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('api_keys', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  };
}

async function seedFixture(): Promise<Fixture> {
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const allowedUserId = randomUUID();
  const deniedUserId = randomUUID();
  const otherUserId = randomUUID();
  const clientId = randomUUID();
  const contactId = randomUUID();
  const otherClientId = randomUUID();
  const opportunityId = randomUUID();
  const statusId = randomUUID();
  const otherStatusId = randomUUID();
  const roleId = randomUUID();
  const otherTenantInteractionId = randomUUID();
  const allowedApiKey = `interaction-allowed-${randomUUID()}`;
  const deniedApiKey = `interaction-denied-${randomUUID()}`;
  const initialOpportunityActivity = '2026-01-01T00:00:00.000Z';

  tenantsToCleanup.add(tenantId);
  tenantsToCleanup.add(otherTenantId);

  await tenantRows().insert([
    tenantInsert(tenantId, `Interaction API ${tenantId.slice(0, 8)}`),
    tenantInsert(otherTenantId, `Interaction API other ${otherTenantId.slice(0, 8)}`),
  ]);

  await tenantTable(tenantId, 'users').insert([
    userInsert(tenantId, allowedUserId, `interaction-allowed-${tenantId.slice(0, 8)}`),
    userInsert(tenantId, deniedUserId, `interaction-denied-${tenantId.slice(0, 8)}`),
  ]);
  await tenantTable(otherTenantId, 'users').insert(
    userInsert(otherTenantId, otherUserId, `interaction-other-${otherTenantId.slice(0, 8)}`),
  );

  await tenantTable(tenantId, 'clients').insert(
    clientInsert(tenantId, clientId, `Client ${tenantId.slice(0, 8)}`),
  );
  await tenantTable(otherTenantId, 'clients').insert(
    clientInsert(otherTenantId, otherClientId, `Client ${otherTenantId.slice(0, 8)}`),
  );

  await tenantTable(tenantId, 'contacts').insert({
    tenant: tenantId,
    contact_name_id: contactId,
    client_id: clientId,
    full_name: `Contact ${tenantId.slice(0, 8)}`,
    email: `contact-${tenantId.slice(0, 8)}@example.com`,
    ...(hasColumn('contacts', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('contacts', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await tenantTable(tenantId, 'statuses').insert(statusInsert(tenantId, statusId, allowedUserId));
  await tenantTable(otherTenantId, 'statuses').insert(statusInsert(otherTenantId, otherStatusId, otherUserId));

  await tenantTable(tenantId, 'opportunities').insert({
    tenant: tenantId,
    opportunity_id: opportunityId,
    opportunity_number: `OPP-${tenantId.slice(0, 8)}`,
    client_id: clientId,
    contact_id: contactId,
    title: 'Mobile interaction opportunity',
    opportunity_type: 'new_logo',
    owner_id: allowedUserId,
    status: 'open',
    stage: 'identified',
    confidence: 'medium',
    mrr_cents: 0,
    nrr_cents: 0,
    hardware_cents: 0,
    currency_code: 'USD',
    values_locked_by_quote: false,
    last_activity_at: initialOpportunityActivity,
    created_by: allowedUserId,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  const callType = await tenantTable(tenantId, 'system_interaction_types')
    .where({ type_name: 'Call' })
    .select('type_id')
    .first();
  if (!callType?.type_id) {
    throw new Error('System Call interaction type is required for the interaction API integration test');
  }

  await tenantTable(otherTenantId, 'interactions').insert({
    tenant: otherTenantId,
    interaction_id: otherTenantInteractionId,
    type_id: callType.type_id,
    client_id: otherClientId,
    contact_name_id: null,
    user_id: otherUserId,
    title: 'Other tenant interaction',
    notes: null,
    interaction_date: '2026-07-15T12:00:00.000Z',
    duration: 5,
    status_id: otherStatusId,
    visibility: 'internal',
  });

  await tenantTable(tenantId, 'roles').insert({
    tenant: tenantId,
    role_id: roleId,
    role_name: 'Interaction API Test Role',
    description: 'Integration-only interaction permissions',
    ...(hasColumn('roles', 'msp') ? { msp: true } : {}),
    ...(hasColumn('roles', 'client') ? { client: false } : {}),
    ...(hasColumn('roles', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('roles', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });
  await tenantTable(tenantId, 'user_roles').insert({
    tenant: tenantId,
    user_id: allowedUserId,
    role_id: roleId,
    ...(hasColumn('user_roles', 'created_at') ? { created_at: db.fn.now() } : {}),
  });

  const permissionRows = ['read', 'create'].map((action) => ({
    tenant: tenantId,
    permission_id: randomUUID(),
    resource: 'interaction',
    action,
    ...(hasColumn('permissions', 'msp') ? { msp: true } : {}),
    ...(hasColumn('permissions', 'client') ? { client: false } : {}),
    ...(hasColumn('permissions', 'description') ? { description: `${action} interactions` } : {}),
    ...(hasColumn('permissions', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('permissions', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  }));
  await tenantTable(tenantId, 'permissions').insert(permissionRows);
  await tenantTable(tenantId, 'role_permissions').insert(permissionRows.map((permission) => ({
    tenant: tenantId,
    role_id: roleId,
    permission_id: permission.permission_id,
    ...(hasColumn('role_permissions', 'created_at') ? { created_at: db.fn.now() } : {}),
  })));

  await tenantTable(tenantId, 'api_keys').insert([
    apiKeyInsert(tenantId, allowedUserId, allowedApiKey, 'Interaction API allowed key'),
    apiKeyInsert(tenantId, deniedUserId, deniedApiKey, 'Interaction API denied key'),
  ]);

  return {
    tenantId,
    otherTenantId,
    allowedApiKey,
    deniedApiKey,
    clientId,
    contactId,
    opportunityId,
    otherTenantInteractionId,
    callTypeId: callType.type_id,
    initialOpportunityActivity,
  };
}

function request(
  tenantId: string,
  apiKey: string,
  path: string,
  init: { method?: string; body?: Record<string, unknown> } = {},
) {
  return new NextRequest(`http://localhost${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'x-api-key': apiKey,
      'x-tenant-id': tenantId,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
}

async function cleanupTenant(tenantId: string): Promise<void> {
  await tenantTable(tenantId, 'interactions').del();
  await tenantTable(tenantId, 'opportunities').del();
  await tenantTable(tenantId, 'api_keys').del();
  await tenantTable(tenantId, 'role_permissions').del();
  await tenantTable(tenantId, 'user_roles').del();
  await tenantTable(tenantId, 'permissions').del();
  await tenantTable(tenantId, 'roles').del();
  await tenantTable(tenantId, 'statuses').del();
  await tenantTable(tenantId, 'contacts').del();
  await tenantTable(tenantId, 'clients').del();
  await tenantTable(tenantId, 'users').del();
  await tenantRows().where({ tenant: tenantId }).del();
}

describe('interactions REST API (integration)', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'test_database';
    process.env.DB_HOST = process.env.DB_HOST || 'localhost';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
    process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'postpass123';

    db = await createTestDbConnection({ runSeeds: false });
    for (const table of [
      'tenants',
      'users',
      'clients',
      'contacts',
      'statuses',
      'roles',
      'user_roles',
      'permissions',
      'role_permissions',
      'api_keys',
    ]) {
      columns[table] = await schemaTable(table).columnInfo();
    }

    ({ ApiInteractionController } = await import('../../lib/api/controllers/ApiInteractionController'));
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    for (const tenantId of tenantsToCleanup) {
      await cleanupTenant(tenantId);
      tenantsToCleanup.delete(tenantId);
    }
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  it('T012: POST persists tenant-scoped, GET filters by opportunity, missing RBAC is 403, and cross-tenant ID is 404', async () => {
    const fixture = await seedFixture();
    const controller = new ApiInteractionController();
    const occurredAt = '2026-07-16T14:30:00.000Z';

    const postResponse = await controller.create()(request(
      fixture.tenantId,
      fixture.allowedApiKey,
      '/api/v1/interactions',
      {
        method: 'POST',
        body: {
          type_id: fixture.callTypeId,
          client_id: fixture.clientId,
          contact_name_id: fixture.contactId,
          opportunity_id: fixture.opportunityId,
          title: 'Mobile discovery call',
          notes: 'Follow up next week',
          duration: 25,
          interaction_date: occurredAt,
        },
      },
    ));
    expect(postResponse.status).toBe(201);
    const postBody = await postResponse.json();
    const interactionId = postBody.data?.interaction_id as string;
    expect(interactionId).toBeTruthy();

    const persisted = await tenantTable(fixture.tenantId, 'interactions')
      .where({ interaction_id: interactionId })
      .first();
    expect(persisted).toMatchObject({
      tenant: fixture.tenantId,
      client_id: fixture.clientId,
      contact_name_id: fixture.contactId,
      opportunity_id: fixture.opportunityId,
      user_id: expect.any(String),
      title: 'Mobile discovery call',
      visibility: 'internal',
    });

    const listResponse = await controller.list()(request(
      fixture.tenantId,
      fixture.allowedApiKey,
      `/api/v1/interactions?opportunity_id=${fixture.opportunityId}`,
    ));
    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json();
    expect(listBody.data).toEqual([
      expect.objectContaining({
        interaction_id: interactionId,
        opportunity_id: fixture.opportunityId,
        type_name: 'call',
      }),
    ]);

    const deniedResponse = await controller.list()(request(
      fixture.tenantId,
      fixture.deniedApiKey,
      '/api/v1/interactions',
    ));
    expect(deniedResponse.status).toBe(403);
    expect(await deniedResponse.json()).toMatchObject({
      error: { code: 'FORBIDDEN' },
    });

    const crossTenantRequest = request(
      fixture.tenantId,
      fixture.allowedApiKey,
      `/api/v1/interactions/${fixture.otherTenantInteractionId}`,
    ) as any;
    crossTenantRequest.params = Promise.resolve({ id: fixture.otherTenantInteractionId });
    const crossTenantResponse = await controller.getById()(crossTenantRequest);
    expect(crossTenantResponse.status).toBe(404);
  }, HOOK_TIMEOUT);

  it('T013: POST with opportunity_id updates opportunities.last_activity_at in the same write path', async () => {
    const fixture = await seedFixture();
    const controller = new ApiInteractionController();
    const occurredAt = '2026-07-16T16:45:00.000Z';

    const before = await tenantTable(fixture.tenantId, 'opportunities')
      .where({ opportunity_id: fixture.opportunityId })
      .first('last_activity_at');
    expect(new Date(before.last_activity_at).toISOString()).toBe(fixture.initialOpportunityActivity);

    const response = await controller.create()(request(
      fixture.tenantId,
      fixture.allowedApiKey,
      '/api/v1/interactions',
      {
        method: 'POST',
        body: {
          type_id: fixture.callTypeId,
          client_id: fixture.clientId,
          opportunity_id: fixture.opportunityId,
          notes: 'Opportunity activity timestamp coverage',
          interaction_date: occurredAt,
        },
      },
    ));
    expect(response.status).toBe(201);

    const opportunity = await tenantTable(fixture.tenantId, 'opportunities')
      .where({ opportunity_id: fixture.opportunityId })
      .first('last_activity_at');
    expect(new Date(opportunity.last_activity_at).toISOString()).toBe(occurredAt);
  }, HOOK_TIMEOUT);
});
