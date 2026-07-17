"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { PartialBlock } from "@blocknote/core";
import { Button } from "@alga-psa/ui/components/Button";
import CustomSelect from "@alga-psa/ui/components/CustomSelect";
import { ConfirmationDialog } from "@alga-psa/ui/components/ConfirmationDialog";
import { Dialog, DialogContent } from "@alga-psa/ui/components/Dialog";
import RichTextEditorSkeleton from "@alga-psa/ui/components/skeletons/RichTextEditorSkeleton";
import { useTranslation } from "@alga-psa/ui/lib/i18n/client";
import { searchUsersForMentions } from "@alga-psa/user-composition/actions";
import { DEFAULT_BLOCK } from "./TicketConversation";
import TicketNotificationSuppressionControl, {
  type TicketNotificationSuppressionValue,
} from "./TicketNotificationSuppressionControl";
import { useTicketRichTextUploadSession } from "./useTicketRichTextUploadSession";

const TextEditor = dynamic(
  () => import("@alga-psa/ui/editor").then((mod) => mod.TextEditor),
  {
    loading: () => <RichTextEditorSkeleton height="200px" />,
    ssr: false,
  },
);

const defaultNotificationSuppression =
  (): TicketNotificationSuppressionValue => ({
    suppressContactNotifications: false,
    suppressInternalNotifications: false,
  });

interface TicketResolutionDialogProps {
  id: string;
  isOpen: boolean;
  ticketId: string;
  currentUserId?: string | null;
  statusOptions: { value: string; label: string }[];
  isSubmitting?: boolean;
  onClose: () => void;
  onConfirm: (
    statusId: string,
    contentBlocks: PartialBlock[],
    suppression: TicketNotificationSuppressionValue,
  ) => void;
  onClipboardImageUploaded?: () => Promise<void> | void;
  uploadTicketAttachmentAction?: (
    formData: FormData,
    params: { userId: string; ticketId: string },
  ) => Promise<unknown>;
  deleteDraftTicketAttachmentImagesAction?: (input: {
    ticketId: string;
    documentIds: string[];
  }) => Promise<{
    deletedDocumentIds: string[];
    failures: Array<{ documentId: string; reason: string }>;
  }>;
  resolveTicketAttachmentViewUrl?: (document: {
    document_id?: string;
    file_id?: string;
  }) => string;
}

export default function TicketResolutionDialog({
  id,
  isOpen,
  ticketId,
  currentUserId,
  statusOptions,
  isSubmitting = false,
  onClose,
  onConfirm,
  onClipboardImageUploaded,
  uploadTicketAttachmentAction,
  deleteDraftTicketAttachmentImagesAction,
  resolveTicketAttachmentViewUrl,
}: TicketResolutionDialogProps) {
  const { t } = useTranslation("features/tickets");
  const [statusId, setStatusId] = useState<string | null>(null);
  const [content, setContent] = useState<PartialBlock[]>(DEFAULT_BLOCK);
  const [editorKey, setEditorKey] = useState(0);
  const [notificationSuppression, setNotificationSuppression] =
    useState<TicketNotificationSuppressionValue>(
      defaultNotificationSuppression,
    );
  const formId = `${id}-form`;

  const discardEditor = useCallback(() => {
    onClose();
  }, [onClose]);

  const uploadSession = useTicketRichTextUploadSession({
    componentLabel: "TicketResolutionDialog",
    ticketId,
    userId: currentUserId,
    trackDraftUploads: true,
    onDocumentsChanged: onClipboardImageUploaded,
    onDiscard: discardEditor,
    uploadDocumentAction: uploadTicketAttachmentAction,
    deleteDraftClipboardImagesAction: deleteDraftTicketAttachmentImagesAction,
    resolveDocumentViewUrl: resolveTicketAttachmentViewUrl,
  });
  const resetDraftTracking = uploadSession.resetDraftTracking;

  useEffect(() => {
    if (isOpen) {
      setStatusId(statusOptions.length === 1 ? statusOptions[0].value : null);
      setContent(DEFAULT_BLOCK);
      setEditorKey((currentKey) => currentKey + 1);
      setNotificationSuppression(defaultNotificationSuppression());
      resetDraftTracking();
    }
  }, [isOpen, resetDraftTracking, statusOptions]);

  const hasContent = JSON.stringify(content) !== JSON.stringify(DEFAULT_BLOCK);
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!statusId || !hasContent || isSubmitting) return;
    uploadSession.resetDraftTracking();
    onConfirm(statusId, content, notificationSuppression);
  };

  const footer = (
    <div className="flex justify-end gap-2">
      <Button
        id={`${id}-cancel`}
        type="button"
        variant="ghost"
        onClick={uploadSession.requestDiscard}
        disabled={isSubmitting}
      >
        {t("actions.cancel", "Cancel")}
      </Button>
      <Button
        id={`${id}-confirm`}
        type="button"
        disabled={!statusId || !hasContent || isSubmitting}
        onClick={() =>
          (
            document.getElementById(formId) as HTMLFormElement | null
          )?.requestSubmit()
        }
      >
        {isSubmitting
          ? t("info.closing", "Closing…")
          : t("info.resolveAndClose", "Resolve and close")}
      </Button>
    </div>
  );

  return (
    <>
      <Dialog
        id={id}
        isOpen={isOpen}
        onClose={uploadSession.requestDiscard}
        title={t("info.closeTicketTitle", "Close ticket")}
        className="max-w-2xl"
        footer={footer}
      >
        <DialogContent>
          <form id={formId} className="space-y-4" onSubmit={handleSubmit}>
            <p className="mb-4 text-sm text-[rgb(var(--color-text-600))]">
              {t(
                "info.closeTicketResolutionPrompt",
                "Choose a close status and add a resolution for this ticket.",
              )}
            </p>
            <CustomSelect
              id={`${id}-status`}
              label={t("conversation.closeStatus", "Close status")}
              value={statusId}
              options={statusOptions}
              onValueChange={setStatusId}
              placeholder={t("info.selectCloseStatus", "Select a close status")}
              required
              disabled={isSubmitting}
            />
            <div>
              <Suspense
                fallback={
                  <RichTextEditorSkeleton
                    height="200px"
                    title={t("conversation.commentEditor", "Comment Editor")}
                  />
                }
              >
                <TextEditor
                  id={`${id}-resolution`}
                  key={editorKey}
                  initialContent={DEFAULT_BLOCK}
                  onContentChange={setContent}
                  searchMentions={searchUsersForMentions}
                  uploadFile={uploadSession.uploadFile}
                  autoFocus
                />
              </Suspense>
            </div>
            <TicketNotificationSuppressionControl
              idPrefix={`${id}-notification-suppression`}
              value={notificationSuppression}
              onChange={setNotificationSuppression}
              disabled={isSubmitting}
            />
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmationDialog
        id={`${id}-clipboard-draft-cancel-dialog`}
        isOpen={uploadSession.showDraftCancelDialog}
        onClose={() => uploadSession.setShowDraftCancelDialog(false)}
        onConfirm={uploadSession.deleteTrackedDraftClipboardImages}
        onCancel={uploadSession.keepDraftClipboardImages}
        title={t(
          "conversation.clipboardDraftCancelTitle",
          "Pasted Images Detected",
        )}
        message={t(
          "conversation.clipboardDraftCancelMessage",
          "This draft includes pasted images that were already uploaded as ticket documents. Keep them, or delete them permanently?",
        )}
        confirmLabel={t("conversation.deleteUploadedImages", "Delete Images")}
        thirdButtonLabel={t("conversation.keepUploadedImages", "Keep Images")}
        cancelLabel={t("common.continueEditing", "Continue Editing")}
        isConfirming={uploadSession.isDeletingDraftImages}
      />
    </>
  );
}
