/**
 * Per-field validation for a service request form, shared by the portal (as the client types
 * and on submit) and by the server at submit. Like `formVisibility.ts`, this module is imported
 * by a Next client component, so it must not import knex, `@alga-psa/db`, the provider registry
 * or anything from `contracts.ts`.
 *
 * It answers with `FieldValidationIssue` data, never a sentence: the portal renders it through
 * `t()`, the server through `describeFieldValidationIssue`.
 */
import {
  getFieldElementKind,
  isUnsupportedFieldType,
  validateFieldValue,
  type FieldValidationIssue,
  type FieldValidationRules,
} from '@alga-psa/ui/form-fields';

export interface ValidatableFormField {
  key?: unknown;
  type?: unknown;
  label?: unknown;
  required?: unknown;
  validation?: unknown;
}

export interface FormFieldIssue {
  fieldKey: string;
  label: string;
  issue: FieldValidationIssue;
}

function fieldLabel(field: ValidatableFormField, fieldKey: string): string {
  return typeof field.label === 'string' && field.label.trim().length > 0
    ? field.label.trim()
    : fieldKey;
}

/**
 * Every failing visible input, in form order. Display blocks are skipped (no answer), hidden
 * fields are skipped (never rendered, never required), and uploads are checked against
 * `fieldKeysWithFiles` because their value never reaches the payload.
 */
export function collectFormFieldIssues(input: {
  fields: ReadonlyArray<ValidatableFormField>;
  values: Record<string, unknown>;
  visibleFieldKeys?: ReadonlySet<string> | null;
  fieldKeysWithFiles?: ReadonlySet<string>;
}): FormFieldIssue[] {
  const issues: FormFieldIssue[] = [];

  for (const field of input.fields) {
    if (typeof field?.key !== 'string' || field.key.length === 0) {
      continue;
    }
    if (getFieldElementKind(field.type) === 'display') {
      continue;
    }
    // A published question of a type this build cannot render is an inert row: nothing to answer,
    // so nothing to require (otherwise the whole form would be unsubmittable).
    if (isUnsupportedFieldType(field.type)) {
      continue;
    }
    const fieldKey = field.key;
    if (input.visibleFieldKeys && !input.visibleFieldKeys.has(fieldKey)) {
      continue;
    }

    if (field.type === 'file-upload') {
      if (field.required && !input.fieldKeysWithFiles?.has(fieldKey)) {
        issues.push({ fieldKey, label: fieldLabel(field, fieldKey), issue: { rule: 'required' } });
      }
      continue;
    }

    const issue = validateFieldValue({
      type: typeof field.type === 'string' ? field.type : 'short-text',
      value: input.values[fieldKey],
      required: Boolean(field.required),
      validation: (field.validation as FieldValidationRules | undefined) ?? null,
    });
    if (issue) {
      issues.push({ fieldKey, label: fieldLabel(field, fieldKey), issue });
    }
  }

  return issues;
}
