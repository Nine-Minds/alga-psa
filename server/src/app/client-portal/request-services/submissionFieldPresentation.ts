import { formatFieldValue, getFieldElementKind } from '@alga-psa/ui/form-fields';

interface SubmissionFieldOption {
  label?: string;
  value?: string;
}

interface SubmissionFieldSnapshot {
  key?: string;
  type?: string;
  options?: SubmissionFieldOption[];
}

interface SubmissionAttachmentSnapshot {
  submission_attachment_id: string;
  field_key?: string | null;
  file_name?: string | null;
}

export interface SubmissionFieldDisplay {
  kind: 'missing' | 'text' | 'attachments';
  text?: string;
  attachments?: SubmissionAttachmentSnapshot[];
}

function isMissingValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  return value === null || value === undefined || value === '';
}

function isCheckedValue(value: unknown): boolean {
  return value === true || value === 'true' || value === 'on' || value === '1';
}

function getFileUploadFields(fields: SubmissionFieldSnapshot[]): SubmissionFieldSnapshot[] {
  return fields.filter(
    (field) => field?.type === 'file-upload' && typeof field?.key === 'string'
  );
}

// LEVERAGE: pattern service-request-answer-display — ticketOnlyExecutionProvider.ts describeAnswer resolves the same display values for the ticket description.
export function getSubmissionFieldDisplay(
  field: SubmissionFieldSnapshot,
  fields: SubmissionFieldSnapshot[],
  payload: Record<string, unknown>,
  attachments: SubmissionAttachmentSnapshot[]
): SubmissionFieldDisplay {
  const key = typeof field?.key === 'string' ? field.key : null;
  if (!key) {
    return { kind: 'missing' };
  }

  // A display block carries no answer; it has nothing to read back.
  if (getFieldElementKind(field.type) === 'display') {
    return { kind: 'missing' };
  }

  if (field.type === 'file-upload') {
    const directMatches = attachments.filter((attachment) => attachment.field_key === key);
    if (directMatches.length > 0) {
      return {
        kind: 'attachments',
        attachments: directMatches,
      };
    }

    const fileUploadFields = getFileUploadFields(fields);
    if (fileUploadFields.length === 1 && fileUploadFields[0]?.key === key) {
      const legacyMatches = attachments.filter(
        (attachment) => attachment.field_key === null || attachment.field_key === undefined
      );
      if (legacyMatches.length > 0) {
        return {
          kind: 'attachments',
          attachments: legacyMatches,
        };
      }
    }

    return { kind: 'missing' };
  }

  const value = payload[key];
  if (isMissingValue(value)) {
    return { kind: 'missing' };
  }

  if (field.type === 'checkbox') {
    return {
      kind: 'text',
      text: isCheckedValue(value) ? 'Yes' : 'No',
    };
  }

  // Every other type reads back through the shared registry, so a new field type needs no
  // change here: choices resolve to their option label, lists join, the rest stringify.
  const options = Array.isArray(field.options)
    ? field.options
        .map((option) => ({
          label: typeof option?.label === 'string' ? option.label : String(option?.value ?? ''),
          value: typeof option?.value === 'string' ? option.value : '',
        }))
        .filter((option) => option.value.length > 0)
    : undefined;
  const formatted = formatFieldValue(field.type, value, options);
  if (formatted) {
    return { kind: 'text', text: formatted };
  }

  if (typeof value === 'object') {
    return {
      kind: 'text',
      text: JSON.stringify(value),
    };
  }

  return {
    kind: 'text',
    text: String(value),
  };
}
