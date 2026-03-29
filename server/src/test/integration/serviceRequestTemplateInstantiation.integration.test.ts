import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import {
  createBlankServiceRequestDefinition,
  createServiceRequestDefinitionFromTemplate,
  listServiceRequestTemplateOptions,
  saveServiceRequestDefinitionDraft,
} from '../../lib/service-requests/definitionManagement';

describe('service request template instantiation', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  it('T009: template instantiation creates detached editable drafts and remains an optional shortcut', async () => {
    const tenant = uuidv4();
    const actor = uuidv4();

    await db('tenants').insert({
      tenant,
      client_name: `Tenant ${tenant.slice(0, 8)}`,
      email: `tenant-${tenant.slice(0, 8)}@example.com`,
    });

    const templates = listServiceRequestTemplateOptions();
    const newHireTemplate = templates.find(
      (template) => template.providerKey === 'ce-starter-pack' && template.templateId === 'new-hire'
    );
    expect(newHireTemplate).toBeDefined();

    const blankDraft = await createBlankServiceRequestDefinition({
      knex: db,
      tenant,
      name: 'Optional Blank Draft',
      createdBy: actor,
    });
    expect(blankDraft.name).toBe('Optional Blank Draft');

    const templateDraftA = await createServiceRequestDefinitionFromTemplate({
      knex: db,
      tenant,
      templateProviderKey: newHireTemplate!.providerKey,
      templateId: newHireTemplate!.templateId,
      createdBy: actor,
    });

    await saveServiceRequestDefinitionDraft({
      knex: db,
      tenant,
      definitionId: templateDraftA.definition_id,
      updatedBy: actor,
      updates: {
        name: 'Template A Customized',
        execution_config: {
          titleTemplate: 'Customized title',
          includeFormResponsesInDescription: false,
        },
      },
    });

    const templateDraftB = await createServiceRequestDefinitionFromTemplate({
      knex: db,
      tenant,
      templateProviderKey: newHireTemplate!.providerKey,
      templateId: newHireTemplate!.templateId,
      createdBy: actor,
    });

    const storedB = await db('service_request_definitions')
      .where({ tenant, definition_id: templateDraftB.definition_id })
      .first('name', 'execution_config');

    expect(storedB?.name).toBe('New Hire Request');
    expect(storedB?.execution_config).toEqual({
      titleTemplate: 'New Hire Setup: {{employee_name}}',
      includeFormResponsesInDescription: true,
    });
  });
});
