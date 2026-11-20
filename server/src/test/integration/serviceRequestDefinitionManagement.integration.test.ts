import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import {
  archiveServiceRequestDefinitionFromManagement,
  createBlankServiceRequestDefinition,
  createServiceRequestDefinitionFromTemplate,
  deleteServiceRequestDefinitionFromManagement,
  duplicateServiceRequestDefinition,
  listServiceRequestDefinitionsForManagement,
  listServiceRequestTemplateOptions,
  unarchiveServiceRequestDefinitionFromManagement,
} from '../../lib/service-requests/definitionManagement';

const publishEventMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: publishEventMock }));

describe('service request definition management', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  it('T006: list management supports create blank/template, duplicate, archive, and unarchive flows', async () => {
    const tenant = uuidv4();
    const actor = uuidv4();

    await db('tenants').insert({
      tenant,
      client_name: `Tenant ${tenant.slice(0, 8)}`,
      email: `tenant-${tenant.slice(0, 8)}@example.com`,
    });

    const templates = listServiceRequestTemplateOptions(tenant);
    expect(templates).toHaveLength(6);
    const starterTemplate = templates.find(
      (template) => template.providerKey === 'ce-starter-pack' && template.templateId === 'new-hire'
    );

    expect(starterTemplate).toBeDefined();

    const blank = await createBlankServiceRequestDefinition({
      knex: db,
      tenant,
      name: 'Helpdesk Intake',
      createdBy: actor,
    });

    const fromTemplate = await createServiceRequestDefinitionFromTemplate({
      knex: db,
      tenant,
      templateProviderKey: starterTemplate!.providerKey,
      templateId: starterTemplate!.templateId,
      createdBy: actor,
    });

    const duplicate = await duplicateServiceRequestDefinition({
      knex: db,
      tenant,
      sourceDefinitionId: blank.definition_id,
      createdBy: actor,
    });

    await archiveServiceRequestDefinitionFromManagement(db, tenant, blank.definition_id, actor);

    let definitions = await listServiceRequestDefinitionsForManagement(db, tenant);
    expect(definitions).toHaveLength(3);

    const archivedBlank = definitions.find((definition) => definition.definition_id === blank.definition_id);
    const createdFromTemplate = definitions.find(
      (definition) => definition.definition_id === fromTemplate.definition_id
    );
    const createdDuplicate = definitions.find(
      (definition) => definition.definition_id === duplicate.definition_id
    );

    expect(archivedBlank?.lifecycle_state).toBe('archived');
    expect(createdFromTemplate?.lifecycle_state).toBe('draft');
    expect(createdDuplicate?.name).toBe('Helpdesk Intake (Copy)');

    await unarchiveServiceRequestDefinitionFromManagement(db, tenant, blank.definition_id, actor);
    definitions = await listServiceRequestDefinitionsForManagement(db, tenant);
    const unarchivedBlank = definitions.find((definition) => definition.definition_id === blank.definition_id);

    expect(unarchivedBlank?.lifecycle_state).toBe('draft');
  });
});

describe('service request definition deletion (deletion engine)', () => {
  let db: Knex;
  const tenants: string[] = [];
  const t = (tenant: string, table: string) => tenantDb(db, tenant).table(table);

  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
  });

  beforeEach(() => {
    publishEventMock.mockClear();
  });

  afterAll(async () => {
    if (db) {
      for (const tenant of tenants) {
        for (const table of [
          'checklist_template_apply_rules',
          'checklist_templates',
          'service_request_submissions',
          'tag_references',
          'tag_definitions',
          'service_request_definitions',
        ]) {
          await t(tenant, table).del();
        }
        await tenantDb(db, '__test_tenant_fixture__')
          .unscoped('tenants', 'test fixture removes tenant rows')
          .where({ tenant })
          .del();
      }
      await db.destroy();
    }
  });

  const deletedEvents = () =>
    publishEventMock.mock.calls.filter(
      ([arg]) => (arg as { eventType: string }).eventType === 'SERVICE_REQUEST_DEFINITION_DELETED'
    );

  async function createTenant(): Promise<string> {
    const tenant = uuidv4();
    tenants.push(tenant);
    await tenantDb(db, '__test_tenant_fixture__')
      .unscoped('tenants', 'test fixture creates tenant rows')
      .insert({
        tenant,
        client_name: `Tenant ${tenant.slice(0, 8)}`,
        email: `tenant-${tenant.slice(0, 8)}@example.com`,
      });
    return tenant;
  }

  async function createPublished(tenant: string) {
    const blank = await createBlankServiceRequestDefinition({ knex: db, tenant, name: 'Unused Form', createdBy: null });
    const versionId = uuidv4();
    await t(tenant, 'service_request_definition_versions').insert({
      tenant,
      version_id: versionId,
      definition_id: blank.definition_id,
      version_number: 1,
      name: 'Unused Form',
      form_schema_snapshot: { fields: [] },
      execution_provider: 'store-only',
      execution_config: {},
      form_behavior_provider: 'basic',
      form_behavior_config: {},
      visibility_provider: 'all-authenticated-client-users',
      visibility_config: {},
    });
    await t(tenant, 'service_request_definitions')
      .where({ definition_id: blank.definition_id })
      .update({ lifecycle_state: 'published', published_at: db.fn.now() });
    return { definitionId: blank.definition_id, versionId };
  }

  it('T001: deletes a never-submitted published definition with its versions, mapping and audience tag references', async () => {
    const tenant = await createTenant();
    const { definitionId } = await createPublished(tenant);
    const tagId = uuidv4();
    await t(tenant, 'tag_definitions').insert({ tenant, tag_id: tagId, tag_text: 'Audience', tagged_type: 'client' });
    await t(tenant, 'tag_references').insert({
      tenant,
      tag_id: tagId,
      referrer_type: 'service_request_audience',
      referrer_id: definitionId,
    });
    await t(tenant, 'service_request_answer_mappings').insert({
      tenant,
      mapping_id: uuidv4(),
      definition_id: definitionId,
    });

    const result = await deleteServiceRequestDefinitionFromManagement(db, tenant, definitionId, null);

    expect(result.deleted).toBe(true);
    expect(result.canDelete).toBe(true);
    expect(await t(tenant, 'service_request_definitions').where({ definition_id: definitionId }).first()).toBeUndefined();
    expect(await t(tenant, 'service_request_definition_versions').where({ definition_id: definitionId }).first()).toBeUndefined();
    expect(await t(tenant, 'service_request_answer_mappings').where({ definition_id: definitionId }).first()).toBeUndefined();
    expect(
      await t(tenant, 'tag_references').where({ referrer_type: 'service_request_audience', referrer_id: definitionId }).first()
    ).toBeUndefined();
    expect(deletedEvents()).toHaveLength(1);
  });

  it('T002: refuses to delete a definition that has a submission and offers archive', async () => {
    const tenant = await createTenant();
    const { definitionId, versionId } = await createPublished(tenant);
    const clientId = uuidv4();
    await t(tenant, 'clients').insert({
      tenant,
      client_id: clientId,
      client_name: `Client ${tenant.slice(0, 8)}`,
      is_inactive: false,
      billing_cycle: 'monthly',
      is_tax_exempt: false,
    });
    await t(tenant, 'service_request_submissions').insert({
      tenant,
      submission_id: uuidv4(),
      definition_id: definitionId,
      definition_version_id: versionId,
      client_id: clientId,
      request_name: 'Unused Form',
      submitted_payload: {},
    });

    const result = await deleteServiceRequestDefinitionFromManagement(db, tenant, definitionId, null);

    expect(result.deleted).toBe(false);
    expect(result.canDelete).toBe(false);
    expect(result.code).toBe('DEPENDENCIES_EXIST');
    expect(result.dependencies.find((d) => d.type === 'submission')?.count).toBe(1);
    expect(result.alternatives.some((a) => a.action === 'archive')).toBe(true);
    expect(await t(tenant, 'service_request_definitions').where({ definition_id: definitionId }).first()).toBeTruthy();
    expect(await t(tenant, 'service_request_definition_versions').where({ definition_id: definitionId }).first()).toBeTruthy();
    expect(deletedEvents()).toHaveLength(0);
    await t(tenant, 'clients').where({ client_id: clientId }).del();
  });

  it('T003: refuses when a checklist apply rule predicate references the definition (tenant scoped)', async () => {
    const tenant = await createTenant();
    const otherTenant = await createTenant();
    const { definitionId } = await createPublished(tenant);

    const addRule = async (ruleTenant: string) => {
      const templateId = uuidv4();
      await t(ruleTenant, 'checklist_templates').insert({ tenant: ruleTenant, template_id: templateId, name: 'Onboarding' });
      await t(ruleTenant, 'checklist_template_apply_rules').insert({
        tenant: ruleTenant,
        apply_rule_id: uuidv4(),
        template_id: templateId,
        where: JSON.stringify({
          join: 'and',
          clauses: [{ path: 'service_request_definition_id', operator: 'in', value: [definitionId] }],
        }),
      });
    };
    await addRule(tenant);
    await addRule(otherTenant); // must not be counted for `tenant`

    const result = await deleteServiceRequestDefinitionFromManagement(db, tenant, definitionId, null);

    expect(result.deleted).toBe(false);
    expect(result.code).toBe('DEPENDENCIES_EXIST');
    const dep = result.dependencies.find((d) => d.type === 'checklist_apply_rule');
    expect(dep?.count).toBe(1);
    expect(dep?.label).toBe('checklist apply rule');
    expect(await t(tenant, 'service_request_definitions').where({ definition_id: definitionId }).first()).toBeTruthy();
  });

  it('T004: returns NOT_FOUND for an unknown id and for another tenant\'s definition', async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const { definitionId } = await createPublished(tenantB);

    const cross = await deleteServiceRequestDefinitionFromManagement(db, tenantA, definitionId, null);
    expect(cross.deleted).toBe(false);
    expect(cross.code).toBe('NOT_FOUND');
    expect(await t(tenantB, 'service_request_definitions').where({ definition_id: definitionId }).first()).toBeTruthy();

    const unknown = await deleteServiceRequestDefinitionFromManagement(db, tenantA, uuidv4(), null);
    expect(unknown.deleted).toBe(false);
    expect(unknown.code).toBe('NOT_FOUND');
    expect(deletedEvents()).toHaveLength(0);
  });
});
