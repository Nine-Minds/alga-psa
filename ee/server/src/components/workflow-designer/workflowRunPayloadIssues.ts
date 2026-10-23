import type {
  WorkflowPayloadIssue,
  WorkflowPayloadValidationFailure,
} from '@alga-psa/workflows/authoring';

/**
 * The Run dialog's payload checks, in the same terms as the server's (see
 * ee/packages/workflows/src/authoring/payloadIssues.ts): which field, and what is wrong with it.
 * The JSON schema checked here is generated from the same zod schema the server validates with,
 * so a payload that passes here passes there for the rules both know (required fields, types,
 * formats, choices, limits).
 */

export type RunPayloadJsonSchema = {
  type?: string | string[];
  title?: string;
  properties?: Record<string, RunPayloadJsonSchema>;
  required?: string[];
  enum?: Array<string | number | boolean | null>;
  items?: RunPayloadJsonSchema;
  additionalProperties?: boolean | RunPayloadJsonSchema;
  anyOf?: RunPayloadJsonSchema[];
  oneOf?: RunPayloadJsonSchema[];
  format?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number | boolean;
  exclusiveMaximum?: number | boolean;
  minItems?: number;
  maxItems?: number;
  $ref?: string;
};

/** Follows a local `#/...` reference; anything else is returned as is. */
export const resolveRunPayloadSchemaRef = <T extends { $ref?: string }>(schema: T, root: unknown): T => {
  if (!schema.$ref?.startsWith('#/')) return schema;
  let current: unknown = root;
  for (const segment of schema.$ref.slice(2).split('/').filter(Boolean)) {
    if (!current || typeof current !== 'object') return schema;
    current = (current as Record<string, unknown>)[segment.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return current && typeof current === 'object' ? (current as T) : schema;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

const FORMAT_CHECKS: Record<string, (value: string) => boolean> = {
  uuid: (value) => UUID_PATTERN.test(value),
  email: (value) => EMAIL_PATTERN.test(value),
  date: (value) => DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(value)),
  'date-time': (value) => DATE_TIME_PATTERN.test(value) && !Number.isNaN(Date.parse(value)),
  uri: (value) => { try { return Boolean(new URL(value)); } catch { return false; } },
  url: (value) => { try { return Boolean(new URL(value)); } catch { return false; } },
};

const schemaTypes = (schema: RunPayloadJsonSchema): string[] =>
  Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];

const allowsNull = (schema: RunPayloadJsonSchema, root: unknown): boolean => {
  const resolved = resolveRunPayloadSchemaRef(schema, root);
  if (schemaTypes(resolved).includes('null')) return true;
  return [...(resolved.anyOf ?? []), ...(resolved.oneOf ?? [])]
    .some((variant) => schemaTypes(resolveRunPayloadSchemaRef(variant, root)).includes('null'));
};

/** The non-null alternative of a nullable/union schema, which is what the form edits. */
const concreteSchema = (schema: RunPayloadJsonSchema, root: unknown): RunPayloadJsonSchema => {
  const resolved = resolveRunPayloadSchemaRef(schema, root);
  const variants = resolved.anyOf ?? resolved.oneOf;
  if (!variants?.length) return resolved;
  const variant = variants
    .map((candidate) => resolveRunPayloadSchemaRef(candidate, root))
    .find((candidate) => schemaTypes(candidate).some((type) => type !== 'null'));
  return variant ? concreteSchema(variant, root) : resolved;
};

const isEmptyValue = (value: unknown): boolean => value === undefined || value === null || value === '';

/**
 * Leaves out optional fields the person left empty (blank text, or no value), at any depth, so an
 * empty optional id or date isn't sent as "" and rejected. Required fields are kept as they are,
 * so a missing required value is still reported.
 */
export const pruneEmptyOptionalRunPayloadFields = (
  schema: RunPayloadJsonSchema,
  value: Record<string, unknown>,
  root: unknown = schema
): Record<string, unknown> => {
  const resolved = concreteSchema(schema, root);
  const required = new Set(resolved.required ?? []);
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const childSchema = resolved.properties?.[key];
    if (!required.has(key) && isEmptyValue(child) && !(child === null && childSchema && allowsNull(childSchema, root))) {
      continue;
    }
    next[key] = childSchema && child && typeof child === 'object' && !Array.isArray(child)
      ? pruneEmptyOptionalRunPayloadFields(childSchema, child as Record<string, unknown>, root)
      : child;
  }
  return next;
};

/** Every problem with `value` against the payload schema, one per field. */
export const validateRunPayloadAgainstSchema = (
  schema: RunPayloadJsonSchema,
  value: unknown,
  root: unknown = schema,
  path: Array<string | number> = []
): WorkflowPayloadIssue[] => {
  if (value === null && allowsNull(schema, root)) return [];
  const resolved = concreteSchema(schema, root);
  const type = schemaTypes(resolved).find((candidate) => candidate !== 'null');
  const issues: WorkflowPayloadIssue[] = [];

  if (resolved.enum && value != null && !resolved.enum.includes(value as never)) {
    return [{ path, kind: 'choice', options: resolved.enum.filter((option) => option !== null).map(String) }];
  }

  if (type === 'object') {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
      return [{ path, kind: 'type', expected: 'object' }];
    }
    const objectValue = value as Record<string, unknown>;
    const properties = resolved.properties ?? {};
    for (const key of resolved.required ?? []) {
      if (isEmptyValue(objectValue[key])) issues.push({ path: [...path, key], kind: 'required' });
    }
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (objectValue[key] === undefined) continue;
      if (isEmptyValue(objectValue[key]) && (resolved.required ?? []).includes(key)) continue;
      issues.push(...validateRunPayloadAgainstSchema(propertySchema, objectValue[key], root, [...path, key]));
    }
    for (const [key, extra] of Object.entries(objectValue)) {
      if (key in properties) continue;
      if (resolved.additionalProperties === false) {
        issues.push({ path: [...path, key], kind: 'unknown_field' });
      } else if (resolved.additionalProperties && typeof resolved.additionalProperties === 'object') {
        issues.push(...validateRunPayloadAgainstSchema(resolved.additionalProperties, extra, root, [...path, key]));
      }
    }
    return issues;
  }

  if (type === 'array') {
    if (!Array.isArray(value)) return [{ path, kind: 'type', expected: 'array' }];
    if (resolved.minItems !== undefined && value.length < resolved.minItems) {
      issues.push({ path, kind: 'too_small', limit: resolved.minItems, sizeOf: 'array' });
    }
    if (resolved.maxItems !== undefined && value.length > resolved.maxItems) {
      issues.push({ path, kind: 'too_big', limit: resolved.maxItems, sizeOf: 'array' });
    }
    value.forEach((item, index) => {
      issues.push(...validateRunPayloadAgainstSchema(resolved.items ?? {}, item, root, [...path, index]));
    });
    return issues;
  }

  if (value == null) return issues;

  if (type === 'string') {
    if (typeof value !== 'string') return [{ path, kind: 'type', expected: 'string' }];
    const check = resolved.format ? FORMAT_CHECKS[resolved.format] : undefined;
    if (check && !check(value)) return [{ path, kind: 'format', format: resolved.format === 'uri' ? 'url' : resolved.format }];
    if (resolved.minLength !== undefined && value.length < resolved.minLength) {
      return [resolved.minLength === 1 ? { path, kind: 'required' } : { path, kind: 'too_small', limit: resolved.minLength, sizeOf: 'string' }];
    }
    if (resolved.maxLength !== undefined && value.length > resolved.maxLength) {
      return [{ path, kind: 'too_big', limit: resolved.maxLength, sizeOf: 'string' }];
    }
    return issues;
  }

  if (type === 'number' || type === 'integer') {
    if (typeof value !== 'number' || Number.isNaN(value)) return [{ path, kind: 'type', expected: 'number' }];
    if (type === 'integer' && !Number.isInteger(value)) return [{ path, kind: 'type', expected: 'integer' }];
    const minimum = typeof resolved.exclusiveMinimum === 'number' ? resolved.exclusiveMinimum : resolved.minimum;
    const maximum = typeof resolved.exclusiveMaximum === 'number' ? resolved.exclusiveMaximum : resolved.maximum;
    const exclusiveMin = typeof resolved.exclusiveMinimum === 'number' || resolved.exclusiveMinimum === true;
    const exclusiveMax = typeof resolved.exclusiveMaximum === 'number' || resolved.exclusiveMaximum === true;
    if (minimum !== undefined && (exclusiveMin ? value <= minimum : value < minimum)) {
      return [{ path, kind: 'too_small', limit: minimum, sizeOf: 'number' }];
    }
    if (maximum !== undefined && (exclusiveMax ? value >= maximum : value > maximum)) {
      return [{ path, kind: 'too_big', limit: maximum, sizeOf: 'number' }];
    }
    return issues;
  }

  if (type === 'boolean' && typeof value !== 'boolean') {
    return [{ path, kind: 'type', expected: 'boolean' }];
  }
  return issues;
};

type Translate = (key: string, options: Record<string, unknown>) => string;

const TYPE_WORDS: Record<string, { key: string; defaultValue: string }> = {
  string: { key: 'runDialog.issues.types.string', defaultValue: 'text' },
  number: { key: 'runDialog.issues.types.number', defaultValue: 'a number' },
  integer: { key: 'runDialog.issues.types.integer', defaultValue: 'a whole number' },
  boolean: { key: 'runDialog.issues.types.boolean', defaultValue: 'true or false' },
  object: { key: 'runDialog.issues.types.object', defaultValue: 'a group of fields' },
  array: { key: 'runDialog.issues.types.array', defaultValue: 'a list' },
};

/** "Message must be an id (UUID)": one plain-language sentence for one issue. */
export const describeWorkflowPayloadIssue = (t: Translate, issue: WorkflowPayloadIssue, field: string): string => {
  switch (issue.kind) {
    case 'required':
      return t('runDialog.issues.required', { defaultValue: '{{field}} is required', field });
    case 'type': {
      const word = issue.expected ? TYPE_WORDS[issue.expected] : undefined;
      return word
        ? t('runDialog.issues.type', { defaultValue: '{{field}} must be {{type}}', field, type: t(word.key, { defaultValue: word.defaultValue }) })
        : t('runDialog.issues.typeUnknown', { defaultValue: '{{field}} has the wrong kind of value', field });
    }
    case 'format':
      switch (issue.format) {
        case 'uuid':
          return t('runDialog.issues.formatUuid', { defaultValue: '{{field}} must be an id (UUID), like 3f2c1a5e-0b7d-4c1e-9a2f-6d8e4b1c7a90', field });
        case 'email':
          return t('runDialog.issues.formatEmail', { defaultValue: '{{field}} must be an email address', field });
        case 'date':
          return t('runDialog.issues.formatDate', { defaultValue: '{{field}} must be a date (YYYY-MM-DD)', field });
        case 'date-time':
          return t('runDialog.issues.formatDateTime', { defaultValue: '{{field}} must be a date and time, like 2026-10-03T09:00:00Z', field });
        case 'time':
          return t('runDialog.issues.formatTime', { defaultValue: '{{field}} must be a time (HH:MM)', field });
        case 'url':
          return t('runDialog.issues.formatUrl', { defaultValue: '{{field}} must be a web address', field });
        default:
          return t('runDialog.issues.formatOther', { defaultValue: '{{field}} is not in the expected format', field });
      }
    case 'choice':
      return issue.options?.length
        ? t('runDialog.issues.choice', { defaultValue: '{{field}} must be one of: {{options}}', field, options: issue.options.join(', ') })
        : t('runDialog.issues.choiceUnknown', { defaultValue: '{{field}} is not one of the allowed values', field });
    case 'too_small':
      if (issue.sizeOf === 'string') return t('runDialog.issues.tooShort', { defaultValue: '{{field}} must be at least {{limit}} characters', field, limit: issue.limit });
      if (issue.sizeOf === 'array') return t('runDialog.issues.tooFewItems', { defaultValue: '{{field}} needs at least {{limit}} items', field, limit: issue.limit });
      return t('runDialog.issues.tooSmall', { defaultValue: '{{field}} must be at least {{limit}}', field, limit: issue.limit });
    case 'too_big':
      if (issue.sizeOf === 'string') return t('runDialog.issues.tooLong', { defaultValue: '{{field}} must be at most {{limit}} characters', field, limit: issue.limit });
      if (issue.sizeOf === 'array') return t('runDialog.issues.tooManyItems', { defaultValue: '{{field}} can have at most {{limit}} items', field, limit: issue.limit });
      return t('runDialog.issues.tooBig', { defaultValue: '{{field}} must be at most {{limit}}', field, limit: issue.limit });
    case 'unknown_field':
      return t('runDialog.issues.unknownField', { defaultValue: '{{field}} is not part of this payload', field });
    default:
      return issue.message
        ? t('runDialog.issues.invalidWithMessage', { defaultValue: '{{field}}: {{message}}', field, message: issue.message })
        : t('runDialog.issues.invalid', { defaultValue: '{{field}} is not valid', field });
  }
};

/** "Ticket › Message" for nested fields; list positions read as "item 2". */
export const labelRunPayloadPath = (
  path: Array<string | number>,
  labelForKey: (key: string, parentPath: Array<string | number>) => string,
  itemLabel: (position: number) => string
): string =>
  path
    .map((segment, index) => (typeof segment === 'number' ? itemLabel(segment + 1) : labelForKey(segment, path.slice(0, index))))
    .join(' › ');

/**
 * The Run dialog's message when the server refused the payload: the fields to fix, by name. Issues
 * that point into the dialog's own payload are also shown next to their fields.
 */
export const describeRunPayloadValidationFailure = (
  t: Translate,
  failure: WorkflowPayloadValidationFailure,
  labelForPath: (path: Array<string | number>) => string,
  runId: string | null
) => {
  const sentences = failure.issues.map((issue) => describeWorkflowPayloadIssue(t, issue, labelForPath(issue.path)));
  const shown = sentences.slice(0, 5);
  const more = sentences.length - shown.length;
  const list = `${shown.join('. ')}${more > 0 ? `. ${t('runDialog.issues.more', { defaultValue: '+{{count}} more', count: more })}` : ''}.`;
  return {
    runId,
    title: failure.appliesTo === 'input'
      ? t('runDialog.issues.inputTitle', { defaultValue: 'Fix these fields, then start the run again' })
      : t('runDialog.issues.mappedTitle', { defaultValue: 'The trigger mapping produced a payload the workflow does not accept' }),
    description: failure.appliesTo === 'input'
      ? list
      : t('runDialog.issues.mappedDescription', {
          defaultValue: '{{issues}} Check the trigger mapping in the workflow settings, or the event fields it reads.',
          issues: list,
        }),
    technicalDetail: null,
  };
};
