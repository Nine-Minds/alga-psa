'use server';

import {
  discardProjectTaskCommentAttachmentDrafts as discardProjectTaskCommentAttachmentDraftsCore,
  uploadProjectTaskCommentDocument as uploadProjectTaskCommentDocumentCore,
} from '@alga-psa/projects/actions/projectTaskCommentAttachmentDraftActions';

/** Upload a comment draft scoped to a Project Task. */
export async function uploadProjectTaskCommentDocument(
  formData: FormData,
  params: { userId: string; projectTaskId: string },
) {
  return uploadProjectTaskCommentDocumentCore(formData, params);
}

/** Discard only drafts owned by the current actor for this Project Task. */
export async function discardProjectTaskCommentDrafts(input: {
  projectTaskId: string;
  documentIds: string[];
}) {
  return discardProjectTaskCommentAttachmentDraftsCore(input);
}
