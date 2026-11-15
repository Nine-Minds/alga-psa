/**
 * The shared field-type vocabulary.
 *
 * One entry per field type describes everything a consumer needs: what the stored value
 * looks like, which input control edits it, how a stored answer reads back, which
 * validation rules apply, and which comparison operators make sense. Service request forms
 * are the first consumer; custom fields on records, list and report filters, and rule
 * condition builders are the next ones, so nothing here may assume a form.
 *
 * Operators are NOT a new list: they are a subset of `PredicateOperator` from
 * `@alga-psa/predicates`, the clause model (`{ path, operator, value }`) that workflow
 * conditions, checklist rules, RMM alert rules and the service request audience editor
 * already share.
 */
import type { PredicateOperator } from '@alga-psa/predicates';

/**
 * Whether an element carries an answer (`input`) or only renders (`display`).
 * Display blocks never appear in a submitted payload and are never required.
 */
export type FieldElementKind = 'input' | 'display';

export type FieldInputTypeKey =
  | 'short-text'
  | 'long-text'
  | 'number'
  | 'email'
  | 'phone'
  | 'url'
  | 'select'
  | 'multi-select'
  | 'radio'
  | 'checkbox'
  | 'date'
  | 'date-time'
  | 'file-upload';

export type FieldDisplayTypeKey = 'section' | 'text' | 'callout' | 'divider';

export type FieldTypeKey = FieldInputTypeKey | FieldDisplayTypeKey;

/** The shape a stored answer takes. `none` is a display block, which stores nothing. */
export type FieldValueShape = 'string' | 'number' | 'boolean' | 'string-list' | 'file' | 'none';

/** Which shared control edits the value. Consumers map this to their own renderer. */
export type FieldControlKey =
  | 'text'
  | 'textarea'
  | 'number'
  | 'email'
  | 'phone'
  | 'url'
  | 'select'
  | 'multi-select'
  | 'radio'
  | 'checkbox'
  | 'date'
  | 'date-time'
  | 'file'
  | 'none';

export type FieldValidationRuleKey =
  | 'minLength'
  | 'maxLength'
  | 'pattern'
  | 'min'
  | 'max'
  | 'minDate'
  | 'maxDate'
  | 'minSelected'
  | 'maxSelected';

/**
 * Author-set limits on an answer. Every key is optional; `message` replaces the default
 * wording for whichever rule on this field fails first.
 */
export interface FieldValidationRules {
  minLength?: number;
  maxLength?: number;
  /** An un-anchored JavaScript regular expression source. */
  pattern?: string;
  min?: number;
  max?: number;
  /** ISO date (`YYYY-MM-DD`) or date-time. */
  minDate?: string;
  maxDate?: string;
  minSelected?: number;
  maxSelected?: number;
  message?: string | null;
}

export interface FieldOption {
  label: string;
  value: string;
}

/** A validation failure, as data: the caller decides the wording and the locale. */
export interface FieldValidationIssue {
  rule: FieldValidationRuleKey | 'required' | 'type';
  /** Interpolation values for the rule's message, e.g. `{ max: 10 }`. */
  params?: Record<string, string | number>;
  /** The author's custom message for the field, when they set one. */
  customMessage?: string | null;
}

export interface FieldTypeDefinition {
  key: FieldTypeKey;
  kind: FieldElementKind;
  valueShape: FieldValueShape;
  control: FieldControlKey;
  /** Which validation rules an editor should offer for this type. */
  validationRules: readonly FieldValidationRuleKey[];
  /** Comparison operators that make sense for this type; always a subset of PredicateOperator. */
  operators: readonly PredicateOperator[];
  supportsOptions: boolean;
  supportsPlaceholder: boolean;
  supportsDefaultValue: boolean;
  supportsHelpText: boolean;
  /** Group used by palettes and type pickers. */
  group: FieldTypeGroup;
  /** Normalizes a raw stored or posted value into this type's value shape. */
  coerce(value: unknown): unknown;
  /** Whether a coerced value counts as "no answer". An unchecked checkbox is an answer. */
  isEmpty(value: unknown): boolean;
  /** Read-only text for a stored answer. Options are passed so choices read as labels. */
  format(value: unknown, options?: readonly FieldOption[]): string;
}

export type FieldTypeGroup = 'text' | 'choice' | 'datetime' | 'file' | 'layout';
