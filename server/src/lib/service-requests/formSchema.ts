import {
  getFieldElementKind,
  getFieldType,
  isUnsupportedFieldType,
  normalizeFieldValidationRules,
  type FieldElementKind,
  type FieldLookupDescriptor,
  type FieldTypeKey,
  type FieldValidationRules,
} from '@alga-psa/ui/form-fields';
import { formatCalendarDate, isCalendarDate, resolveLocale } from '@alga-psa/tickets/lib/titleTokens';
import {
  parseElementVisibilityRules,
  type ElementVisibilityRule,
} from './formVisibility';

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
  /** The answer the form opens with. A list for `multi-select`, a boolean for `checkbox`. */
  defaultValue?: string | boolean | string[] | null;
  options?: BasicFormFieldOption[];
  /** Present only on `lookup` elements: where the choices come from. The answer is the entity id. */
  lookup?: FieldLookupDescriptor;
  placeholder?: string | null;
  validation?: BasicFormFieldValidation;
  layout?: BasicFormElementLayout;
  /** Display-block settings; absent on inputs. */
  display?: BasicFormCalloutDisplay & BasicFormSectionDisplay;
  /**
   * Conditions that must all hold for this element to be shown. A display block can be hidden
   * like any other element — hiding a `section` hides the questions it owns — but it holds no
   * answer, so it is never a rule *source*.
   */
  visibleWhen?: ElementVisibilityRule[];
  /** Phase 2: where a choice field's options come from. Carried through, never written here. */
  optionSource?: Record<string, unknown>;
  /** Later phase: the record field an answer lands in. Carried through, never written here. */
  binding?: Record<string, unknown>;
}

/** v2 name. A "field" and an "element" are the same row; display blocks are elements too. */
export type BasicFormElement = BasicFormField;

/**
 * How wide the form is allowed to grow. `boxed` is the default and keeps the measure a form
 * has always had; the others let the author decide, because a three-question request and a
 * twenty-question one want different room.
 */
export type BasicFormWidth = 'narrow' | 'boxed' | 'wide' | 'full';

/** The measure each choice renders at, in px, so the author can be told what they picked. */
export const BASIC_FORM_WIDTH_PX: Record<Exclude<BasicFormWidth, 'full'>, number> = {
  narrow: 448,
  boxed: 672,
  wide: 896,
};

const BASIC_FORM_WIDTH_CLASS: Record<BasicFormWidth, string> = {
  narrow: 'mx-auto w-full max-w-md',
  boxed: 'mx-auto w-full max-w-2xl',
  wide: 'mx-auto w-full max-w-4xl',
  full: 'w-full',
};

export function isBasicFormWidth(value: unknown): value is BasicFormWidth {
  return value === 'narrow' || value === 'boxed' || value === 'wide' || value === 'full';
}

/**
 * The container classes for a form's chosen measure. The renderer and the portal page around
 * it both read this, so the page never leaves a narrow form adrift in a wide card.
 */
export function getBasicFormWidthClass(settings: BasicFormSettings | undefined): string {
  const width = settings?.layout?.width;
  return BASIC_FORM_WIDTH_CLASS[isBasicFormWidth(width) ? width : 'boxed'];
}

export interface BasicFormLayoutSettings {
  /** `boxed` (default) keeps a readable measure; `full` lets the form use the page width. */
  width?: BasicFormWidth;
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
    if (isBasicFormWidth(width)) {
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

    // An unrecognised type is kept as written. Coercing it to 'short-text' made the unsupported-type
    // check in validateBasicFormSchema unreachable and silently rewrote the author's schema on
    // re-save. validateBasicFormSchema rejects it; the cast is the one place the type is unproven.
    const rawType = (raw as any).type;
    const type = (typeof rawType === 'string' ? rawType : '') as BasicFormFieldType;
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
      const rawDefault = (raw as any).defaultValue;
      field.defaultValue = Array.isArray(rawDefault)
        ? rawDefault.filter((entry: unknown): entry is string => typeof entry === 'string')
        : (rawDefault as string | boolean | null);
    }
    if (Array.isArray((raw as any).options)) {
      field.options = (raw as any).options
        .map((option: any) => ({
          label: typeof option?.label === 'string' ? option.label : '',
          value: typeof option?.value === 'string' ? option.value : '',
        }))
        .filter((option: BasicFormFieldOption) => option.label && option.value);
    }

    Object.assign(field, definition?.readDescriptor?.(raw as Record<string, unknown>));

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

    const visibleWhen = parseElementVisibilityRules((raw as any).visibleWhen);
    if (visibleWhen.length > 0) {
      field.visibleWhen = visibleWhen;
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

/** The shape every answer-display caller can describe an element with. */
export interface FormAnswerField {
  key?: unknown;
  type?: unknown;
  options?: ReadonlyArray<{ label?: unknown; value?: unknown }> | unknown;
}

export interface FormAnswerDisplayFormat {
  /** BCP-47 locale. Given, a date answer reads as a calendar date; omitted, it stays raw. */
  locale?: string;
  /** Wording for a checked / unchecked checkbox. */
  yes?: string;
  no?: string;
  /** Stand-in for an element that carries no answer. */
  empty?: string;
  /**
   * Display labels for reference answers (lookups), keyed by field key, resolved by the server
   * for the requester. The stored answer is an id and is never shown.
   */
  referenceLabels?: Record<string, string>;
  /** Stand-in for a reference answer whose record no longer resolves. Falls back to `empty`. */
  unresolved?: string;
}

function readAnswerOptions(field: FormAnswerField | undefined) {
  return Array.isArray(field?.options)
    ? (field.options as Array<{ label?: unknown; value?: unknown }>)
        .map((option) => ({
          value: typeof option?.value === 'string' ? option.value : String(option?.value ?? ''),
          label:
            typeof option?.label === 'string' && option.label.trim()
              ? option.label
              : String(option?.value ?? ''),
        }))
        .filter((option) => option.value.length > 0)
    : undefined;
}

/**
 * Whether an element has no answer to show. The registry decides per type, so an unchecked
 * checkbox counts as an answer and an empty multi-select array does not.
 */
export function isFormAnswerMissing(field: FormAnswerField | undefined, value: unknown): boolean {
  const definition = getFieldType(field?.type);
  if (definition) {
    return definition.kind === 'display' || definition.isEmpty(value);
  }
  if (Array.isArray(value)) return value.length === 0;
  return value === null || value === undefined || value === '';
}

/**
 * A date answer in the reader's language, or `null` when the stored text is not a date at all
 * and the caller should fall back to showing it verbatim.
 *
 * Two shapes reach this. A `date` field stores `YYYY-MM-DD`, which is read as floating UTC
 * midnight so the server's zone never shifts the day. A `date-time` field stores the instant
 * the picker produced (`Date.toISOString()`), which is not `YYYY-MM-DD` and so must not go
 * through the calendar path; it is shown in UTC with the zone named, because nothing on the
 * server path knows the reader's zone and a silent server-local time would be a lie.
 */
function formatDateAnswer(raw: string, locale: string): string | null {
  if (isCalendarDate(raw)) {
    try {
      return formatCalendarDate(raw, locale, { dateStyle: 'long' });
    } catch {
      return null;
    }
  }
  const instant = new Date(raw);
  if (Number.isNaN(instant.getTime())) {
    return null;
  }
  try {
    // Spelled out rather than `dateStyle`/`timeStyle`, which ECMA-402 forbids pairing with
    // `timeZoneName` — and the zone has to be named for a UTC rendering to be honest.
    return new Intl.DateTimeFormat(resolveLocale(locale), {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'UTC',
      timeZoneName: 'short',
    }).format(instant);
  } catch {
    return null;
  }
}

/**
 * The one place that turns a stored answer into text. The ticket subject template, the ticket
 * description and the portal submission detail page all read it, so a new field type renders
 * the same way in all three without touching any of them.
 */
export function describeFormAnswer(
  field: FormAnswerField | undefined,
  value: unknown,
  format: FormAnswerDisplayFormat = {}
): string {
  const empty = format.empty ?? '';
  const definition = getFieldType(field?.type);

  if (definition?.kind === 'display') {
    return empty;
  }

  // A checkbox always has an answer: an unchecked box reads "No", never blank.
  if (definition?.key === 'checkbox') {
    return definition.coerce(value) === true ? (format.yes ?? 'Yes') : (format.no ?? 'No');
  }

  if (isFormAnswerMissing(field, value)) {
    return empty;
  }

  // A reference answer is an opaque id: only the label the server resolved is readable.
  if (definition?.valueIsReference) {
    const key = typeof field?.key === 'string' ? field.key : '';
    return format.referenceLabels?.[key]?.trim() || (format.unresolved ?? empty);
  }

  if ((definition?.key === 'date' || definition?.key === 'date-time') && format.locale) {
    const formatted = formatDateAnswer(String(value).trim(), format.locale);
    if (formatted) {
      return formatted;
    }
  }

  if (definition) {
    // Trimmed: surrounding space in a typed answer is noise in a subject, a table cell or a
    // detail row, and `format` deliberately preserves what the requester typed.
    const formatted = definition.format(value, readAnswerOptions(field)).trim();
    if (formatted) {
      return formatted;
    }
  }

  // No registry entry (an older or unknown type): the raw value, as the callers always showed it.
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value).trim();
}

export interface BasicFormSchemaValidationResult {
  isValid: boolean;
  errors: string[];
}

/** The values a form opens with, by the shape each type stores. */
export type ServiceRequestInitialValues = Record<string, string | boolean | string[] | null>;

export function resolveStaticDefaultValues(schema: unknown): ServiceRequestInitialValues {
  const normalized = normalizeBasicFormSchema(schema);
  const initialValues: ServiceRequestInitialValues = {};

  for (const field of normalized.fields) {
    if (field.defaultValue === undefined) {
      continue;
    }

    // Display blocks, uploads, lookups (their choices are data) and unsupported types never seed
    // a value; an unsupported type must not pick up a string default as if it were text.
    if (
      field.type === 'file-upload' ||
      isDisplayElement(field) ||
      getFieldType(field.type)?.valueIsReference ||
      isUnsupportedFieldType(field.type)
    ) {
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
      field.type === 'multi-select' &&
      (Array.isArray(field.defaultValue) || field.defaultValue === null)
    ) {
      initialValues[field.key] = field.defaultValue;
      continue;
    }

    if (
      field.type !== 'checkbox' &&
      field.type !== 'multi-select' &&
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
  // A rule may only read an answer decided before it — see the evaluator's single-pass order.
  const answerKeysSoFar = new Set<string>();

  normalized.fields.forEach((field, index) => {
    const fieldRef = `Field #${index + 1}`;

    if (!FIELD_KEY_PATTERN.test(field.key)) {
      errors.push(`${fieldRef} has invalid key "${field.key}"`);
    }
    if (seenKeys.has(field.key)) {
      errors.push(`Duplicate field key: ${field.key}`);
    }
    seenKeys.add(field.key);

    if (!getFieldType(field.type)) {
      // Named by label as well as position: the author finds the question, not a number.
      errors.push(`${fieldRef} ("${field.label}") has unsupported type "${String(field.type)}"`);
    }
    // A divider has nothing to say, so it needs no label.
    if (!field.label?.trim() && field.type !== 'divider') {
      errors.push(`${fieldRef} is missing a label`);
    }

    for (const problem of getFieldType(field.type)?.validateElement?.(field as unknown as Record<string, unknown>) ?? []) {
      errors.push(`Field "${field.key}" ${problem}`);
    }

    const defaultValue = field.defaultValue;
    if (defaultValue !== undefined && defaultValue !== null) {
      if (field.type === 'checkbox' && typeof defaultValue !== 'boolean') {
        errors.push(`Field "${field.key}" defaultValue must be boolean for checkbox`);
      }
      if (field.type === 'multi-select' && !Array.isArray(defaultValue)) {
        errors.push(`Field "${field.key}" defaultValue must be a list for multi-select`);
      }
      if (
        field.type !== 'checkbox' &&
        field.type !== 'multi-select' &&
        typeof defaultValue !== 'string'
      ) {
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
      // A default answer has to be one the requester could have picked.
      const defaultChoices = Array.isArray(defaultValue)
        ? defaultValue
        : typeof defaultValue === 'string' && defaultValue
          ? [defaultValue]
          : [];
      if (defaultChoices.some((choice) => !optionValues.has(choice))) {
        errors.push(`Field "${field.key}" defaultValue must match an option value`);
      }
    }

    for (const rule of field.visibleWhen ?? []) {
      if (
        (rule.operator === 'equals' || rule.operator === 'not-equals') &&
        rule.value === undefined
      ) {
        errors.push(`Field "${field.key}" has a condition on "${rule.source}" with no value`);
      }
      const isContextSource =
        rule.source.startsWith('context.') || rule.source.startsWith('payload.');
      if (!isContextSource && !answerKeysSoFar.has(rule.source)) {
        errors.push(
          `Field "${field.key}" has a condition on "${rule.source}", which is not an answer above it`
        );
      }
    }

    if (isInputElement(field)) {
      answerKeysSoFar.add(field.key);
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
  };
}
