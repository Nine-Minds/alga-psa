import { useRichTextUploadSession } from '@alga-psa/ui/editor';
import { discardProjectTaskCommentAttachmentDrafts } from '../actions/projectTaskCommentAttachmentDraftActions';
import { useProjectDataSource } from '../context/ProjectDataSourceContext';

export function useTaskCommentUploadSession(
  componentLabel: string,
  taskId: string,
  userId: string | null | undefined,
  onDiscard: () => void,
) {
  const { uploadTaskCommentDocument } = useProjectDataSource();
  return useRichTextUploadSession({
    componentLabel,
    commentAttachments: true,
    scope: { entityType: 'project_task', entityId: taskId },
    userId,
    trackDraftUploads: true,
    uploadsRestricted: !uploadTaskCommentDocument,
    onDiscard,
    uploadDocumentAction: uploadTaskCommentDocument
      ? (formData, params) => uploadTaskCommentDocument(formData, { userId: params.userId, projectTaskId: taskId })
      : undefined,
    deleteDraftUploadsAction: ({ documentIds }) =>
      discardProjectTaskCommentAttachmentDrafts({ projectTaskId: taskId, documentIds }),
  });
}
