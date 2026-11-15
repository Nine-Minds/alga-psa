import {
  FIELD_TYPE_REGISTRY,
  getFieldElementKind,
  getFieldType,
  normalizeFieldValidationRules,
  type FieldElementKind,
  type FieldTypeKey,
  type FieldValidationRules,
} from '@alga-psa/ui/form-fields';

/**
 * Schema v2, backward compatible. Pure: no database, no server-only import, so the portal form,
 * the renderer and the builder can all read it from a client component.
 * `basicFormBuilder.ts` re-exports everything here and adds the draft-persistence functions.
 *
 * The array is still `fields`, and a v1 element (`{ key, type, label, helpText, required,
 * defaultValue, options }`) still normalizes to exactly itself, so published snapshots keep
 * rendering unchanged. What is new:
 *
 * - Display blocks (`section`, `text`, `callout`, `divider`) sit in the same array and carry no
 *   answer. `@alga-psa/ui/form-fields` is the one table that says which kind a type is.
 * - A field's *definition* (type, options, validation) stays at the top level; its *placement*
 *   (width now, container later) lives under `layout`, and its position is the array order.
 *   A section block opens a section and everything after it belongs to that section until the
 *   next one — see `groupFormElementsBySection`.
 * - `optionSource` and `binding` are carried through untouched. Nothing in phase 1 writes them;
 *   phase 2 (options from the client's own data) and the later "answer lands in a custom field"
 *   work fill them in without a schema rewrite.
 */

/** Legacy alias: the v1 name for an element's type. */
export type BasicFormFieldType = FieldTypeKey;
export type BasicFormElementType = FieldTypeKey;

export interface BasicFormFieldOption {
  label: string;
  value: string;
}

export type BasicFormFieldWidth = 'full' | 'half';

export interface BasicFormElementLayout {
  /** `half` pairs with the next half-width field in a two-column row. */
  width?: BasicFormFieldWidth;
}

export type BasicFormFieldValidation = FieldValidationRules;

export interface BasicFormCalloutDisplay {
  tone?: 'info' | 'warning' | 'success';
}

export interface BasicFormSectionDisplay {
  collapsible?: boolean;
}

export interface BasicFormField {
  key: string;
  type: BasicFormFieldType;
  label: string;
  helpText?: string | null;
  required?: boolean;
  defaultValue?: string | boolean | null;
  options?: BasicFormFieldOption[];
  placeholder?: string | null;
  validation?: BasicFormFieldValidation;
  layout?: BasicFormElementLayout;
  /** Display-block settings; absent on inputs. */
  display?: BasicFormCalloutDisplay & BasicFormSectionDisplay;
  /** Phase 2: where a choice field's options come from. Carried through, never written here. */
  optionSource?: Record<string, unknown>;
  /** Later phase: the record field an answer lands in. Carried through, never written here. */
  binding?: Record<string, unknown>;
}

/** v2 name. A "field" and an "element" are the same row; display blocks are elements too. */
export type BasicFormElement = BasicFormField;

export interface BasicFormLayoutSettings {
  /** `boxed` (default) keeps a readable measure; `full` lets the form use the page width. */
  width?: 'boxed' | 'full';
}

export interface BasicFormSettings {
  layout?: BasicFormLayoutSettings;
  submitLabel?: string | null;
  successMessage?: string | null;
}

export interface BasicFormSchema {
  fields: BasicFormField[];
  settings?: BasicFormSettings;
}

const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const SUPPORTED_FIELD_TYPES = new Set<BasicFormFieldType>(
  Object.keys(FIELD_TYPE_REGISTRY) as FieldTypeKey[]
);

/** Element kinds, re-exported so service-request consumers read one table. */
export { getFieldElementKind, type FieldElementKind };

export function isDisplayElement(element: Pick<BasicFormField, 'type'>): boolean {
  return getFieldElementKind(element.type) === 'display';
}

export function isInputElement(element: Pick<BasicFormField, 'type'>): boolean {
  return getFieldElementKind(element.type) === 'input';
}

/** The answer-carrying elements of a schema, in form order. */
export function getFormInputFields<T extends { type?: unknown }>(fields: readonly T[]): T[] {
  return fields.filter((field) => getFieldElementKind(field?.type) === 'input');
}

export interface FormElementSectionGroup<T> {
  /** The section block that opens the group, or null for elements before the first section. */
  section: T | null;
  elements: T[];
}

/**
 * Elements grouped by the section block that precedes them. Used by the renderer, the ticket
 * description and the request detail page so one rule decides what belongs where.
 */
export function groupFormElementsBySection<T extends { type?: unknown }>(
  fields: readonly T[]
): Array<FormElementSectionGroup<T>> {
  const groups: Array<FormElementSectionGroup<T>> = [];
  let current: FormElementSectionGroup<T> = { section: null, elements: [] };

  for (const field of fields) {
    if (field?.type === 'section') {
      if (current.section !== null || current.elements.length > 0) {
        groups.push(current);
      }
      current = { section: field, elements: [] };
      continue;
    }
    current.elements.push(field);
  }

  if (current.section !== null || current.elements.length > 0) {
    groups.push(current);
  }
  return groups;
}

export function slugifyFieldKey(source: string): string {
  const normalized = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'field';
}

export function withUniqueFieldKey(base: string, existingKeys: Set<string>): string {
  if (!existingKeys.has(base)) {
    return base;
  }

  let suffix = 2;
  while (existingKeys.has(`${base}_${suffix}`)) {
    suffix += 1;
  }
  return `${base}_${suffix}`;
}

function normalizeFormSettings(raw: unknown): BasicFormSettings | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const source = raw as Record<string, unknown>;
  const settings: BasicFormSettings = {};

  const layout = source.layout;
  if (layout && typeof layout === 'object' && !Array.isArray(layout)) {
    const width = (layout as Record<string, unknown>).width;
    if (width === 'full' || width === 'boxed') {
      settings.layout = { width };
    }
  }
  if (typeof source.submitLabel === 'string' && source.submitLabel.trim().length > 0) {
    settings.submitLabel = source.submitLabel.trim();
  }
  if (typeof source.successMessage === 'string' && source.successMessage.trim().length > 0) {
    settings.successMessage = source.successMessage.trim();
  }

  return Object.keys(settings).length > 0 ? settings : undefined;
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
    const definition = getFieldType(type);
    const isDisplay = definition?.kind === 'display';

    const label = typeof (raw as any).label === 'string' && (raw as any).label.trim()
      ? (raw as any).label.trim()
      : nextKey;

    const field: BasicFormField = {
      key: nextKey,
      type,
      label,
      helpText: typeof (raw as any).helpText === 'string' ? (raw as any).helpText : null,
      // A display block carries no answer, so it is never required.
      required: isDisplay ? false : Boolean((raw as any).required),
    };

    if (!isDisplay && (raw as any).defaultValue !== undefined) {
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

    if (definition?.supportsPlaceholder) {
      const placeholder = (raw as any).placeholder;
      if (typeof placeholder === 'string' && placeholder.trim().length > 0) {
        field.placeholder = placeholder.trim();
      }
    }

    const validation = normalizeFieldValidationRules(type, (raw as any).validation);
    if (validation) {
      field.validation = validation;
    }

    const rawLayout = (raw as any).layout;
    if (rawLayout && typeof rawLayout === 'object' && !Array.isArray(rawLayout)) {
      const width = (rawLayout as Record<string, unknown>).width;
      // Only a sized input can share a row; display blocks always span the form.
      if (!isDisplay && width === 'half') {
        field.layout = { width: 'half' };
      }
    }

    if (type === 'callout' || type === 'section') {
      const rawDisplay = (raw as any).display;
      const display: BasicFormField['display'] = {};
      if (rawDisplay && typeof rawDisplay === 'object' && !Array.isArray(rawDisplay)) {
        const tone = (rawDisplay as Record<string, unknown>).tone;
        if (type === 'callout' && (tone === 'info' || tone === 'warning' || tone === 'success')) {
          display.tone = tone;
        }
        if (type === 'section' && (rawDisplay as Record<string, unknown>).collapsible === true) {
          display.collapsible = true;
        }
      }
      if (Object.keys(display).length > 0) {
        field.display = display;
      }
    }

    // Phase 2 / later extension points: preserved verbatim, never interpreted here.
    const optionSource = (raw as any).optionSource;
    if (optionSource && typeof optionSource === 'object' && !Array.isArray(optionSource)) {
      field.optionSource = optionSource as Record<string, unknown>;
    }
    const binding = (raw as any).binding;
    if (binding && typeof binding === 'object' && !Array.isArray(binding)) {
      field.binding = binding as Record<string, unknown>;
    }

    normalizedFields.push(field);
  }

  const settings = normalizeFormSettings((schema as any).settings);
  return settings ? { fields: normalizedFields, settings } : { fields: normalizedFields };
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

    // Display blocks and uploads never seed a value.
    if (field.type === 'file-upload' || isDisplayElement(field)) {
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
    // A divider has nothing to say, so it needs no label.
    if (!field.label?.trim() && field.type !== 'divider') {
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

    if (field.validation?.pattern) {
      try {
        new RegExp(field.validation.pattern);
      } catch {
        errors.push(`Field "${field.key}" has an invalid pattern`);
      }
    }

    if (getFieldType(field.type)?.supportsOptions) {
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
