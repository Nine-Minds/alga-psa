'use client';

/* eslint-disable custom-rules/no-feature-to-feature-imports -- Client portal ticket creation intentionally composes ticket feature actions for customer-submitted requests. */

import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import Spinner from '@alga-psa/ui/components/Spinner';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Link2 } from 'lucide-react';
import { createClientTicket } from '@alga-psa/client-portal/actions';
import { getClientTicketFormData } from '@alga-psa/tickets/actions/ticketFormActions';
import { IPriority, IBoard } from '@alga-psa/types';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Input } from '@alga-psa/ui/components/Input';
import { TextEditor } from '@alga-psa/ui/editor';
import { parseTicketRichTextContent, serializeTicketRichTextContent } from '@alga-psa/tickets/lib';
import type { PartialBlock } from '@blocknote/core';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

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
        if (mappedBoards.length > 0) {
          setBoardId((mappedBoards[0] as IBoard).board_id ?? '');
        } else {
          setBoardId('');
        }
      } catch (error) {
        console.error('Error fetching form data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [open]);

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
    setError(null);
    setHasAttemptedSubmit(false);
  };

  const handleClose = () => {
    resetForm();
    onOpenChange(false);
  };

  const validateForm = () => {
    const validationErrors: string[] = [];
    if (!title.trim()) validationErrors.push(t('create.errors.titleRequired'));
    if (!blockNoteHasText(descriptionContent)) validationErrors.push(t('create.errors.descriptionRequired'));
    if (!priorityId) validationErrors.push(t('create.errors.priorityRequired'));
    if (boards.length > 0 && !boardId) validationErrors.push(t('create.errors.boardRequired'));
    if (boards.length === 0) validationErrors.push(noBoardsAvailableMessage);
    return validationErrors;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setHasAttemptedSubmit(true);

    try {
      const validationErrors = validateForm();
      if (validationErrors.length > 0) {
        throw new Error(validationErrors.join('\n'));
      }

      const formData = new FormData();
      formData.append('title', title);
      formData.append('description', serializeTicketRichTextContent(descriptionContent));
      formData.append('priority_id', priorityId);
      if (boardId) {
        formData.append('board_id', boardId);
      }
      if (assetId) {
        formData.append('asset_id', assetId);
      }

      await createClientTicket(formData);
      resetForm();
      onOpenChange(false);
      onTicketAdded?.();
    } catch (error) {
      console.error('Error creating ticket:', error);
      // Map backend error messages to translation keys
      let errorMessage = t('create.errors.createFailed');
      if (error instanceof Error) {
        const errorMap: Record<string, string> = {
          'Failed to create ticket': t('messages.failedToCreateTicket'),
          'Contact not associated with a client': t('messages.contactNotAssociatedWithClient'),
          'User not associated with a contact': t('messages.userNotAssociatedWithContact'),
          'Not authenticated': t('messages.notAuthenticated'),
          'User ID not found in session': t('messages.userNotFound'),
          'Tenant not found in session. Please log out and log back in.': t('messages.tenantNotFound'),
          'Selected visibility group does not allow any boards': noBoardsAvailableMessage,
        };
        errorMessage = errorMap[error.message] || error.message;
      }
      setError(errorMessage);
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
                />
              </div>

              {boards.length > 0 ? (
                <div className="relative z-10">
                  <CustomSelect
                    id="client-ticket-board"
                    value={boardId}
                    onValueChange={(value) => {
                      setBoardId(value);
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
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
