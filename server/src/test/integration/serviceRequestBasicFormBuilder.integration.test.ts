import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import {
  addBasicFormFieldToDefinitionDraft,
  removeBasicFormFieldFromDefinitionDraft,
  reorderBasicFormFieldsInDefinitionDraft,
  replaceBasicFormSchemaForDefinitionDraft,
  updateBasicFormFieldInDefinitionDraft,
} from '../../lib/service-requests/basicFormBuilder';
import {
  createBlankServiceRequestDefinition,
} from '../../lib/service-requests/definitionManagement';
import {
  publishServiceRequestDefinitionWithValidation,
  validateServiceRequestDefinitionForPublish,
} from '../../lib/service-requests/definitionValidation';

describe('service request basic form builder', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  it('T012: short-text, long-text, checkbox, and date fields can be authored and serialized to draft schema', async () => {
    const tenant = uuidv4();
    const actor = uuidv4();

    await db('tenants').insert({
      tenant,
      client_name: `Tenant ${tenant.slice(0, 8)}`,
      email: `tenant-${tenant.slice(0, 8)}@example.com`,
    });

    const definition = await createBlankServiceRequestDefinition({
      knex: db,
      tenant,
      name: 'Laptop Intake',
      createdBy: actor,
    });

    await addBasicFormFieldToDefinitionDraft({
      knex: db,
      tenant,
      definitionId: definition.definition_id,
      updatedBy: actor,
      field: {
        type: 'short-text',
        label: 'Employee Name',
        helpText: 'Full legal name',
        required: true,
        defaultValue: 'Jane Doe',
      },
    });
    await addBasicFormFieldToDefinitionDraft({
      knex: db,
      tenant,
      definitionId: definition.definition_id,
      updatedBy: actor,
      field: {
        type: 'long-text',
        label: 'Business Justification',
        helpText: 'Why this request is needed',
        required: false,
      },
    });
    await addBasicFormFieldToDefinitionDraft({
      knex: db,
      tenant,
      definitionId: definition.definition_id,
      updatedBy: actor,
      field: {
        type: 'checkbox',
        label: 'Manager Approved',
        required: true,
        defaultValue: false,
      },
    });
    await addBasicFormFieldToDefinitionDraft({
      knex: db,
      tenant,
      definitionId: definition.definition_id,
      updatedBy: actor,
      field: {
        type: 'date',
        label: 'Needed By Date',
        required: true,
        defaultValue: '2026-04-01',
      },
    });

    const saved = await db('service_request_definitions')
      .where({ tenant, definition_id: definition.definition_id })
      .first('form_schema');

    const fields = (saved?.form_schema as any).fields;
    expect(fields).toHaveLength(4);
    expect(fields.map((field: any) => field.type)).toEqual([
      'short-text',
      'long-text',
      'checkbox',
      'date',
    ]);
    expect(fields[0]).toMatchObject({
      label: 'Employee Name',
      helpText: 'Full legal name',
      required: true,
      defaultValue: 'Jane Doe',
    });
    expect(fields[2]).toMatchObject({
      label: 'Manager Approved',
      defaultValue: false,
    });
  });

  it('T013: select fields preserve option lists and static defaults through publish snapshot', async () => {
    const tenant = uuidv4();
    const actor = uuidv4();

    await db('tenants').insert({
      tenant,
      client_name: `Tenant ${tenant.slice(0, 8)}`,
      email: `tenant-${tenant.slice(0, 8)}@example.com`,
    });

    const definition = await createBlankServiceRequestDefinition({
      knex: db,
      tenant,
      name: 'Access Request',
      createdBy: actor,
    });

    await addBasicFormFieldToDefinitionDraft({
      knex: db,
      tenant,
      definitionId: definition.definition_id,
      updatedBy: actor,
      field: {
        type: 'select',
        label: 'Requested Access',
        required: true,
        defaultValue: 'standard',
        options: [
          { label: 'Standard', value: 'standard' },
          { label: 'Admin', value: 'admin' },
        ],
      },
    });

    const version = await publishServiceRequestDefinitionWithValidation({
      knex: db,
      tenant,
      definitionId: definition.definition_id,
      publishedBy: actor,
    });

    const publishedVersion = await db('service_request_definition_versions')
      .where({ tenant, version_id: version.version_id })
      .first('form_schema_snapshot');

    const fields = (publishedVersion?.form_schema_snapshot as any).fields;
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({
      type: 'select',
      label: 'Requested Access',
      required: true,
      defaultValue: 'standard',
      options: [
        { label: 'Standard', value: 'standard' },
        { label: 'Admin', value: 'admin' },
      ],
    });
  });

  it('T014: add/remove/reorder operations keep field keys stable across presentation-only updates', async () => {
    const tenant = uuidv4();
    const actor = uuidv4();

    await db('tenants').insert({
      tenant,
      client_name: `Tenant ${tenant.slice(0, 8)}`,
      email: `tenant-${tenant.slice(0, 8)}@example.com`,
    });

    const definition = await createBlankServiceRequestDefinition({
      knex: db,
      tenant,
      name: 'Hardware Request',
      createdBy: actor,
    });

    await addBasicFormFieldToDefinitionDraft({
      knex: db,
      tenant,
      definitionId: definition.definition_id,
      updatedBy: actor,
      field: { type: 'short-text', label: 'Device Type', required: true },
    });
    await addBasicFormFieldToDefinitionDraft({
      knex: db,
      tenant,
      definitionId: definition.definition_id,
      updatedBy: actor,
      field: { type: 'date', label: 'Needed By', required: true },
    });
    await addBasicFormFieldToDefinitionDraft({
      knex: db,
      tenant,
      definitionId: definition.definition_id,
      updatedBy: actor,
      field: { type: 'checkbox', label: 'Manager Approved', required: false },
    });

    const beforeReorder = await db('service_request_definitions')
      .where({ tenant, definition_id: definition.definition_id })
      .first('form_schema');
    const originalKeys = ((beforeReorder?.form_schema as any).fields as any[]).map(
      (field) => field.key
    );

    await reorderBasicFormFieldsInDefinitionDraft({
      knex: db,
      tenant,
      definitionId: definition.definition_id,
      orderedFieldKeys: [originalKeys[2], originalKeys[0], originalKeys[1]],
      updatedBy: actor,
    });

    await updateBasicFormFieldInDefinitionDraft({
      knex: db,
      tenant,
      definitionId: definition.definition_id,
      fieldKey: originalKeys[0],
      updatedBy: actor,
      updates: {
        label: 'Requested Device Type',
        helpText: 'Laptop, monitor, or peripheral',
      },
    });

    await removeBasicFormFieldFromDefinitionDraft({
      knex: db,
      tenant,
      definitionId: definition.definition_id,
      fieldKey: originalKeys[1],
      updatedBy: actor,
    });

    const afterEdits = await db('service_request_definitions')
      .where({ tenant, definition_id: definition.definition_id })
      .first('form_schema');
    const remainingFields = (afterEdits?.form_schema as any).fields as any[];
    const remainingKeys = remainingFields.map((field) => field.key);

    expect(remainingKeys).toEqual([originalKeys[2], originalKeys[0]]);
    expect(remainingFields.find((field) => field.key === originalKeys[0])).toMatchObject({
      label: 'Requested Device Type',
      helpText: 'Laptop, monitor, or peripheral',
    });
  });

  it('T015: publish validation rejects duplicate and invalid field keys', async () => {
    const tenant = uuidv4();
    const actor = uuidv4();

    await db('tenants').insert({
      tenant,
      client_name: `Tenant ${tenant.slice(0, 8)}`,
      email: `tenant-${tenant.slice(0, 8)}@example.com`,
    });

    const definition = await createBlankServiceRequestDefinition({
      knex: db,
      tenant,
      name: 'Validation Test',
      createdBy: actor,
    });

    await replaceBasicFormSchemaForDefinitionDraft({
      knex: db,
      tenant,
      definitionId: definition.definition_id,
      updatedBy: actor,
      fields: [
        {
          key: 'bad-key',
          type: 'short-text',
          label: 'Bad Key Field',
          required: true,
        },
        {
          key: 'bad_key',
          type: 'short-text',
          label: 'Duplicate One',
          required: true,
        },
        {
          key: 'bad_key',
          type: 'short-text',
          label: 'Duplicate Two',
          required: true,
        },
      ],
    });

    const validation = await validateServiceRequestDefinitionForPublish(
      db,
      tenant,
      definition.definition_id
    );

    expect(validation.isValid).toBe(false);
    expect(validation.errors.some((error) => error.includes('invalid key'))).toBe(true);
    expect(validation.errors.some((error) => error.includes('Duplicate field key'))).toBe(true);
  });
});
