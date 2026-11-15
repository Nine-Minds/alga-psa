import { getFieldElementKind } from '@alga-psa/ui/form-fields';
import {
  describeFormAnswer,
  isFormAnswerMissing,
} from '../../../lib/service-requests/formSchema';

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

function getFileUploadFields(fields: SubmissionFieldSnapshot[]): SubmissionFieldSnapshot[] {
  return fields.filter(
    (field) => field?.type === 'file-upload' && typeof field?.key === 'string'
  );
}

/**
 * What one answer looks like on the portal's submission detail page. The display value itself
 * comes from `describeFormAnswer`, the same function the ticket subject and the ticket
 * description read, so a new field type reads back identically in all three.
 */
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
  // A checkbox always has an answer; every other type is missing when the registry says so.
  if (field.type !== 'checkbox' && isFormAnswerMissing(field, value)) {
    return { kind: 'missing' };
  }

  return { kind: 'text', text: describeFormAnswer(field, value) };
}
