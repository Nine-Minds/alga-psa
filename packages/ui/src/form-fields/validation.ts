/**
 * One validator for a field's answer, shared by the browser and the server so both block
 * exactly the same submissions. It returns the failure as data (`FieldValidationIssue`),
 * never a sentence: the browser renders it through `t()`, the server through
 * `describeFieldValidationIssue`.
 */
import { getFieldType } from './registry';
import type { FieldValidationIssue, FieldValidationRules, FieldTypeKey } from './types';

export interface ValidateFieldValueInput {
  type: FieldTypeKey | string;
  value: unknown;
  required?: boolean;
  validation?: FieldValidationRules | null;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_PATTERN = /^(https?:\/\/)[^\s]+$/i;
const PHONE_PATTERN = /^[+()\d][\d\s().+-]{4,}$/;

function toText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function toList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => toText(entry)).filter(Boolean);
  const single = toText(value).trim();
  return single ? [single] : [];
}

function compilePattern(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    // An unparseable pattern must not block a submission; the author sees it in the editor.
    return null;
  }
}

/** Date-only strings compare lexically; a date-time compares as a timestamp. */
function compareDates(left: string, right: string): number | null {
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/;
  if (isDateOnly.test(left) && isDateOnly.test(right)) {
    return left < right ? -1 : left > right ? 1 : 0;
  }
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) return null;
  return leftTime < rightTime ? -1 : leftTime > rightTime ? 1 : 0;
}

/**
 * The first failure on a field, or null. Display blocks always pass: they carry no answer.
 * A blank optional answer passes every rule — rules constrain an answer, they don't demand one.
 */
export function validateFieldValue(input: ValidateFieldValueInput): FieldValidationIssue | null {
  const definition = getFieldType(input.type);
  if (definition && definition.kind === 'display') {
    return null;
  }

  const rules = input.validation ?? {};
  const customMessage = rules.message?.trim() ? rules.message.trim() : null;
  const fail = (
    rule: FieldValidationIssue['rule'],
    params?: Record<string, string | number>
  ): FieldValidationIssue => ({ rule, params, customMessage });

  const isEmpty = definition ? definition.isEmpty(input.value) : toText(input.value).trim() === '';

  if (input.required && isEmpty) {
    return { rule: 'required' };
  }
  if (isEmpty) {
    return null;
  }

  const valueShape = definition?.valueShape ?? 'string';

  if (valueShape === 'string-list') {
    const selected = toList(input.value);
    if (typeof rules.minSelected === 'number' && selected.length < rules.minSelected) {
      return fail('minSelected', { minSelected: rules.minSelected });
    }
    if (typeof rules.maxSelected === 'number' && selected.length > rules.maxSelected) {
      return fail('maxSelected', { maxSelected: rules.maxSelected });
    }
    return null;
  }

  const text = toText(input.value);

  if (input.type === 'number') {
    const parsed = Number(text.trim());
    if (!Number.isFinite(parsed)) {
      return fail('type');
    }
    if (typeof rules.min === 'number' && parsed < rules.min) {
      return fail('min', { min: rules.min });
    }
    if (typeof rules.max === 'number' && parsed > rules.max) {
      return fail('max', { max: rules.max });
    }
    return null;
  }

  if (input.type === 'date' || input.type === 'date-time') {
    if (rules.minDate) {
      const comparison = compareDates(text, rules.minDate);
      if (comparison !== null && comparison < 0) {
        return fail('minDate', { minDate: rules.minDate });
      }
    }
    if (rules.maxDate) {
      const comparison = compareDates(text, rules.maxDate);
      if (comparison !== null && comparison > 0) {
        return fail('maxDate', { maxDate: rules.maxDate });
      }
    }
    return null;
  }

  if (input.type === 'email' && !EMAIL_PATTERN.test(text.trim())) {
    return fail('type');
  }
  if (input.type === 'url' && !URL_PATTERN.test(text.trim())) {
    return fail('type');
  }
  if (input.type === 'phone' && !PHONE_PATTERN.test(text.trim())) {
    return fail('type');
  }

  if (typeof rules.minLength === 'number' && text.trim().length < rules.minLength) {
    return fail('minLength', { minLength: rules.minLength });
  }
  if (typeof rules.maxLength === 'number' && text.trim().length > rules.maxLength) {
    return fail('maxLength', { maxLength: rules.maxLength });
  }
  if (rules.pattern) {
    const compiled = compilePattern(rules.pattern);
    if (compiled && !compiled.test(text)) {
      return fail('pattern', { pattern: rules.pattern });
    }
  }

  return null;
}

const DEFAULT_MESSAGES: Record<FieldValidationIssue['rule'], (params: Record<string, string | number>) => string> = {
  required: () => 'is required',
  type: () => 'is not in the expected format',
  minLength: (params) => `must be at least ${params.minLength} characters`,
  maxLength: (params) => `must be ${params.maxLength} characters or fewer`,
  pattern: () => 'is not in the expected format',
  min: (params) => `must be ${params.min} or more`,
  max: (params) => `must be ${params.max} or less`,
  minDate: (params) => `must be on or after ${params.minDate}`,
  maxDate: (params) => `must be on or before ${params.maxDate}`,
  minSelected: (params) => `needs at least ${params.minSelected} selected`,
  maxSelected: (params) => `allows at most ${params.maxSelected} selected`,
};

/**
 * The server-side wording for a failure, naming the field by its label. The author's custom
 * message wins when they wrote one. Required-ness keeps its historic phrasing so existing
 * submission error strings and their tests do not move.
 */
export function describeFieldValidationIssue(
  issue: FieldValidationIssue,
  fieldLabel: string
): string {
  if (issue.rule !== 'required' && issue.customMessage) {
    return `"${fieldLabel}": ${issue.customMessage}`;
  }
  if (issue.rule === 'required') {
    return `Required field missing: "${fieldLabel}"`;
  }
  return `"${fieldLabel}" ${DEFAULT_MESSAGES[issue.rule](issue.params ?? {})}`;
}

/**
 * Drops rules that do not apply to a type and clamps the shape of each one. Authors can
 * change a field's type after setting rules; the leftovers must not silently constrain
 * the new type.
 */
export function normalizeFieldValidationRules(
  type: FieldTypeKey | string,
  raw: unknown
): FieldValidationRules | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const definition = getFieldType(type);
  const allowed = new Set(definition?.validationRules ?? []);
  const source = raw as Record<string, unknown>;
  const next: FieldValidationRules = {};

  const numericRules = ['minLength', 'maxLength', 'min', 'max', 'minSelected', 'maxSelected'] as const;
  for (const rule of numericRules) {
    if (!allowed.has(rule)) continue;
    const value = source[rule];
    const parsed = typeof value === 'number' ? value : Number(value);
    if (value !== null && value !== undefined && value !== '' && Number.isFinite(parsed)) {
      next[rule] = parsed;
    }
  }

  const textRules = ['pattern', 'minDate', 'maxDate'] as const;
  for (const rule of textRules) {
    if (!allowed.has(rule)) continue;
    const value = source[rule];
    if (typeof value === 'string' && value.trim().length > 0) {
      next[rule] = value.trim();
    }
  }

  if (typeof source.message === 'string' && source.message.trim().length > 0) {
    next.message = source.message.trim();
  }

  // A lone custom message constrains nothing; keep it only alongside a rule.
  const hasRule = Object.keys(next).some((key) => key !== 'message');
  if (!hasRule) {
    return undefined;
  }
  return next;
}
