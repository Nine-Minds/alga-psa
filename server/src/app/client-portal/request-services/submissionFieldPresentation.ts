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
  field_key?: string | null;
  file_id: string;
  file_name?: string | null;
}

export interface SubmissionFieldDisplay {
  kind: 'missing' | 'text' | 'attachments';
  text?: string;
  attachments?: SubmissionAttachmentSnapshot[];
}

function isMissingValue(value: unknown): boolean {
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

  if (field.type === 'select' && Array.isArray(field.options)) {
    const selectedValue = String(value);
    const selectedOption = field.options.find((option) => option?.value === selectedValue);
    return {
      kind: 'text',
      text: selectedOption?.label ?? selectedValue,
    };
  }

  if (field.type === 'checkbox') {
    return {
      kind: 'text',
      text: isCheckedValue(value) ? 'Yes' : 'No',
    };
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
