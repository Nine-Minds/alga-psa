'use server';

import { uploadDocument } from '@alga-psa/documents/actions/documentActions';

/** Upload a comment draft scoped to a Project Task. */
export async function uploadProjectTaskCommentDocument(
  formData: FormData,
  params: { userId: string; projectTaskId: string },
) {
  return uploadDocument(formData, { ...params, commentAttachmentDraft: true });
}
