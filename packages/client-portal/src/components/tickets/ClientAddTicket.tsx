'use client';

/* eslint-disable custom-rules/no-feature-to-feature-imports -- Client portal ticket creation intentionally composes ticket feature actions for customer-submitted requests. */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { toast } from 'react-hot-toast';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import Spinner from '@alga-psa/ui/components/Spinner';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Link2, Paperclip, X } from 'lucide-react';
import { createClientTicket, finalizeClientTicketDescription } from '@alga-psa/client-portal/actions';
import { getClientTicketFormData, getClientTicketPrioritiesForBoard } from '@alga-psa/tickets/actions/ticketFormActions';
import { IPriority, IBoard, ITicket } from '@alga-psa/types';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Input } from '@alga-psa/ui/components/Input';
import { TextEditor } from '@alga-psa/ui/editor';
import {
  parseTicketRichTextContent,
  removeTicketRichTextImageUrls,
  replaceTicketRichTextImageUrls,
  resolveDocumentViewUrl,
  serializeTicketRichTextContent,
} from '@alga-psa/tickets/lib';
import { useQuickAddRichTextUploadSession } from '@alga-psa/tickets/components/useQuickAddRichTextUploadSession';
import type { PartialBlock } from '@blocknote/core';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
  UserFacingError,
} from '@alga-psa/ui/lib/errorHandling';

const isReturnedActionError = (value: unknown) =>
  isActionMessageError(value) || isActionPermissionError(value);

function blockNoteHasText(blocks: PartialBlock[]): boolean {
  for (const block of blocks) {
    const content = (block as { content?: unknown }).content;
    if (Array.isArray(content)) {
      for (const node of content) {
        if (node && typeof node === 'object' && 'text' in node) {
          const text = (node as { text?: unknown }).text;
          if (typeof text === 'string' && text.trim().length > 0) {
            return true;
          }
        }
      }
    }
    const children = (block as { children?: PartialBlock[] }).children;
    if (Array.isArray(children) && blockNoteHasText(children)) {
      return true;
    }
  }
  return false;
}

interface ClientAddTicketProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTicketAdded?: () => void;
  /** When provided, the created ticket is linked to this asset via asset_associations. */
  assetId?: string;
  /** Optional asset display name; shown in a banner so the user knows which device they're filing about. */
  assetName?: string;
}

export function ClientAddTicket({
  open,
  onOpenChange,
  onTicketAdded,
  assetId,
  assetName,
}: ClientAddTicketProps) {
  const { t } = useTranslation('features/tickets');
  const { t: tCommon } = useTranslation('common');
  const noBoardsAvailableMessage = t(
    'create.noBoardsAvailable',
    'No ticket boards are available for your account. Contact your administrator.'
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [title, setTitle] = useState('');
  const [descriptionContent, setDescriptionContent] = useState<PartialBlock[]>(() =>
    parseTicketRichTextContent('')
  );
  const [descriptionEditorInstanceKey, setDescriptionEditorInstanceKey] = useState(0);
  const [priorityId, setPriorityId] = useState('');
  const [priorities, setPriorities] = useState<IPriority[]>([]);
  const [boards, setBoards] = useState<IBoard[]>([]);
  const [boardId, setBoardId] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const { data: session } = useSession();
  const userId = session?.user?.id;

  // An image pasted into the description has no ticket to belong to yet, so it is
  // staged as a local object URL and uploaded once the ticket exists.
  const descriptionUploadSession = useQuickAddRichTextUploadSession({
    componentLabel: 'ClientAddTicket',
    onDiscard: () => {
      resetForm();
      onOpenChange(false);
    },
  });
  const stagedClipboardImages = descriptionUploadSession.stagedClipboardImages;

  useEffect(() => {
    if (!open) {
      setIsSubmitting(false);
      setIsLoading(false);
      resetForm();
      return;
    }

    const fetchData = async () => {
      setIsLoading(true);
      try {
        const formData = await getClientTicketFormData();
        const portalBoards = formData.boards as IBoard[] | undefined;
        const mappedBoards = portalBoards || [];
        setBoards(mappedBoards);
        setPriorities(formData.priorities as IPriority[]);
        // The loader orders the tenant default first and loads its priorities.
        const preselected = mappedBoards.find((board) => board.is_default) ?? mappedBoards[0];
        setBoardId(preselected?.board_id ?? '');
      } catch (error) {
        console.error('Error fetching form data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
    // Only an open/close transition reloads the form; resetForm is re-created every
    // render and would otherwise refetch the boards on each keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleBoardChange = async (nextBoardId: string) => {
    setBoardId(nextBoardId);
    if (!nextBoardId || nextBoardId === boardId) return;
    // Boards can carry different priority types, so the priority list follows the board.
    setPriorityId('');
    try {
      setPriorities(await getClientTicketPrioritiesForBoard(nextBoardId));
    } catch (error) {
      console.error('Error fetching priorities for board:', error);
      setPriorities([]);
    }
  };

  const clearErrorIfSubmitted = () => {
    if (hasAttemptedSubmit) {
      setError(null);
    }
  };

  const resetForm = () => {
    setTitle('');
    setDescriptionContent(parseTicketRichTextContent(''));
    setDescriptionEditorInstanceKey((prev) => prev + 1);
    setPriorityId('');
    setAttachments([]);
    setError(null);
    setHasAttemptedSubmit(false);
    descriptionUploadSession.resetDraftTracking();
  };

  // Staged images carry their own discard confirmation, so closing goes through it.
  const handleClose = () => {
    descriptionUploadSession.requestDiscard();
  };

  const validateForm = () => {
    const validationErrors: string[] = [];
    if (!title.trim()) validationErrors.push(t('create.errors.titleRequired'));
    // A screenshot on its own is a description: pasted images hold no text, and
    // asking for a sentence first is exactly what customers were tripping over.
    if (!blockNoteHasText(descriptionContent) && stagedClipboardImages.length === 0) {
      validationErrors.push(t('create.errors.descriptionRequired'));
    }
    if (!priorityId) validationErrors.push(t('create.errors.priorityRequired'));
    if (boards.length > 0 && !boardId) validationErrors.push(t('create.errors.boardRequired'));
    if (boards.length === 0) validationErrors.push(noBoardsAvailableMessage);
    return validationErrors;
  };

  const mapCreateTicketError = (message: string) => {
    const errorMap: Record<string, string> = {
      'Failed to create ticket': t('messages.failedToCreateTicket'),
      'Contact not associated with a client': t('messages.contactNotAssociatedWithClient'),
      'User not associated with a contact': t('messages.userNotAssociatedWithContact'),
      'Not authenticated': t('messages.notAuthenticated'),
      'User ID not found in session': t('messages.userNotFound'),
      'Tenant not found in session. Please log out and log back in.': t('messages.tenantNotFound'),
      'Selected visibility group does not allow any boards': noBoardsAvailableMessage,
    };

    return errorMap[message] || message;
  };

  // Uploads every staged image against the created ticket and persists the
  // description that points at the uploaded documents instead of the object URLs.
  const finalizeDescriptionForCreatedTicket = async (ticketId: string) => {
    if (!userId) {
      throw new Error(t('quickAdd.clipboardUploadSessionRequired', 'User session is required for clipboard image upload.'));
    }

    const replacementUrls = new Map<string, string>();
    const { uploadDocument } = await import('@alga-psa/documents/actions/documentActions');

    for (const stagedImage of stagedClipboardImages) {
      const fileFormData = new FormData();
      fileFormData.append('file', stagedImage.file);

      const uploadResult = await uploadDocument(fileFormData, { userId, ticketId });

      if (isActionPermissionError(uploadResult)) {
        throw new Error(uploadResult.permissionError || t('quickAdd.clipboardUploadFailed', 'Clipboard image upload failed.'));
      }

      if (!uploadResult.success) {
        throw new Error(uploadResult.error || t('quickAdd.clipboardUploadFailed', 'Clipboard image upload failed.'));
      }

      replacementUrls.set(stagedImage.url, resolveDocumentViewUrl(uploadResult.document));
    }

    const finalizeResult = await finalizeClientTicketDescription(
      ticketId,
      serializeTicketRichTextContent(
        replaceTicketRichTextImageUrls(descriptionContent, replacementUrls)
      )
    );
    if (isReturnedActionError(finalizeResult)) {
      throw new Error(getErrorMessage(finalizeResult));
    }
  };

  // Returns the names of files that failed to upload. Never throws.
  const uploadAttachmentsForTicket = async (ticketId: string): Promise<string[]> => {
    if (!userId) {
      return attachments.map((file) => file.name);
    }

    const failed: string[] = [];
    const { uploadDocument } = await import('@alga-psa/documents/actions/documentActions');
    for (const file of attachments) {
      try {
        const fileFormData = new FormData();
        fileFormData.append('file', file);
        const uploadResult = await uploadDocument(fileFormData, { userId, ticketId });
        if (isActionPermissionError(uploadResult) || !uploadResult.success) {
          failed.push(file.name);
        }
      } catch (uploadError) {
        console.error(`Failed to upload attachment ${file.name}:`, uploadError);
        failed.push(file.name);
      }
    }
    return failed;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setHasAttemptedSubmit(true);

    try {
      const validationErrors = validateForm();
      if (validationErrors.length > 0) {
        throw new UserFacingError(validationErrors.join('\n'));
      }

      // The create call cannot carry object URLs: their documents only exist once
      // the ticket does, so the images are dropped here and replayed afterwards.
      const descriptionForCreate = stagedClipboardImages.length > 0
        ? removeTicketRichTextImageUrls(
            descriptionContent,
            new Set(stagedClipboardImages.map((image) => image.url))
          )
        : descriptionContent;

      const formData = new FormData();
      formData.append('title', title);
      formData.append('description', serializeTicketRichTextContent(descriptionForCreate));
      formData.append('priority_id', priorityId);
      if (boardId) {
        formData.append('board_id', boardId);
      }
      if (assetId) {
        formData.append('asset_id', assetId);
      }

      const result = await createClientTicket(formData);
      if (isReturnedActionError(result)) {
        setError(mapCreateTicketError(getErrorMessage(result)));
        return;
      }

      const createdTicketId = (result as ITicket).ticket_id;

      // Uploads happen after the ticket exists, outside its transaction, one file
      // at a time: a failed file never costs the customer the ticket they filed.
      if (createdTicketId && stagedClipboardImages.length > 0) {
        try {
          await finalizeDescriptionForCreatedTicket(createdTicketId);
        } catch (descriptionFinalizeError) {
          console.error('Failed to finalize client ticket description:', descriptionFinalizeError);
          toast.error(t('quickAdd.clipboardUploadPartialFailure', 'Ticket created, but pasted images could not be attached to the description.'));
        }
      }

      if (createdTicketId && attachments.length > 0) {
        const failedFiles = await uploadAttachmentsForTicket(createdTicketId);
        if (failedFiles.length > 0) {
          toast.error(t('quickAdd.attachmentsPartialFailure', {
            defaultValue: 'Ticket created, but these files could not be attached: {{files}}. Add them from the ticket.',
            files: failedFiles.join(', '),
          }), { duration: 10000 });
        }
      }

      resetForm();
      onOpenChange(false);
      onTicketAdded?.();
    } catch (error) {
      console.error('Error creating ticket:', error);
      // Only the returned-action-error branch above carries user-safe text; a thrown
      // error may hold server detail, so it gets the generic message.
      setError(error instanceof UserFacingError ? error.message : t('create.errors.createFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const memoizedPriorityOptions = useMemo(
    () =>
      priorities.map((priority) => ({
        value: priority.priority_id,
        label: priority.priority_name
      })),
    [priorities]
  );

  const memoizedBoardOptions = useMemo(
    () =>
      boards
        .filter((board): board is IBoard & { board_id: string; board_name: string } =>
          typeof board.board_id === 'string' && typeof board.board_name === 'string'
        )
        .map((board) => ({
          value: board.board_id,
          label: board.board_name
        })),
    [boards]
  );

  const footer = !isLoading ? (
    <div className="flex justify-end space-x-2">
      <Button
        id="cancel-ticket-button"
        type="button"
        variant="outline"
        onClick={handleClose}
      >
        {tCommon('common.cancel')}
      </Button>
      <Button
        id="submit-ticket-button"
        type="button"
        variant="default"
        disabled={isSubmitting || boards.length === 0}
        onClick={() => (document.getElementById('client-add-ticket-form') as HTMLFormElement | null)?.requestSubmit()}
      >
        {isSubmitting ? t('create.submitting') : t('create.submit')}
      </Button>
    </div>
  ) : undefined;

  return (
    <>
    <Dialog
      isOpen={open}
      onClose={handleClose}
      title={t('create.title')}
      footer={footer}
    >
      <DialogContent className="max-w-2xl">
        {isLoading ? (
          <div className="flex items-center justify-center p-6">
            <Spinner size="sm" />
          </div>
        ) : (
          <>
            {hasAttemptedSubmit && error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {assetId && (
              <div className="flex pb-2">
                <Badge
                  variant="secondary"
                  className="inline-flex items-center gap-1.5 rounded-full"
                  data-testid="client-add-ticket-asset-pill"
                >
                  <Link2 className="h-3 w-3" />
                  {assetName
                    ? t('create.linkedToAsset', {
                        defaultValue: 'Linked asset: {{name}}',
                        name: assetName,
                      })
                    : t('create.linkedToAssetGeneric', {
                        defaultValue: 'Linked asset',
                      })}
                </Badge>
              </div>
            )}

            <form id="client-add-ticket-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
              <Input
                id="client-ticket-title"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  clearErrorIfSubmitted();
                }}
                placeholder={t('create.titlePlaceholder')}
              />

              <div className="min-w-0 w-full">
                <TextEditor
                  key={`client-ticket-description-editor-${open ? descriptionEditorInstanceKey : 'closed'}`}
                  id="client-ticket-description"
                  initialContent={descriptionContent}
                  onContentChange={(content) => {
                    setDescriptionContent(content);
                    clearErrorIfSubmitted();
                  }}
                  placeholder={t('create.descriptionPlaceholder')}
                  uploadFile={descriptionUploadSession.uploadFile}
                />
              </div>

              {boards.length > 0 ? (
                <div className="relative z-10">
                  <CustomSelect
                    id="client-ticket-board"
                    value={boardId}
                    onValueChange={(value) => {
                      handleBoardChange(value);
                      clearErrorIfSubmitted();
                    }}
                    options={memoizedBoardOptions}
                    placeholder={t('create.boardPlaceholder')}
                  />
                </div>
              ) : (
                <Alert>
                  <AlertDescription>{noBoardsAvailableMessage}</AlertDescription>
                </Alert>
              )}

              <div className="relative z-10">
                <CustomSelect
                  id="client-ticket-priority"
                  value={priorityId}
                  onValueChange={(value) => {
                    setPriorityId(value);
                    clearErrorIfSubmitted();
                  }}
                  options={memoizedPriorityOptions}
                  placeholder={t('create.priorityPlaceholder')}
                />
              </div>

              <div
                id="client-add-ticket-attachments-section"
                className="space-y-2"
                data-testid="client-add-ticket-attachments"
              >
                <div className="text-sm font-medium text-gray-700">
                  {t('quickAdd.attachments.heading', 'Attachments')}
                </div>
                <input
                  ref={attachmentInputRef}
                  id="client-add-ticket-attachments-input"
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const picked = Array.from(e.target.files ?? []);
                    if (picked.length > 0) setAttachments((current) => [...current, ...picked]);
                    e.target.value = '';
                  }}
                />
                <Button
                  id="client-add-ticket-attachments-add"
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => attachmentInputRef.current?.click()}
                  disabled={isSubmitting}
                >
                  <Paperclip className="h-4 w-4 mr-1" />
                  {t('quickAdd.attachments.add', 'Add files')}
                </Button>
                {attachments.length > 0 && (
                  <ul className="space-y-1" id="client-add-ticket-attachments-list">
                    {attachments.map((file, index) => (
                      <li
                        key={`${index}-${file.name}-${file.size}`}
                        className="flex items-center gap-2 text-sm text-gray-700"
                      >
                        <span className="truncate">{file.name}</span>
                        <Button
                          id={`client-add-ticket-attachment-remove-${index}`}
                          type="button"
                          variant="icon"
                          size="icon"
                          aria-label={t('quickAdd.attachments.remove', { defaultValue: 'Remove {{name}}', name: file.name })}
                          onClick={() => setAttachments((current) => current.filter((_, candidate) => candidate !== index))}
                          disabled={isSubmitting}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
    {descriptionUploadSession.showDraftCancelDialog && (
    <ConfirmationDialog
      id="client-add-ticket-description-clipboard-draft-cancel-dialog"
      isOpen
      onClose={() => descriptionUploadSession.setShowDraftCancelDialog(false)}
      onConfirm={descriptionUploadSession.deleteTrackedDraftClipboardImages}
      title={t('conversation.clipboardDraftCancelTitle', 'Pasted Images Detected')}
      message={t('quickAdd.clipboardDraftMessage', 'This quick-add description includes pasted images that have not been attached to a saved ticket yet. Continue editing, or delete the staged images and close?')}
      confirmLabel={t('conversation.deleteUploadedImages', 'Delete Images')}
      cancelLabel={t('quickAdd.continueEditing', 'Continue Editing')}
      isConfirming={descriptionUploadSession.isDeletingDraftImages}
    />
    )}
    </>
  );
}
