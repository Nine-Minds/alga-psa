import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  normalizeBasicFormSchema,
  slugifyFieldKey,
  withUniqueFieldKey,
  type BasicFormField,
  type BasicFormSchema,
  type BasicFormSettings,
} from './formSchema';
import { defaultLookupDescriptor, type FieldLookupDescriptor } from '@alga-psa/ui/form-fields';
import { saveServiceRequestDefinitionDraft, type ServiceRequestDefinitionManagementRow } from './definitionManagement';

/**
 * Draft persistence for the schema v2 form builder.
 *
 * The schema itself — types, normalization, validation, section grouping — lives in
 * `./formSchema`, which imports nothing server-side so client components can read it.
 * Everything there is re-exported here, so existing importers keep working.
 */
export * from './formSchema';

interface DraftFormSchemaRow {
  form_schema: Record<string, unknown> | null;
}

async function getDefinitionFormSchema(
  knex: Knex,
  tenant: string,
  definitionId: string
): Promise<BasicFormSchema> {
  const row = (await tenantDb(knex, tenant).table('service_request_definitions')
    .where({ definition_id: definitionId })
    .first('form_schema')) as DraftFormSchemaRow | undefined;

  if (!row) {
    throw new Error('Service request definition not found');
  }

  return normalizeBasicFormSchema(row.form_schema);
}

export async function replaceBasicFormSchemaForDefinitionDraft(input: {
  knex: Knex;
  tenant: string;
  definitionId: string;
  fields: BasicFormField[];
  /** Form-level settings (width, submit label, success message). Omitted leaves none stored. */
  settings?: BasicFormSettings;
  updatedBy?: string | null;
}): Promise<ServiceRequestDefinitionManagementRow> {
  const normalized = normalizeBasicFormSchema({ fields: input.fields, settings: input.settings });
  return saveServiceRequestDefinitionDraft({
    knex: input.knex,
    tenant: input.tenant,
    definitionId: input.definitionId,
    updatedBy: input.updatedBy ?? null,
    updates: {
      form_schema: normalized as unknown as Record<string, unknown>,
    },
  });
}

export async function addBasicFormFieldToDefinitionDraft(input: {
  knex: Knex;
  tenant: string;
  definitionId: string;
  field: Omit<BasicFormField, 'key'> & { key?: string };
  index?: number;
  updatedBy?: string | null;
}): Promise<ServiceRequestDefinitionManagementRow> {
  const schema = await getDefinitionFormSchema(input.knex, input.tenant, input.definitionId);
  const existingKeys = new Set(schema.fields.map((field) => field.key));
  const baseKey = slugifyFieldKey(input.field.key?.trim() || input.field.label || input.field.type);
  const key = withUniqueFieldKey(baseKey, existingKeys);
  const nextField: BasicFormField = {
    ...input.field,
    key,
    type: input.field.type,
    label: input.field.label,
    helpText: input.field.helpText ?? null,
    required: Boolean(input.field.required),
    defaultValue: input.field.defaultValue,
    options: input.field.options,
    // A new lookup starts valid (first entity, its default scope) so the author only has to change it.
    lookup: input.field.type === 'lookup' ? (input.field.lookup ?? defaultLookupDescriptor()) : undefined,
  };

  const nextFields = [...schema.fields];
  const index = input.index ?? nextFields.length;
  const boundedIndex = Math.max(0, Math.min(index, nextFields.length));
  nextFields.splice(boundedIndex, 0, nextField);

  return replaceBasicFormSchemaForDefinitionDraft({
    knex: input.knex,
    tenant: input.tenant,
    definitionId: input.definitionId,
    fields: nextFields,
    settings: schema.settings,
    updatedBy: input.updatedBy,
  });
}

export async function updateBasicFormFieldInDefinitionDraft(input: {
  knex: Knex;
  tenant: string;
  definitionId: string;
  fieldKey: string;
  /** A `lookup` update may omit `scope`; the normalizer derives it from the entity. */
  updates: Omit<Partial<BasicFormField>, 'key' | 'lookup'> & {
    lookup?: Pick<FieldLookupDescriptor, 'entity'> & Partial<FieldLookupDescriptor>;
  };
  updatedBy?: string | null;
}): Promise<ServiceRequestDefinitionManagementRow> {
  const schema = await getDefinitionFormSchema(input.knex, input.tenant, input.definitionId);
  const nextFields = schema.fields.map((field) =>
    field.key === input.fieldKey
      ? ({
          ...field,
          ...input.updates,
          key: field.key,
        } as BasicFormField)
      : field
  );

  return replaceBasicFormSchemaForDefinitionDraft({
    knex: input.knex,
    tenant: input.tenant,
    definitionId: input.definitionId,
    fields: nextFields,
    settings: schema.settings,
    updatedBy: input.updatedBy,
  });
}

export async function removeBasicFormFieldFromDefinitionDraft(input: {
  knex: Knex;
  tenant: string;
  definitionId: string;
  fieldKey: string;
  updatedBy?: string | null;
}): Promise<ServiceRequestDefinitionManagementRow> {
  const schema = await getDefinitionFormSchema(input.knex, input.tenant, input.definitionId);
  const nextFields = schema.fields.filter((field) => field.key !== input.fieldKey);

  return replaceBasicFormSchemaForDefinitionDraft({
    knex: input.knex,
    tenant: input.tenant,
    definitionId: input.definitionId,
    fields: nextFields,
    settings: schema.settings,
    updatedBy: input.updatedBy,
  });
}

export async function reorderBasicFormFieldsInDefinitionDraft(input: {
  knex: Knex;
  tenant: string;
  definitionId: string;
  orderedFieldKeys: string[];
  updatedBy?: string | null;
}): Promise<ServiceRequestDefinitionManagementRow> {
  const schema = await getDefinitionFormSchema(input.knex, input.tenant, input.definitionId);
  const byKey = new Map(schema.fields.map((field) => [field.key, field] as const));
  const reordered: BasicFormField[] = [];

  for (const key of input.orderedFieldKeys) {
    const field = byKey.get(key);
    if (field) {
      reordered.push(field);
      byKey.delete(key);
    }
  }

  for (const remainingField of byKey.values()) {
    reordered.push(remainingField);
  }

  return replaceBasicFormSchemaForDefinitionDraft({
    knex: input.knex,
    tenant: input.tenant,
    definitionId: input.definitionId,
    fields: reordered,
    settings: schema.settings,
    updatedBy: input.updatedBy,
  });
}
