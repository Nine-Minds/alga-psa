'use client';

import React, { useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import type { FieldValidationIssue } from '@alga-psa/ui/form-fields';
import { getFieldElementKind, getFieldType } from '@alga-psa/ui/form-fields';
import {
  computeVisibleFieldKeys,
  type VisibilityContext,
  type VisibilityRule,
} from '../../lib/service-requests/formVisibility';
import { collectFormFieldIssues } from '../../lib/service-requests/formValidation';
import type { BasicFormField, BasicFormSettings } from '../../lib/service-requests/formSchema';
import { ServiceRequestFormRenderer } from './ServiceRequestFormRenderer';
import { CLIENT_SUBMISSION_KEY_FIELD_NAME } from './clientSubmissionKey';

export type RequestServiceFormField = BasicFormField;

export interface RequestServiceFormLabels {
  selectPlaceholder: string;
  datePlaceholder: string;
  submit: string;
  /** Shown under a visible required field that is still empty when the client submits. */
  requiredField: string;
  /** Wording per validation rule; the key is the rule name. */
  validation?: Partial<Record<FieldValidationIssue['rule'], string>>;
}

interface RequestServiceFormVisibility {
  enabled: boolean;
  rules: VisibilityRule[];
  context: VisibilityContext;
}

interface RequestServiceFormProps {
  action: (formData: FormData) => void | Promise<void>;
  fields: RequestServiceFormField[];
  settings?: BasicFormSettings;
  initialValues: Record<string, unknown>;
  /** Live conditional-visibility rules; when absent or disabled every field renders. */
  visibility?: RequestServiceFormVisibility;
  labels: RequestServiceFormLabels;
  /**
   * Idempotency key minted once per rendered form attempt. Submitting the same
   * rendered form again (a retry or double-click) resends the same key, so the
   * server resolves duplicates to the original submission.
   */
  clientSubmissionKey: string;
}

/** Interpolates `{{min}}`-style placeholders in a localized validation message. */
function applyIssueParams(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    params[name] !== undefined ? String(params[name]) : match
  );
}

export function RequestServiceForm({
  action,
  fields,
  settings,
  initialValues,
  visibility,
  labels,
  clientSubmissionKey,
}: RequestServiceFormProps) {
  // One value map for every input. Seeded to mirror what the server sees in the submitted
  // payload (text/select/date => string, checkbox => boolean, multi-select => string[]), so
  // the shared evaluator gives the same answer on both sides.
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = { ...initialValues };
    for (const field of fields) {
      if (getFieldElementKind(field.type) === 'display') {
        continue;
      }
      const value = initialValues[field.key];
      if (field.type === 'file-upload') {
        continue;
      }
      if (field.type === 'checkbox') {
        initial[field.key] = value === true;
      } else if (field.type === 'multi-select') {
        initial[field.key] = Array.isArray(value) ? value : [];
      } else {
        initial[field.key] = typeof value === 'string' ? value : '';
      }
    }
    return initial;
  });
  // Field keys that failed at the last blocked submit, with their localized message.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const describeIssue = (issue: FieldValidationIssue): string => {
    if (issue.rule === 'required') {
      return labels.requiredField;
    }
    if (issue.customMessage) {
      return issue.customMessage;
    }
    const template = labels.validation?.[issue.rule];
    return template ? applyIssueParams(template, issue.params) : labels.requiredField;
  };

  const setValue = (key: string, value: unknown) => {
    setValues((previous) => ({ ...previous, [key]: value }));
    setFieldErrors((previous) => {
      if (!(key in previous)) return previous;
      const next = { ...previous };
      delete next[key];
      return next;
    });
  };

  // Hidden fields are not rendered at all: the browser submits no hidden answers and
  // never enforces their `required`.
  const visibleFieldKeys: Set<string> | null =
    visibility?.enabled
      ? new Set(computeVisibleFieldKeys(fields, visibility.rules, values, visibility.context))
      : null;

  // The form is noValidate (the searchable select and date pickers submit through hidden
  // inputs, which native validation cannot check), so answers are checked here with the
  // server's own rules. Blocking in the browser keeps the client's answers; the server still
  // re-validates, and a field that is hidden is never required.
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    const formElement = event.currentTarget;
    const fieldKeysWithFiles = new Set<string>();
    for (const field of fields) {
      if (field.type !== 'file-upload') continue;
      const input = formElement.elements.namedItem(field.key);
      if (input instanceof HTMLInputElement && (input.files?.length ?? 0) > 0) {
        fieldKeysWithFiles.add(field.key);
      }
    }

    const issues = collectFormFieldIssues({
      fields,
      values,
      visibleFieldKeys,
      fieldKeysWithFiles,
    });
    setFieldErrors(
      Object.fromEntries(issues.map((entry) => [entry.fieldKey, describeIssue(entry.issue)]))
    );
    if (issues.length > 0) {
      event.preventDefault();
      document.getElementById(`request-service-field-${issues[0].fieldKey}`)?.focus();
    }
  };

  const visibleFields = fields.filter(
    (field) => !visibleFieldKeys || visibleFieldKeys.has(field.key)
  );
  // A display block is not a value; it never reaches the payload.
  const submitLabel = settings?.submitLabel?.trim() || labels.submit;

  return (
    <form
      action={action}
      onSubmit={handleSubmit}
      encType="multipart/form-data"
      noValidate
      className="space-y-4"
    >
      <input
        type="hidden"
        name={CLIENT_SUBMISSION_KEY_FIELD_NAME}
        value={clientSubmissionKey}
      />
      <ServiceRequestFormRenderer
        fields={visibleFields}
        settings={settings}
        values={values}
        onValueChange={setValue}
        errors={fieldErrors}
        labels={{
          selectPlaceholder: labels.selectPlaceholder,
          datePlaceholder: labels.datePlaceholder,
        }}
        postFieldNames
        idPrefix="request-service-field"
      >
        <Button id="request-service-submit" type="submit">
          {submitLabel}
        </Button>
      </ServiceRequestFormRenderer>
    </form>
  );
}

/** Whether a field type stores an answer. Re-exported for the portal page's payload build. */
export const isAnswerField = (type: unknown): boolean => getFieldType(type)?.kind === 'input';
