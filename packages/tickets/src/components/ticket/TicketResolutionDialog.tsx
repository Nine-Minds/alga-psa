"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { PartialBlock } from "@blocknote/core";
import { Button } from "@alga-psa/ui/components/Button";
import CustomSelect from "@alga-psa/ui/components/CustomSelect";
import { ConfirmationDialog } from "@alga-psa/ui/components/ConfirmationDialog";
import { Dialog, DialogContent } from "@alga-psa/ui/components/Dialog";
import { Label } from "@alga-psa/ui/components/Label";
import { Switch } from "@alga-psa/ui/components/Switch";
import RichTextEditorSkeleton from "@alga-psa/ui/components/skeletons/RichTextEditorSkeleton";
import { useTranslation } from "@alga-psa/ui/lib/i18n/client";
import { searchUsersForMentions } from "@alga-psa/user-composition/actions";
import { createTicketRichTextParagraph } from "../../lib/ticketRichText";
import TicketNotificationSuppressionControl, {
  type TicketNotificationSuppressionValue,
} from "./TicketNotificationSuppressionControl";
import {
  CommentEmailRecipientsControl,
  useCommentEmailRecipientSuggestions,
  useCommentEmailRecipientsDraft,
  type CommentEmailRecipientsPayload,
} from "./CommentEmailRecipientsControl";
import { useTicketRichTextUploadSession } from "./useTicketRichTextUploadSession";

const TextEditor = dynamic(
  () => import("@alga-psa/ui/editor").then((mod) => mod.TextEditor),
  {
    loading: () => <RichTextEditorSkeleton height="200px" />,
    ssr: false,
  },
);

const DEFAULT_RESOLUTION_BLOCK = createTicketRichTextParagraph("");

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
  /** Ticket client, used to suggest its contacts in Cc/Bcc. */
  clientId?: string | null;
  /**
   * Opt-in per-comment Cc/Bcc on the resolution. Off by default so a host that
   * must not email one-off recipients (the client portal) stays unaffected.
   */
  allowEmailRecipients?: boolean;
  onClose: () => void;
  onConfirm: (
    statusId: string,
    contentBlocks: PartialBlock[],
    suppression: TicketNotificationSuppressionValue,
    isInternal: boolean,
    emailRecipients?: CommentEmailRecipientsPayload,
  ) => Promise<boolean>;
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
  clientId,
  allowEmailRecipients = false,
  onClose,
  onConfirm,
  onClipboardImageUploaded,
  uploadTicketAttachmentAction,
  deleteDraftTicketAttachmentImagesAction,
  resolveTicketAttachmentViewUrl,
}: TicketResolutionDialogProps) {
  const { t } = useTranslation("features/tickets");
  const [statusId, setStatusId] = useState<string | null>(null);
  const [content, setContent] = useState<PartialBlock[]>(
    DEFAULT_RESOLUTION_BLOCK,
  );
  const [editorKey, setEditorKey] = useState(0);
  const [isInternal, setIsInternal] = useState(false);
  const [notificationSuppression, setNotificationSuppression] =
    useState<TicketNotificationSuppressionValue>(
      defaultNotificationSuppression,
    );
  // One-off Cc/Bcc for this resolution. The close email carries them, so the
  // agent can copy someone on the message that closes the ticket.
  const emailRecipients = useCommentEmailRecipientsDraft();
  const resetEmailRecipients = emailRecipients.reset;
  const searchEmailRecipients = useCommentEmailRecipientSuggestions(clientId);
  const showEmailRecipients = allowEmailRecipients;
  const emailRecipientsBlockSubmit =
    showEmailRecipients && !isInternal && emailRecipients.hasErrors;
  const formId = `${id}-form`;

  const discardEditor = useCallback(() => {
    onClose();
  }, [onClose]);

  const uploadSession = useTicketRichTextUploadSession({
    commentAttachments: true,
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
      setContent(DEFAULT_RESOLUTION_BLOCK);
      setEditorKey((currentKey) => currentKey + 1);
      setIsInternal(false);
      setNotificationSuppression(defaultNotificationSuppression());
      resetEmailRecipients();
      resetDraftTracking();
    }
  }, [isOpen, resetDraftTracking, resetEmailRecipients, statusOptions]);

  const hasContent =
    JSON.stringify(content) !== JSON.stringify(DEFAULT_RESOLUTION_BLOCK);
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!statusId || !hasContent || isSubmitting || uploadSession.isUploading) return;
    if (emailRecipientsBlockSubmit) return;
    const resolutionSaved = await onConfirm(
      statusId,
      content,
      notificationSuppression,
      isInternal,
      // Never sent with an internal resolution, even though the draft is kept.
      showEmailRecipients && !isInternal ? emailRecipients.payload : undefined,
    );
    if (resolutionSaved) {
      emailRecipients.reset();
      uploadSession.resetDraftTracking();
    }
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
        disabled={
          !statusId
          || !hasContent
          || isSubmitting
          || uploadSession.isUploading
          || emailRecipientsBlockSubmit
        }
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
            {/* Two columns: the status picker and the Internal switch each need
                well under a full line, and the dialog stays short enough to
                read without scrolling. */}
            <div className="grid grid-cols-1 items-start gap-x-3 gap-y-4 sm:grid-cols-2">
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
                <div className="flex items-center gap-2">
                  <Switch
                    id={`${id}-internal-toggle`}
                    checked={isInternal}
                    onCheckedChange={setIsInternal}
                    disabled={isSubmitting}
                  />
                  <Label htmlFor={`${id}-internal-toggle`}>
                    {t("info.markResolutionInternal", "Mark as Internal")}
                  </Label>
                </div>
                <p className="mt-1 text-xs text-[rgb(var(--color-text-600))]">
                  {t(
                    "info.markResolutionInternalHelper",
                    "An internal resolution stays out of the client portal and is left out of the close email.",
                  )}
                </p>
              </div>
            </div>
            {showEmailRecipients && (
              <CommentEmailRecipientsControl
                idPrefix={id}
                variant="rows"
                value={emailRecipients.draft}
                onChange={emailRecipients.setDraft}
                isInternal={isInternal}
                disabled={isSubmitting}
                expanded={emailRecipients.expanded}
                onExpandedChange={emailRecipients.setExpanded}
                searchSuggestions={searchEmailRecipients}
              />
            )}
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
            allowFileAttachments
                  id={`${id}-resolution`}
                  key={editorKey}
                  initialContent={DEFAULT_RESOLUTION_BLOCK}
                  onContentChange={setContent}
                  searchMentions={searchUsersForMentions}
                  uploadFile={uploadSession.uploadFile}
                  footerActions={showEmailRecipients ? (
                    <CommentEmailRecipientsControl
                      idPrefix={id}
                      variant="toggle"
                      value={emailRecipients.draft}
                      onChange={emailRecipients.setDraft}
                      isInternal={isInternal}
                      disabled={isSubmitting}
                      expanded={emailRecipients.expanded}
                      onExpandedChange={emailRecipients.setExpanded}
                    />
                  ) : undefined}
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
