import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import {
  archiveServiceRequestDefinitionFromManagement,
  createBlankServiceRequestDefinition,
  createServiceRequestDefinitionFromTemplate,
  duplicateServiceRequestDefinition,
  listServiceRequestDefinitionsForManagement,
  listServiceRequestTemplateOptions,
  unarchiveServiceRequestDefinitionFromManagement,
} from '../../lib/service-requests/definitionManagement';

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

    const templates = listServiceRequestTemplateOptions();
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
