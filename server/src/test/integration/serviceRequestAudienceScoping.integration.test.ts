import { createRequire } from 'node:module';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { getAudienceReach } from '../../lib/service-requests/audienceReach';
import { loadRequesterRecord } from '../../lib/service-requests/definitionAudience';
import { listVisibleServiceRequestCatalogItems } from '../../lib/service-requests/portalCatalog';
import { getVisiblePublishedServiceRequestDefinitionDetail } from '../../lib/service-requests/portalDetail';
import { submitPortalServiceRequest } from '../../lib/service-requests/submissionService';
import {
  duplicateServiceRequestDefinition,
  deleteServiceRequestDefinitionFromManagement,
  saveServiceRequestDefinitionAudience,
} from '../../lib/service-requests/definitionManagement';
import { getServiceRequestDefinitionEditorData } from '../../lib/service-requests/definitionEditor';
import { validateServiceRequestDefinitionForPublish } from '../../lib/service-requests/definitionValidation';
import { publishServiceRequestDefinition } from '../../lib/service-requests/definitionPublishing';

const require = createRequire(import.meta.url);
const audienceMigration = require('../../../migrations/20261028090000_add_service_request_audience_scoping.cjs');

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
  await t(tenant, 'users').where({ user_id: f.userA }).update({ user_type: 'client', contact_id: f.contactA1, is_inactive: false });
  await t(tenant, 'users').where({ user_id: f.userB }).update({ user_type: 'client', contact_id: f.contactB1, is_inactive: false });
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
    audience: mode === 'all' ? { join: 'and', clauses: [] } : { join: 'or', clauses: [...clientIds.map((id) => ({ path: 'client.id', operator: 'in' as const, value: [id] })), ...(groupIds.length ? [{ path: 'contact.group.id', operator: 'in' as const, value: groupIds }] : [])] },
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
  await t(tenant, 'tag_references').del();
  await t(tenant, 'tag_mappings').del();
  await t(tenant, 'tag_definitions').del();
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

  it('defaults to everyone and selected-empty admits nobody', async () => {
    const f = await createFixture(); const id = await createPublishedDefinition(f.tenant);
    expect(await catalogIds(f, 'A1')).toContain(id);
    expect(await detail(f, 'B1', id)).not.toBeNull();
    await scope(f, id, 'scoped', []);
    expect(await catalogIds(f, 'A1')).not.toContain(id);
    expect(await detail(f, 'B1', id)).toBeNull();
    const validation = await validateServiceRequestDefinitionForPublish(db, f.tenant, id);
    expect(validation.isValid).toBe(true);
    expect(validation.warnings).toContain('Visibility: Nobody can access this service request');
  });
  it('client and group entries enforce catalog, detail and submission', async () => {
    const f = await createFixture(); const id = await createPublishedDefinition(f.tenant);
    await scope(f, id, 'scoped', [f.clientB], [f.groupA1]);
    expect(await catalogIds(f, 'A1')).toContain(id);
    expect(await catalogIds(f, 'A2')).not.toContain(id);
    expect(await detail(f, 'B1', id)).not.toBeNull();
    await expect(submitPortalServiceRequest({ knex: db, tenant: f.tenant, definitionId: id, requesterUserId: f.userA, clientId: f.clientA, contactId: f.contactA2, payload: { notes: 'hello' } })).rejects.toThrow('Service request is not visible or not published');
    expect(await submissionCount(f.tenant)).toBe(0);
    const submitted = await submitPortalServiceRequest({ knex: db, tenant: f.tenant, definitionId: id, requesterUserId: f.userA, clientId: f.clientA, contactId: f.contactA1, payload: { notes: 'allowed' } });
    expect(submitted.submissionId).toBeTruthy();
    expect(await submissionCount(f.tenant)).toBe(1);
  });
  it('rejects cross-tenant references and a client with its own group', async () => {
    const f = await createFixture(); const other = await createFixture(); const id = await createPublishedDefinition(f.tenant);
    await expect(scope(f, id, 'scoped', [other.clientA])).rejects.toThrow();
    await expect(scope(f, id, 'scoped', [f.clientA], [f.groupA1])).rejects.toThrow();
    expect(await detail(other, 'A1', id)).toBeNull();
  });
  it('admits individual contacts and denies others', async () => {
    const f = await createFixture(); const id = await createPublishedDefinition(f.tenant);
    await saveServiceRequestDefinitionAudience({ knex: db, tenant: f.tenant, definitionId: id, audience: { join: 'or', clauses: [{path: 'contact.id', operator: 'in', value: [f.contactA1]}] } });
    expect(await detail(f, 'A1', id)).not.toBeNull();
    expect(await detail(f, 'A2', id)).toBeNull();
  });  it('tag audiences, SQL reach and tag references agree', async () => {
    const f = await createFixture(); const id = await createPublishedDefinition(f.tenant); const tag = uuidv4();
    await t(f.tenant, 'tag_definitions').insert({ tenant: f.tenant, tag_id: tag, tag_text: 'Audience VIP', tagged_type: 'client' });
    await t(f.tenant, 'tag_mappings').insert({ tenant: f.tenant, tag_id: tag, tagged_id: f.clientA, tagged_type: 'client' });
    const audience = { join: 'or' as const, clauses: [{ path: 'client.tags', operator: 'in' as const, value: [tag] }] };
    await saveServiceRequestDefinitionAudience({ knex: db, tenant: f.tenant, definitionId: id, audience });
    expect(await detail(f, 'A1', id)).not.toBeNull();
    expect(await detail(f, 'B1', id)).toBeNull();
    expect(await getAudienceReach(db, f.tenant, audience)).toEqual({ contacts: 1, clients: 1 });
    expect(await t(f.tenant, 'tag_references').where({ tag_id: tag, referrer_id: id }).first()).toBeTruthy();
    const copy = await duplicateServiceRequestDefinition({ knex: db, tenant: f.tenant, sourceDefinitionId: id });
    expect(await t(f.tenant, 'tag_references').where({ tag_id: tag, referrer_id: copy.definition_id }).first()).toBeTruthy();
    await deleteServiceRequestDefinitionFromManagement(db, f.tenant, copy.definition_id);
    expect(await t(f.tenant, 'tag_references').where({ tag_id: tag, referrer_id: copy.definition_id }).first()).toBeUndefined();
    await scope(f, id, 'all', []);
    expect(await t(f.tenant, 'tag_references').where({ tag_id: tag, referrer_id: id }).first()).toBeUndefined();
  });
  it('retains an audience-only tag during orphan cleanup', async () => {
    const f = await createFixture(); const id = await createPublishedDefinition(f.tenant); const tag = uuidv4();
    await t(f.tenant, 'tag_definitions').insert({ tenant: f.tenant, tag_id: tag, tag_text: 'Future audience', tagged_type: 'contact' });
    await saveServiceRequestDefinitionAudience({ knex: db, tenant: f.tenant, definitionId: id, audience: { join: 'or', clauses: [{ path: 'contact.tags', operator: 'in', value: [tag] }] } });
    const TagDefinition = (await import('../../../../packages/tags/src/models/tagDefinition')).default;
    expect(await TagDefinition.deleteOrphaned(db, f.tenant, [tag])).toBe(0);
    expect(await t(f.tenant, 'tag_definitions').where({ tag_id: tag }).first()).toBeTruthy();
    await scope(f, id, 'all', []);
    expect(await TagDefinition.deleteOrphaned(db, f.tenant, [tag])).toBe(1);
  });
  it('removes missing references from the working copy without widening a narrowed entry', async () => {
    const f = await createFixture(); const id = await createPublishedDefinition(f.tenant); const tag = uuidv4();
    await t(f.tenant, 'tag_definitions').insert({ tenant: f.tenant, tag_id: tag, tag_text: 'Removed', tagged_type: 'contact' });
    const audience = { join: 'or' as const, clauses: [{ join: 'and' as const, clauses: [{path: 'client.id', operator: 'in' as const, value: [f.clientA]}, {path: 'contact.tags', operator: 'in' as const, value: [tag]}] }] };
    await saveServiceRequestDefinitionAudience({ knex: db, tenant: f.tenant, definitionId: id, audience });
    await t(f.tenant, 'tag_definitions').where({ tag_id: tag }).del();
    const editor = await getServiceRequestDefinitionEditorData(db, f.tenant, id);
    expect(editor?.execution.audience).toEqual({ join: 'or', clauses: [] });
    expect(editor?.execution.removedAudienceReferences).toContain('contact.tags');
    const validation = await validateServiceRequestDefinitionForPublish(db, f.tenant, id);
    expect(validation.isValid).toBe(false);
    await saveServiceRequestDefinitionAudience({ knex: db, tenant: f.tenant, definitionId: id, audience: editor!.execution.audience });
    expect((await validateServiceRequestDefinitionForPublish(db, f.tenant, id)).isValid).toBe(true);
    expect(await detail(f, 'A1', id)).toBeNull();
  });
  it('reach and access both reject a contact assigned to another client’s group', async () => {
    const f = await createFixture(); const id = await createPublishedDefinition(f.tenant);
    await t(f.tenant, 'contacts').where({ contact_name_id: f.contactB1 }).update({ portal_visibility_group_id: f.groupA1 });
    const audience = { join: 'or' as const, clauses: [{ path: 'contact.group.id', operator: 'in' as const, value: [f.groupA1] }] };
    await saveServiceRequestDefinitionAudience({ knex: db, tenant: f.tenant, definitionId: id, audience });
    expect(await detail(f, 'A1', id)).not.toBeNull();
    expect(await detail(f, 'B1', id)).toBeNull();
    expect(await getAudienceReach(db, f.tenant, audience)).toEqual({ contacts: 1, clients: 1 });
  });
  it('contact tags narrow clients while an OR entry admits another contact', async () => {
    const f = await createFixture(); const id = await createPublishedDefinition(f.tenant); const tag = uuidv4();
    await t(f.tenant, 'tag_definitions').insert({ tenant: f.tenant, tag_id: tag, tag_text: 'Approver', tagged_type: 'contact' });
    await t(f.tenant, 'tag_mappings').insert({ tenant: f.tenant, tag_id: tag, tagged_id: f.contactA1, tagged_type: 'contact' });
    const audience = { join: 'or' as const, clauses: [
      { join: 'and' as const, clauses: [{ path: 'client.id', operator: 'in' as const, value: [f.clientA] }, { path: 'contact.tags', operator: 'in' as const, value: [tag] }] },
      { path: 'contact.id', operator: 'in' as const, value: [f.contactB1] },
    ] };
    await saveServiceRequestDefinitionAudience({ knex: db, tenant: f.tenant, definitionId: id, audience });
    expect(await detail(f, 'A1', id)).not.toBeNull();
    expect(await detail(f, 'A2', id)).toBeNull();
    expect(await detail(f, 'B1', id)).not.toBeNull();
    expect(await getAudienceReach(db, f.tenant, audience)).toEqual({ contacts: 2, clients: 2 });
  });
  it('rejects foreign contacts, groups, tags and unsupported paths', async () => {
    const f = await createFixture(); const other = await createFixture(); const id = await createPublishedDefinition(f.tenant);
    const clientTag = uuidv4(); const contactTag = uuidv4();
    await t(other.tenant, 'tag_definitions').insert([
      { tenant: other.tenant, tag_id: clientTag, tag_text: 'Foreign client tag', tagged_type: 'client' },
      { tenant: other.tenant, tag_id: contactTag, tag_text: 'Foreign contact tag', tagged_type: 'contact' },
    ]);
    for (const [path, value] of [['contact.id', other.contactA1], ['contact.group.id', other.groupA1], ['client.tags', clientTag], ['contact.tags', contactTag], ['contact.secret', f.contactA1]]) {
      await expect(saveServiceRequestDefinitionAudience({ knex: db, tenant: f.tenant, definitionId: id, audience: { join: 'or', clauses: [{ path, operator: 'in', value: [value] }] } })).rejects.toThrow();
    }
  });
  it('copies the live audience when duplicating and does not snapshot it on publish', async () => {
    const f = await createFixture(); const id = await createPublishedDefinition(f.tenant);
    await scope(f, id, 'scoped', [f.clientA]);
    const copy = await duplicateServiceRequestDefinition({ knex: db, tenant: f.tenant, sourceDefinitionId: id });
    const copyRow = await t(f.tenant, 'service_request_definitions').where({ definition_id: copy.definition_id }).first('audience');
    expect(copyRow.audience).toEqual({ join: 'or', clauses: [{ path: 'client.id', operator: 'in', value: [f.clientA] }] });
    await publishServiceRequestDefinition({ knex: db, tenant: f.tenant, definitionId: id, publishedBy: f.userA });
    await scope(f, id, 'scoped', [f.clientB]);
    expect(await detail(f, 'A1', id)).toBeNull();
    expect(await detail(f, 'B1', id)).not.toBeNull();
  });
  it('does not hydrate a foreign requester user', async () => {
    const f = await createFixture(); const other = await createFixture();
    const requester = await loadRequesterRecord(db, f.tenant, { requesterUserId: other.userA, clientId: f.clientA, contactId: f.contactA1 });
    expect(requester.user).toBeNull();
  });
  it('refuses legacy link tables even if the mode column is absent', async () => {
    const trx = await db.transaction();
    try {
      await trx.schema.createTable('service_request_audience_clients', (table) => table.uuid('client_id'));
      await expect(audienceMigration.up(trx)).rejects.toThrow('Revision-1 service request audience schema exists');
    } finally {
      await trx.rollback();
    }
  });
  it('refuses to replace a revision-1 schema without explicit cleanup', async () => {
    const trx = await db.transaction();
    try {
      await trx.schema.alterTable('service_request_definitions', (table) => table.text('audience_mode'));
      await expect(audienceMigration.up(trx)).rejects.toThrow('Revision-1 service request audience schema exists');
    } finally {
      await trx.rollback();
    }
  });

});
