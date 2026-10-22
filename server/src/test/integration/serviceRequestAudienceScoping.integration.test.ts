import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { listVisibleServiceRequestCatalogItems } from '../../lib/service-requests/portalCatalog';
import { getVisiblePublishedServiceRequestDefinitionDetail } from '../../lib/service-requests/portalDetail';
import { submitPortalServiceRequest } from '../../lib/service-requests/submissionService';
import {
  duplicateServiceRequestDefinition,
  saveServiceRequestDefinitionAudience,
} from '../../lib/service-requests/definitionManagement';
import { loadDefinitionAudience } from '../../lib/service-requests/definitionAudience';
import { getServiceRequestDefinitionEditorData } from '../../lib/service-requests/definitionEditor';
import { validateServiceRequestDefinitionForPublish } from '../../lib/service-requests/definitionValidation';
import { publishServiceRequestDefinition } from '../../lib/service-requests/definitionPublishing';

interface Fixture {
  tenant: string;
  userA: string;
  userB: string;
  clientA: string;
  clientB: string;
  groupA1: string;
  groupA2: string;
  groupB1: string;
  contactA1: string; // client A, group A1
  contactA2: string; // client A, group A2
  contactA0: string; // client A, no group
  contactB1: string; // client B, group B1
}

let db: Knex;
const tenants = new Set<string>();

const t = (tenant: string, table: string) => tenantDb(db, tenant).table(table);
const tenantRows = () =>
  tenantDb(db, '__test_tenant_fixture__').unscoped('tenants', 'test fixture creates and removes tenant rows');

async function createFixture(): Promise<Fixture> {
  const tenant = uuidv4();
  tenants.add(tenant);
  const f: Fixture = {
    tenant,
    userA: uuidv4(),
    userB: uuidv4(),
    clientA: uuidv4(),
    clientB: uuidv4(),
    groupA1: uuidv4(),
    groupA2: uuidv4(),
    groupB1: uuidv4(),
    contactA1: uuidv4(),
    contactA2: uuidv4(),
    contactA0: uuidv4(),
    contactB1: uuidv4(),
  };
  await tenantRows().insert({
    tenant,
    client_name: `Tenant ${tenant.slice(0, 8)}`,
    email: `tenant-${tenant.slice(0, 8)}@example.com`,
  });
  for (const [id, name] of [[f.userA, 'a'], [f.userB, 'b']] as const) {
    await t(tenant, 'users').insert({
      tenant,
      user_id: id,
      username: `user-${name}-${tenant.slice(0, 8)}`,
      hashed_password: 'not-used',
      email: `user-${name}-${tenant.slice(0, 8)}@example.com`,
    });
  }
  for (const [id, name] of [[f.clientA, 'Client A'], [f.clientB, 'Client B']] as const) {
    await t(tenant, 'clients').insert({
      tenant,
      client_id: id,
      client_name: `${name} ${tenant.slice(0, 8)}`,
      is_inactive: false,
      billing_cycle: 'monthly',
      is_tax_exempt: false,
    });
  }
  for (const [id, client, name] of [
    [f.groupA1, f.clientA, 'A1'],
    [f.groupA2, f.clientA, 'A2'],
    [f.groupB1, f.clientB, 'B1'],
  ] as const) {
    await t(tenant, 'client_portal_visibility_groups').insert({
      tenant,
      group_id: id,
      client_id: client,
      name,
    });
  }
  for (const [id, client, group, name] of [
    [f.contactA1, f.clientA, f.groupA1, 'a1'],
    [f.contactA2, f.clientA, f.groupA2, 'a2'],
    [f.contactA0, f.clientA, null, 'a0'],
    [f.contactB1, f.clientB, f.groupB1, 'b1'],
  ] as const) {
    await t(tenant, 'contacts').insert({
      tenant,
      contact_name_id: id,
      full_name: `Contact ${name}`,
      email: `${name}-${tenant.slice(0, 8)}@example.com`,
      client_id: client,
      portal_visibility_group_id: group,
    });
  }
  return f;
}

async function createPublishedDefinition(
  tenant: string,
  options: { audienceMode?: 'all' | 'scoped'; name?: string; visibilityProvider?: string } = {}
): Promise<string> {
  const definitionId = uuidv4();
  const name = options.name ?? 'Scoped Form';
  const schema = { fields: [{ key: 'notes', type: 'short-text', label: 'Notes', required: true }] };
  const provider = options.visibilityProvider ?? 'all-authenticated-client-users';
  await t(tenant, 'service_request_definitions').insert({
    tenant,
    definition_id: definitionId,
    name,
    form_schema: schema,
    execution_provider: 'store-only',
    execution_config: {},
    form_behavior_provider: 'basic',
    form_behavior_config: {},
    visibility_provider: provider,
    visibility_config: {},
    lifecycle_state: 'published',
    published_at: db.fn.now(),
    audience_mode: options.audienceMode ?? 'all',
  });
  await t(tenant, 'service_request_definition_versions').insert({
    tenant,
    version_id: uuidv4(),
    definition_id: definitionId,
    version_number: 1,
    name,
    form_schema_snapshot: schema,
    execution_provider: 'store-only',
    execution_config: {},
    form_behavior_provider: 'basic',
    form_behavior_config: {},
    visibility_provider: provider,
    visibility_config: {},
  });
  return definitionId;
}

async function scope(
  f: Fixture,
  definitionId: string,
  mode: 'all' | 'scoped',
  clientIds: string[],
  groupIds: string[] = []
) {
  await saveServiceRequestDefinitionAudience({
    knex: db,
    tenant: f.tenant,
    definitionId,
    audience: { mode, clientIds, groupIds },
  });
}

function ctx(f: Fixture, who: 'A1' | 'A2' | 'A0' | 'B1' | 'Anon-A') {
  switch (who) {
    case 'A1': return { tenant: f.tenant, requesterUserId: f.userA, clientId: f.clientA, contactId: f.contactA1 };
    case 'A2': return { tenant: f.tenant, requesterUserId: f.userA, clientId: f.clientA, contactId: f.contactA2 };
    case 'A0': return { tenant: f.tenant, requesterUserId: f.userA, clientId: f.clientA, contactId: f.contactA0 };
    case 'B1': return { tenant: f.tenant, requesterUserId: f.userB, clientId: f.clientB, contactId: f.contactB1 };
    default: return { tenant: f.tenant, requesterUserId: f.userA, clientId: f.clientA, contactId: null };
  }
}

async function catalogIds(f: Fixture, who: Parameters<typeof ctx>[1]) {
  return (await listVisibleServiceRequestCatalogItems(db, ctx(f, who))).map((i) => i.definitionId);
}

async function detail(f: Fixture, who: Parameters<typeof ctx>[1], definitionId: string) {
  return getVisiblePublishedServiceRequestDefinitionDetail(db, ctx(f, who), definitionId);
}

async function submissionCount(tenant: string) {
  const [row] = await t(tenant, 'service_request_submissions').count<{ count: string }[]>('* as count');
  return Number(row.count);
}

async function cleanupTenant(tenant: string) {
  await t(tenant, 'service_request_submissions').del();
  await t(tenant, 'service_request_audience_client_groups').del();
  await t(tenant, 'service_request_audience_clients').del();
  await t(tenant, 'service_request_definition_versions').del();
  await t(tenant, 'service_request_definitions').del();
  await t(tenant, 'contacts').del();
  await t(tenant, 'client_portal_visibility_groups').del();
  await t(tenant, 'clients').del();
  await t(tenant, 'users').del();
  await tenantRows().where({ tenant }).del();
}

describe('service request audience scoping', () => {
  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
  });

  afterEach(async () => {
    for (const tenant of tenants) {
      await cleanupTenant(tenant);
    }
    tenants.clear();
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  it('existing definitions default to audience_mode all and stay visible to everyone', async () => {
    const f = await createFixture();
    const id = await createPublishedDefinition(f.tenant);
    expect(await loadDefinitionAudience(db, f.tenant, id)).toEqual({ mode: 'all', clientIds: [], groupIds: [] });
    for (const who of ['A1', 'A0', 'B1', 'Anon-A'] as const) {
      expect(await catalogIds(f, who)).toContain(id);
      expect(await detail(f, who, id)).not.toBeNull();
    }
  });

  it('client scope: catalog, detail and submit work for client A and are denied for client B', async () => {
    const f = await createFixture();
    const id = await createPublishedDefinition(f.tenant);
    await scope(f, id, 'scoped', [f.clientA]);

    expect(await catalogIds(f, 'A0')).toContain(id);
    expect(await catalogIds(f, 'Anon-A')).toContain(id);
    expect(await catalogIds(f, 'B1')).not.toContain(id);
    expect(await detail(f, 'A0', id)).not.toBeNull();
    expect(await detail(f, 'B1', id)).toBeNull();

    const submitted = await submitPortalServiceRequest({
      knex: db,
      tenant: f.tenant,
      definitionId: id,
      requesterUserId: f.userA,
      clientId: f.clientA,
      contactId: f.contactA0,
      payload: { notes: 'hello' },
    });
    expect(submitted.submissionId).toBeTruthy();
    expect(await submissionCount(f.tenant)).toBe(1);

    await expect(
      submitPortalServiceRequest({
        knex: db,
        tenant: f.tenant,
        definitionId: id,
        requesterUserId: f.userB,
        clientId: f.clientB,
        contactId: f.contactB1,
        payload: { notes: 'sneaky' },
      })
    ).rejects.toThrow('Service request is not visible or not published');
    expect(await submissionCount(f.tenant)).toBe(1);
  });

  it('group scope admits the member contact and rejects no-group and other-group contacts', async () => {
    const f = await createFixture();
    const id = await createPublishedDefinition(f.tenant);
    await scope(f, id, 'scoped', [f.clientA], [f.groupA1]);
    // Client A is selected only to host the group; remove client-level access to test groups alone.
    await t(f.tenant, 'service_request_audience_clients').where({ definition_id: id }).del();

    expect(await catalogIds(f, 'A1')).toContain(id);
    expect(await detail(f, 'A1', id)).not.toBeNull();
    expect(await catalogIds(f, 'A2')).not.toContain(id);
    expect(await catalogIds(f, 'A0')).not.toContain(id);
    expect(await catalogIds(f, 'Anon-A')).not.toContain(id);
    expect(await detail(f, 'A2', id)).toBeNull();
    expect(await detail(f, 'A0', id)).toBeNull();
    await expect(
      submitPortalServiceRequest({
        knex: db,
        tenant: f.tenant,
        definitionId: id,
        requesterUserId: f.userA,
        clientId: f.clientA,
        contactId: f.contactA2,
        payload: { notes: 'x' },
      })
    ).rejects.toThrow('not visible');
    expect(await submissionCount(f.tenant)).toBe(0);
  });

  it("a group from another client grants nothing, even if mis-assigned to a contact or scope row", async () => {
    const f = await createFixture();
    const id = await createPublishedDefinition(f.tenant);
    // Force a group-B1 scope row directly (the save action would refuse it).
    await t(f.tenant, 'service_request_definitions').where({ definition_id: id }).update({ audience_mode: 'scoped' });
    await t(f.tenant, 'service_request_audience_client_groups').insert({
      tenant: f.tenant,
      definition_id: id,
      group_id: f.groupB1,
    });
    // Client-A contact carrying client B's group id.
    await t(f.tenant, 'contacts')
      .where({ contact_name_id: f.contactA0 })
      .update({ portal_visibility_group_id: f.groupB1 });

    expect(await catalogIds(f, 'A0')).not.toContain(id);
    expect(await detail(f, 'A0', id)).toBeNull();
    // The legitimate member of B1 is admitted through its own client.
    expect(await catalogIds(f, 'B1')).toContain(id);
  });

  it('the save action rejects groups that do not belong to a selected client and foreign clients', async () => {
    const f = await createFixture();
    const other = await createFixture();
    const id = await createPublishedDefinition(f.tenant);

    await expect(scope(f, id, 'scoped', [f.clientA], [f.groupB1])).rejects.toThrow(/selected client/);
    await expect(scope(f, id, 'scoped', [other.clientA])).rejects.toThrow(/clients do not exist/);
    await expect(scope(f, id, 'scoped', [f.clientA], [other.groupA1])).rejects.toThrow();
    expect(await loadDefinitionAudience(db, f.tenant, id)).toEqual({ mode: 'all', clientIds: [], groupIds: [] });
  });

  it('scoped with zero rows is invisible to everyone', async () => {
    const f = await createFixture();
    const id = await createPublishedDefinition(f.tenant);
    await scope(f, id, 'scoped', []);
    for (const who of ['A1', 'A0', 'B1', 'Anon-A'] as const) {
      expect(await catalogIds(f, who)).not.toContain(id);
      expect(await detail(f, who, id)).toBeNull();
    }
  });

  it('deleting the last selected group fails closed instead of reopening the form', async () => {
    const f = await createFixture();
    const id = await createPublishedDefinition(f.tenant);
    await scope(f, id, 'scoped', [f.clientA], [f.groupA1]);
    await t(f.tenant, 'service_request_audience_clients').where({ definition_id: id }).del();
    await t(f.tenant, 'contacts').where({ portal_visibility_group_id: f.groupA1 }).update({ portal_visibility_group_id: null });
    await t(f.tenant, 'client_portal_visibility_groups').where({ group_id: f.groupA1 }).del();
    const audience = await loadDefinitionAudience(db, f.tenant, id);
    expect(audience).toEqual({ mode: 'scoped', clientIds: [], groupIds: [] });
    expect(await catalogIds(f, 'A1')).not.toContain(id);
  });

  it('switching back to all clears scope rows and re-admits everyone', async () => {
    const f = await createFixture();
    const id = await createPublishedDefinition(f.tenant);
    await scope(f, id, 'scoped', [f.clientA]);
    expect(await catalogIds(f, 'B1')).not.toContain(id);
    await scope(f, id, 'all', [f.clientA]);
    expect(await loadDefinitionAudience(db, f.tenant, id)).toEqual({ mode: 'all', clientIds: [], groupIds: [] });
    expect(await catalogIds(f, 'B1')).toContain(id);
  });

  it('publish validation rejects an empty scoped audience and accepts a populated one', async () => {
    const f = await createFixture();
    const id = await createPublishedDefinition(f.tenant);
    await scope(f, id, 'scoped', []);
    const rejected = await validateServiceRequestDefinitionForPublish(db, f.tenant, id);
    expect(rejected.isValid).toBe(false);
    expect(rejected.errors.join(' ')).toMatch(/audience/i);

    await scope(f, id, 'scoped', [f.clientA]);
    const accepted = await validateServiceRequestDefinitionForPublish(db, f.tenant, id);
    expect(accepted.errors.join(' ')).not.toMatch(/audience/i);
  });

  it('publishing does not copy or freeze the audience, and later edits apply immediately', async () => {
    const f = await createFixture();
    const id = await createPublishedDefinition(f.tenant);
    await scope(f, id, 'scoped', [f.clientA]);
    await publishServiceRequestDefinition({ knex: db, tenant: f.tenant, definitionId: id, publishedBy: null });

    const versionColumns = await tenantDb(db, '__test_schema__')
      .unscoped('service_request_definition_versions', 'columnInfo reads schema metadata')
      .columnInfo();
    expect(Object.keys(versionColumns)).not.toContain('audience_mode');

    expect(await catalogIds(f, 'B1')).not.toContain(id);
    await scope(f, id, 'scoped', [f.clientB]);
    expect(await catalogIds(f, 'B1')).toContain(id);
    expect(await catalogIds(f, 'A0')).not.toContain(id);
  });

  it('duplicating a form copies the audience mode and scope rows', async () => {
    const f = await createFixture();
    const id = await createPublishedDefinition(f.tenant);
    await scope(f, id, 'scoped', [f.clientA], [f.groupA1]);

    const copy = await duplicateServiceRequestDefinition({ knex: db, tenant: f.tenant, sourceDefinitionId: id });
    const audience = await loadDefinitionAudience(db, f.tenant, copy.definition_id);
    expect(audience.mode).toBe('scoped');
    expect(audience.clientIds).toEqual([f.clientA]);
    expect(audience.groupIds).toEqual([f.groupA1]);
    // The source is untouched.
    expect((await loadDefinitionAudience(db, f.tenant, id)).clientIds).toEqual([f.clientA]);
  });

  it('exposes execution.audience in the editor data', async () => {
    const f = await createFixture();
    const id = await createPublishedDefinition(f.tenant);
    await scope(f, id, 'scoped', [f.clientA], [f.groupA2]);
    const data = await getServiceRequestDefinitionEditorData(db, f.tenant, id);
    expect(data?.execution.audience).toEqual({ mode: 'scoped', clientIds: [f.clientA], groupIds: [f.groupA2] });
  });

  it('tenant isolation: another tenant cannot see or be granted a scoped form', async () => {
    const f = await createFixture();
    const other = await createFixture();
    const id = await createPublishedDefinition(f.tenant);
    await scope(f, id, 'scoped', [f.clientA]);

    // Other tenant's requester (even with a matching-looking client id) sees nothing of this tenant's form.
    const otherCatalog = await listVisibleServiceRequestCatalogItems(db, ctx(other, 'A0'));
    expect(otherCatalog.map((i) => i.definitionId)).not.toContain(id);
    expect(await getVisiblePublishedServiceRequestDefinitionDetail(db, ctx(other, 'A0'), id)).toBeNull();

    // Querying this tenant with the other tenant's client id is denied.
    const crossTenantContext = { tenant: f.tenant, requesterUserId: f.userA, clientId: other.clientA, contactId: null };
    expect((await listVisibleServiceRequestCatalogItems(db, crossTenantContext)).map((i) => i.definitionId)).not.toContain(id);
    // Loading the audience from the wrong tenant fails closed.
    expect(await loadDefinitionAudience(db, other.tenant, id)).toEqual({ mode: 'scoped', clientIds: [], groupIds: [] });
  });
});
