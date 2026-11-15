/**
 * The field type registry. One table, read by every consumer, so no designer grows its own
 * field system. See `./types.ts` for what an entry promises.
 */
import type { PredicateOperator } from '@alga-psa/predicates';
import type {
  FieldElementKind,
  FieldOption,
  FieldTypeDefinition,
  FieldTypeKey,
  FieldValidationRuleKey,
} from './types';

const PRESENCE: readonly PredicateOperator[] = ['is_empty', 'is_not_empty'];
const EQUALITY: readonly PredicateOperator[] = ['equals', 'not_equals'];
const TEXT_MATCH: readonly PredicateOperator[] = [
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
];
const MEMBERSHIP: readonly PredicateOperator[] = ['in', 'not_in'];
const ORDERING: readonly PredicateOperator[] = ['gt', 'gte', 'lt', 'lte'];

const TEXT_OPERATORS = [...EQUALITY, ...TEXT_MATCH, ...MEMBERSHIP, ...PRESENCE] as const;
const CHOICE_OPERATORS = [...EQUALITY, ...MEMBERSHIP, ...PRESENCE] as const;
const NUMBER_OPERATORS = [...EQUALITY, ...ORDERING, ...PRESENCE] as const;
const DATE_OPERATORS = [...EQUALITY, ...ORDERING, ...PRESENCE] as const;

const TEXT_RULES: readonly FieldValidationRuleKey[] = ['minLength', 'maxLength', 'pattern'];
const NUMBER_RULES: readonly FieldValidationRuleKey[] = ['min', 'max'];
const DATE_RULES: readonly FieldValidationRuleKey[] = ['minDate', 'maxDate'];
const MULTI_RULES: readonly FieldValidationRuleKey[] = ['minSelected', 'maxSelected'];

const toTrimmedString = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
};

const isBlankString = (value: unknown): boolean => toTrimmedString(value).trim().length === 0;

const coerceStringList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((entry) => toTrimmedString(entry)).filter((entry) => entry.length > 0);
  }
  const single = toTrimmedString(value);
  return single.length > 0 ? [single] : [];
};

const labelForOption = (value: string, options?: readonly FieldOption[]): string =>
  options?.find((option) => option.value === value)?.label ?? value;

const CHECKED_VALUES = new Set(['true', 'on', '1', 'yes']);

const coerceBoolean = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return CHECKED_VALUES.has(value.trim().toLowerCase());
  if (typeof value === 'number') return value === 1;
  return false;
};

const coerceNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = toTrimmedString(value).trim();
  if (text.length === 0) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
};

interface TextTypeInput {
  key: FieldTypeKey;
  control: FieldTypeDefinition['control'];
  group?: FieldTypeDefinition['group'];
}

function textType({ key, control, group = 'text' }: TextTypeInput): FieldTypeDefinition {
  return {
    key,
    kind: 'input',
    valueShape: 'string',
    control,
    validationRules: TEXT_RULES,
    operators: TEXT_OPERATORS,
    supportsOptions: false,
    supportsPlaceholder: true,
    supportsDefaultValue: true,
    supportsHelpText: true,
    group,
    coerce: (value) => toTrimmedString(value),
    isEmpty: isBlankString,
    format: (value) => toTrimmedString(value),
  };
}

function choiceType(key: 'select' | 'radio'): FieldTypeDefinition {
  return {
    key,
    kind: 'input',
    valueShape: 'string',
    control: key,
    validationRules: [],
    operators: CHOICE_OPERATORS,
    supportsOptions: true,
    supportsPlaceholder: key === 'select',
    supportsDefaultValue: true,
    supportsHelpText: true,
    group: 'choice',
    coerce: (value) => toTrimmedString(value),
    isEmpty: isBlankString,
    format: (value, options) => labelForOption(toTrimmedString(value), options),
  };
}

function displayType(
  key: 'section' | 'text' | 'callout' | 'divider'
): FieldTypeDefinition {
  return {
    key,
    kind: 'display',
    valueShape: 'none',
    control: 'none',
    validationRules: [],
    operators: [],
    supportsOptions: false,
    supportsPlaceholder: false,
    supportsDefaultValue: false,
    supportsHelpText: key === 'section',
    group: 'layout',
    coerce: () => undefined,
    isEmpty: () => true,
    format: () => '',
  };
}

const DEFINITIONS: Record<FieldTypeKey, FieldTypeDefinition> = {
  'short-text': textType({ key: 'short-text', control: 'text' }),
  'long-text': textType({ key: 'long-text', control: 'textarea' }),
  email: textType({ key: 'email', control: 'email' }),
  phone: textType({ key: 'phone', control: 'phone' }),
  url: textType({ key: 'url', control: 'url' }),
  number: {
    key: 'number',
    kind: 'input',
    valueShape: 'number',
    control: 'number',
    validationRules: NUMBER_RULES,
    operators: NUMBER_OPERATORS,
    supportsOptions: false,
    supportsPlaceholder: true,
    supportsDefaultValue: true,
    supportsHelpText: true,
    group: 'datetime',
    // A form payload carries the typed characters (FormData is text), so the stored value is
    // the string the requester entered; `coerce` is what reads it as a number.
    coerce: coerceNumber,
    isEmpty: (value) => coerceNumber(value) === null,
    format: (value) => {
      const parsed = coerceNumber(value);
      return parsed === null ? '' : String(parsed);
    },
  },
  select: choiceType('select'),
  radio: choiceType('radio'),
  'multi-select': {
    key: 'multi-select',
    kind: 'input',
    valueShape: 'string-list',
    control: 'multi-select',
    validationRules: MULTI_RULES,
    operators: [...MEMBERSHIP, ...PRESENCE],
    supportsOptions: true,
    supportsPlaceholder: true,
    // Several choices can be pre-ticked; the stored default is a list, like the value.
    supportsDefaultValue: true,
    supportsHelpText: true,
    group: 'choice',
    coerce: coerceStringList,
    isEmpty: (value) => coerceStringList(value).length === 0,
    format: (value, options) =>
      coerceStringList(value)
        .map((entry) => labelForOption(entry, options))
        .join(', '),
  },
  checkbox: {
    key: 'checkbox',
    kind: 'input',
    valueShape: 'boolean',
    control: 'checkbox',
    validationRules: [],
    operators: EQUALITY,
    supportsOptions: false,
    supportsPlaceholder: false,
    supportsDefaultValue: true,
    supportsHelpText: true,
    group: 'choice',
    coerce: coerceBoolean,
    // An unchecked box is an answer, not a blank. Required-ness on a checkbox is handled
    // by the consumer's own rule, never by emptiness.
    isEmpty: () => false,
    format: (value) => (coerceBoolean(value) ? 'Yes' : 'No'),
  },
  date: {
    key: 'date',
    kind: 'input',
    valueShape: 'string',
    control: 'date',
    validationRules: DATE_RULES,
    operators: DATE_OPERATORS,
    supportsOptions: false,
    supportsPlaceholder: true,
    supportsDefaultValue: true,
    supportsHelpText: true,
    group: 'datetime',
    coerce: (value) => toTrimmedString(value),
    isEmpty: isBlankString,
    format: (value) => toTrimmedString(value),
  },
  'date-time': {
    key: 'date-time',
    kind: 'input',
    valueShape: 'string',
    control: 'date-time',
    validationRules: DATE_RULES,
    operators: DATE_OPERATORS,
    supportsOptions: false,
    supportsPlaceholder: true,
    supportsDefaultValue: true,
    supportsHelpText: true,
    group: 'datetime',
    coerce: (value) => toTrimmedString(value),
    isEmpty: isBlankString,
    format: (value) => toTrimmedString(value),
  },
  'file-upload': {
    key: 'file-upload',
    kind: 'input',
    valueShape: 'file',
    control: 'file',
    validationRules: [],
    operators: PRESENCE,
    supportsOptions: false,
    supportsPlaceholder: false,
    supportsDefaultValue: false,
    supportsHelpText: true,
    group: 'file',
    coerce: (value) => value,
    isEmpty: (value) => value === null || value === undefined,
    format: () => '',
  },
  section: displayType('section'),
  text: displayType('text'),
  callout: displayType('callout'),
  divider: displayType('divider'),
};

export const FIELD_TYPE_REGISTRY: Readonly<Record<FieldTypeKey, FieldTypeDefinition>> = DEFINITIONS;

export const FIELD_TYPE_KEYS = Object.keys(DEFINITIONS) as FieldTypeKey[];

/** The one table every consumer reads to tell an answer-carrying element from a display block. */
export const FIELD_TYPE_KINDS: Readonly<Record<FieldTypeKey, FieldElementKind>> = Object.freeze(
  Object.fromEntries(
    FIELD_TYPE_KEYS.map((key) => [key, DEFINITIONS[key].kind])
  ) as Record<FieldTypeKey, FieldElementKind>
);

export function isFieldTypeKey(value: unknown): value is FieldTypeKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(DEFINITIONS, value);
}

export function getFieldType(key: unknown): FieldTypeDefinition | null {
  return isFieldTypeKey(key) ? DEFINITIONS[key] : null;
}

/**
 * The element kind for a type. Unknown types are treated as `input`, which is what the
 * legacy schema did when it coerced an unknown type to short-text.
 */
export function getFieldElementKind(key: unknown): FieldElementKind {
  return getFieldType(key)?.kind ?? 'input';
}

export function isDisplayFieldType(key: unknown): boolean {
  return getFieldElementKind(key) === 'display';
}

export function isInputFieldType(key: unknown): boolean {
  return getFieldElementKind(key) === 'input';
}

/** Operators offered for a type, by the shared predicate vocabulary. */
export function getFieldTypeOperators(key: unknown): readonly PredicateOperator[] {
  return getFieldType(key)?.operators ?? [];
}

export function formatFieldValue(
  key: unknown,
  value: unknown,
  options?: readonly FieldOption[]
): string {
  const definition = getFieldType(key);
  if (!definition) {
    return value === null || value === undefined ? '' : String(value);
  }
  return definition.format(value, options);
}
