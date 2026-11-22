import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { saveServiceRequestDefinitionDraft, type ServiceRequestDefinitionManagementRow } from './definitionManagement';

import { isSupportedBasicFormFieldType, type BasicFormFieldType } from './fieldTypes';

export type { BasicFormFieldType } from './fieldTypes';

export type BasicFormLookupEntity = 'contact' | 'user';
export type BasicFormLookupScope = 'requester-client' | 'tenant';

/**
 * Data descriptor for a `lookup` field: its option set is resolved from an entity table
 * (see lookupFields.ts), not authored. The answer stored in the payload is the entity id.
 */
export interface BasicFormFieldLookup {
  entity: BasicFormLookupEntity;
  /** Derived from the requester at submit/render time; never from client input. */
  scope: BasicFormLookupScope;
  /** Optional equality filters on the entity row; keys are checked against the adapter's allowlist. */
  filters?: Record<string, string | boolean>;
}

/**
 * Which scopes each entity may use. `contact` is requester-client only: a tenant-wide contact
 * universe would let the client portal read other clients' people. New adapters (asset, location)
 * add an entry here and in lookupFields.ts' adapter map.
 */
export const LOOKUP_ENTITY_SCOPES: Record<BasicFormLookupEntity, readonly BasicFormLookupScope[]> = {
  contact: ['requester-client'],
  user: ['tenant'],
};

/** Allowlisted filter columns per entity (equality, scalar values only). */
export const LOOKUP_ENTITY_FILTER_KEYS: Record<BasicFormLookupEntity, readonly string[]> = {
  contact: ['role', 'is_client_admin', 'work_arrangement'],
  user: [],
};

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
  /** Present only on `lookup` fields. */
  lookup?: BasicFormFieldLookup;
}

export interface BasicFormSchema {
  fields: BasicFormField[];
}

interface DraftFormSchemaRow {
  form_schema: Record<string, unknown> | null;
}

const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Keeps the author's descriptor as written (including unknown entities and non-scalar filters) so
 * validateBasicFormSchema can reject it; only a missing scope is defaulted, from the entity.
 */
function normalizeLookupDescriptor(raw: unknown): BasicFormFieldLookup | undefined {
  if (!isPlainObject(raw)) {
    return undefined;
  }
  const entity = raw.entity as BasicFormLookupEntity;
  const defaultScope = LOOKUP_ENTITY_SCOPES[entity]?.[0];
  const lookup: BasicFormFieldLookup = {
    entity,
    scope: (typeof raw.scope === 'string' ? raw.scope : defaultScope) as BasicFormLookupScope,
  };
  if (raw.filters !== undefined && raw.filters !== null) {
    lookup.filters = raw.filters as BasicFormFieldLookup['filters'];
  }
  return lookup;
}

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

    // An unrecognised type is kept verbatim: coercing it to 'short-text' here made the membership
    // check in validateBasicFormSchema unreachable and silently rewrote the author's schema on
    // re-save. validateBasicFormSchema rejects it; the cast is the one place the type is unproven.
    const rawType = (raw as any).type;
    const type = (typeof rawType === 'string' ? rawType : '') as BasicFormFieldType;

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

    if (type === 'lookup') {
      const lookup = normalizeLookupDescriptor((raw as any).lookup);
      if (lookup) {
        field.lookup = lookup;
      }
    }

    normalizedFields.push(field);
  }

  return { fields: normalizedFields };
}

export interface BasicFormSchemaValidationResult {
  isValid: boolean;
  errors: string[];
}

export function resolveStaticDefaultValues(
  schema: unknown
): Record<string, string | boolean | null> {
  const normalized = normalizeBasicFormSchema(schema);
  const initialValues: Record<string, string | boolean | null> = {};

  for (const field of normalized.fields) {
    if (field.defaultValue === undefined) {
      continue;
    }

    // Not defaultable: file uploads, lookups (option set is data), and types we do not recognise
    // (a legacy row keeps its raw type; it must not pick up string defaults as if it were text).
    if (field.type === 'file-upload' || field.type === 'lookup' || !isSupportedBasicFormFieldType(field.type)) {
      continue;
    }

    if (
      field.type === 'checkbox' &&
      (typeof field.defaultValue === 'boolean' || field.defaultValue === null)
    ) {
      initialValues[field.key] = field.defaultValue;
      continue;
    }

    if (
      field.type !== 'checkbox' &&
      (typeof field.defaultValue === 'string' || field.defaultValue === null)
    ) {
      initialValues[field.key] = field.defaultValue;
    }
  }

  return initialValues;
}

function validateLookupField(field: BasicFormField, errors: string[]): void {
  const ref = `Field "${field.key}"`;
  if (field.options && field.options.length > 0) {
    errors.push(`${ref} is a lookup and cannot have static options`);
  }
  if (field.defaultValue !== undefined && field.defaultValue !== null && field.defaultValue !== '') {
    errors.push(`${ref} is a lookup and cannot have a default value`);
  }

  const lookup = field.lookup;
  if (!lookup || typeof lookup.entity !== 'string' || !lookup.entity) {
    errors.push(`${ref} is a lookup and requires an entity`);
    return;
  }
  const allowedScopes = LOOKUP_ENTITY_SCOPES[lookup.entity];
  if (!allowedScopes) {
    errors.push(`${ref} has unsupported lookup entity "${String(lookup.entity)}"`);
    return;
  }
  if (!allowedScopes.includes(lookup.scope)) {
    errors.push(
      `${ref} cannot use scope "${String(lookup.scope)}" for entity "${lookup.entity}"`
    );
  }
  if (lookup.filters !== undefined) {
    if (!isPlainObject(lookup.filters)) {
      errors.push(`${ref} lookup filters must be an object`);
      return;
    }
    const allowedKeys = LOOKUP_ENTITY_FILTER_KEYS[lookup.entity];
    for (const [filterKey, filterValue] of Object.entries(lookup.filters)) {
      if (!allowedKeys.includes(filterKey)) {
        errors.push(`${ref} lookup filter "${filterKey}" is not supported for ${lookup.entity}`);
      } else if (typeof filterValue !== 'string' && typeof filterValue !== 'boolean') {
        errors.push(`${ref} lookup filter "${filterKey}" must be a string or boolean`);
      }
    }
  }
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

    if (!isSupportedBasicFormFieldType(field.type)) {
      errors.push(
        `${fieldRef} ("${field.label}") has unsupported type "${String(field.type)}"`
      );
    }
    if (!field.label?.trim()) {
      errors.push(`${fieldRef} is missing a label`);
    }

    if (field.type === 'lookup') {
      validateLookupField(field, errors);
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
  // A new lookup starts valid (first entity, its default scope) so the author only has to change it.
  const defaultEntity = Object.keys(LOOKUP_ENTITY_SCOPES)[0] as BasicFormLookupEntity;
  const nextField: BasicFormField = {
    key,
    type: input.field.type,
    label: input.field.label,
    helpText: input.field.helpText ?? null,
    required: Boolean(input.field.required),
    defaultValue: input.field.defaultValue,
    options: input.field.options,
    lookup:
      input.field.type === 'lookup'
        ? (input.field.lookup ?? {
            entity: defaultEntity,
            scope: LOOKUP_ENTITY_SCOPES[defaultEntity][0],
          })
        : undefined,
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
  /** A `lookup` update may omit `scope`; the normalizer derives it from the entity. */
  updates: Omit<Partial<BasicFormField>, 'key' | 'lookup'> & {
    lookup?: Pick<BasicFormFieldLookup, 'entity'> & Partial<BasicFormFieldLookup>;
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
          // An omitted lookup scope is derived from the entity by normalizeBasicFormSchema on save.
        } as BasicFormField)
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
