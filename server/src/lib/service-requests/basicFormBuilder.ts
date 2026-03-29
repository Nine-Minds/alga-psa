import type { Knex } from 'knex';
import { saveServiceRequestDefinitionDraft, type ServiceRequestDefinitionManagementRow } from './definitionManagement';

export type BasicFormFieldType =
  | 'short-text'
  | 'long-text'
  | 'select'
  | 'checkbox'
  | 'date'
  | 'file-upload';

export interface BasicFormFieldOption {
  label: string;
  value: string;
}

export interface BasicFormField {
  key: string;
  type: BasicFormFieldType;
  label: string;
  helpText?: string | null;
  required?: boolean;
  defaultValue?: string | boolean | null;
  options?: BasicFormFieldOption[];
}

export interface BasicFormSchema {
  fields: BasicFormField[];
}

interface DraftFormSchemaRow {
  form_schema: Record<string, unknown> | null;
}

const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const SUPPORTED_FIELD_TYPES = new Set<BasicFormFieldType>([
  'short-text',
  'long-text',
  'select',
  'checkbox',
  'date',
  'file-upload',
]);

function slugifyFieldKey(source: string): string {
  const normalized = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'field';
}

function withUniqueFieldKey(base: string, existingKeys: Set<string>): string {
  if (!existingKeys.has(base)) {
    return base;
  }

  let suffix = 2;
  while (existingKeys.has(`${base}_${suffix}`)) {
    suffix += 1;
  }
  return `${base}_${suffix}`;
}

export function normalizeBasicFormSchema(schema: unknown): BasicFormSchema {
  if (!schema || typeof schema !== 'object' || !Array.isArray((schema as any).fields)) {
    return { fields: [] };
  }

  const rawFields = (schema as any).fields as unknown[];
  const normalizedFields: BasicFormField[] = [];
  const seenKeys = new Set<string>();

  for (const raw of rawFields) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }

    const rawKey = typeof (raw as any).key === 'string' ? (raw as any).key.trim() : '';
    const fallbackLabel = typeof (raw as any).label === 'string' ? (raw as any).label : 'field';
    const nextKey = rawKey
      ? rawKey
      : withUniqueFieldKey(slugifyFieldKey(fallbackLabel), seenKeys);
    seenKeys.add(nextKey);

    const rawType = (raw as any).type;
    const type: BasicFormFieldType = SUPPORTED_FIELD_TYPES.has(rawType)
      ? (rawType as BasicFormFieldType)
      : 'short-text';

    const label = typeof (raw as any).label === 'string' && (raw as any).label.trim()
      ? (raw as any).label.trim()
      : nextKey;

    const field: BasicFormField = {
      key: nextKey,
      type,
      label,
      helpText: typeof (raw as any).helpText === 'string' ? (raw as any).helpText : null,
      required: Boolean((raw as any).required),
    };

    if ((raw as any).defaultValue !== undefined) {
      field.defaultValue = (raw as any).defaultValue as string | boolean | null;
    }
    if (Array.isArray((raw as any).options)) {
      field.options = (raw as any).options
        .map((option: any) => ({
          label: typeof option?.label === 'string' ? option.label : '',
          value: typeof option?.value === 'string' ? option.value : '',
        }))
        .filter((option: BasicFormFieldOption) => option.label && option.value);
    }

    normalizedFields.push(field);
  }

  return { fields: normalizedFields };
}

export interface BasicFormSchemaValidationResult {
  isValid: boolean;
  errors: string[];
}

export function validateBasicFormSchema(schema: unknown): BasicFormSchemaValidationResult {
  const normalized = normalizeBasicFormSchema(schema);
  const errors: string[] = [];
  const seenKeys = new Set<string>();

  normalized.fields.forEach((field, index) => {
    const fieldRef = `Field #${index + 1}`;

    if (!FIELD_KEY_PATTERN.test(field.key)) {
      errors.push(`${fieldRef} has invalid key "${field.key}"`);
    }
    if (seenKeys.has(field.key)) {
      errors.push(`Duplicate field key: ${field.key}`);
    }
    seenKeys.add(field.key);

    if (!SUPPORTED_FIELD_TYPES.has(field.type)) {
      errors.push(`${fieldRef} has unsupported type "${String(field.type)}"`);
    }
    if (!field.label?.trim()) {
      errors.push(`${fieldRef} is missing a label`);
    }

    const defaultValue = field.defaultValue;
    if (defaultValue !== undefined && defaultValue !== null) {
      if (field.type === 'checkbox' && typeof defaultValue !== 'boolean') {
        errors.push(`Field "${field.key}" defaultValue must be boolean for checkbox`);
      }
      if (field.type !== 'checkbox' && typeof defaultValue !== 'string') {
        errors.push(`Field "${field.key}" defaultValue must be string for ${field.type}`);
      }
      if (field.type === 'file-upload') {
        errors.push(`Field "${field.key}" does not support a static default value`);
      }
    }

    if (field.type === 'select') {
      if (!field.options || field.options.length === 0) {
        errors.push(`Field "${field.key}" must include at least one option`);
      }
      const optionValues = new Set<string>();
      for (const option of field.options ?? []) {
        if (!option.label.trim() || !option.value.trim()) {
          errors.push(`Field "${field.key}" has an option with missing label/value`);
          continue;
        }
        if (optionValues.has(option.value)) {
          errors.push(`Field "${field.key}" has duplicate option value "${option.value}"`);
        }
        optionValues.add(option.value);
      }
      if (
        typeof defaultValue === 'string' &&
        defaultValue &&
        !optionValues.has(defaultValue)
      ) {
        errors.push(`Field "${field.key}" defaultValue must match an option value`);
      }
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
  };
}

async function getDefinitionFormSchema(
  knex: Knex,
  tenant: string,
  definitionId: string
): Promise<BasicFormSchema> {
  const row = (await knex('service_request_definitions')
    .where({
      tenant,
      definition_id: definitionId,
    })
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
  updatedBy?: string | null;
}): Promise<ServiceRequestDefinitionManagementRow> {
  const normalized = normalizeBasicFormSchema({ fields: input.fields });
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
    key,
    type: input.field.type,
    label: input.field.label,
    helpText: input.field.helpText ?? null,
    required: Boolean(input.field.required),
    defaultValue: input.field.defaultValue,
    options: input.field.options,
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
    updatedBy: input.updatedBy,
  });
}

export async function updateBasicFormFieldInDefinitionDraft(input: {
  knex: Knex;
  tenant: string;
  definitionId: string;
  fieldKey: string;
  updates: Omit<Partial<BasicFormField>, 'key'>;
  updatedBy?: string | null;
}): Promise<ServiceRequestDefinitionManagementRow> {
  const schema = await getDefinitionFormSchema(input.knex, input.tenant, input.definitionId);
  const nextFields = schema.fields.map((field) =>
    field.key === input.fieldKey
      ? {
          ...field,
          ...input.updates,
          key: field.key,
        }
      : field
  );

  return replaceBasicFormSchemaForDefinitionDraft({
    knex: input.knex,
    tenant: input.tenant,
    definitionId: input.definitionId,
    fields: nextFields,
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
    updatedBy: input.updatedBy,
  });
}
