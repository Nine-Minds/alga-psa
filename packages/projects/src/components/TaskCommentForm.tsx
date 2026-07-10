'use client';

import React, { useState, useRef } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { DEFAULT_BLOCK, TextEditor } from '@alga-psa/ui/editor';
import { createTaskComment } from '../actions/projectTaskCommentActions';
import { BlockNoteEditor, PartialBlock } from '@blocknote/core';
import { searchUsersForMentions } from '@alga-psa/user-composition/actions';
import { useTranslation } from 'react-i18next';
import { useDialogSubmitShortcut } from '@alga-psa/ui/keyboard-shortcuts';
import { toast } from 'react-hot-toast';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

interface TaskCommentFormProps {
  taskId: string;
  projectId: string;
  parentCommentId?: string | null;
  onCommentAdded: () => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}

export function TaskCommentForm({
  taskId,
  projectId,
  parentCommentId = null,
  onCommentAdded,
  onCancel,
  autoFocus = false,
}: TaskCommentFormProps): React.JSX.Element {
  const { t } = useTranslation(['features/projects', 'common']);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const editorRef = useRef<BlockNoteEditor<any, any, any> | null>(null);

  const handleSubmit = async (): Promise<void> => {
    if (!editorRef.current || isSubmitting) {
      return;
    }

    const blocks = editorRef.current.document;

    // Check if editor has any meaningful content
    const hasContent = blocks.some((block: any) => {
      if (!block.content || !Array.isArray(block.content)) return false;
      return block.content.some((item: any) => {
        if (item.type === 'text') {
          return item.text?.trim() !== '';
        }
        return true; // Non-text content counts as content
      });
    });

    if (!hasContent) {
      return;
    }

    setIsSubmitting(true);

    try {
      const note = JSON.stringify(blocks);

      const result = await createTaskComment({
        taskId: taskId,
        note,
        parent_comment_id: parentCommentId
      });
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }

      // Clear the editor by replacing content with default empty block
      editorRef.current.replaceBlocks(
        editorRef.current.document,
        DEFAULT_BLOCK
      );

      // Call the callback to notify parent component
      onCommentAdded();
    } catch (error) {
      console.error('Failed to add comment:', error);
      toast.error(t('comments.addFailed', 'Failed to add comment'));
    } finally {
      setIsSubmitting(false);
    }
  };

  useDialogSubmitShortcut(() => { void handleSubmit(); }, { enabled: !isSubmitting });

  return (
    <div className="space-y-3">
      <TextEditor
        id="task-comment-editor"
        editorRef={editorRef}
        initialContent={DEFAULT_BLOCK}
        searchMentions={searchUsersForMentions}
        autoFocus={autoFocus}
      />
      <div className="flex justify-end gap-2">
        <Button
          id="add-task-comment-button"
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleSubmit();
          }}
          disabled={isSubmitting}
          variant="default"
        >
          {isSubmitting
            ? t('comments.submitting', 'Submitting...')
            : parentCommentId
              ? t('comments.reply', 'Reply')
              : t('comments.addComment', 'Add Comment')}
        </Button>
        {onCancel && (
          <Button
            id="cancel-task-comment-button"
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onCancel();
            }}
            disabled={isSubmitting}
            variant="outline"
          >
            {t('common:actions.cancel', 'Cancel')}
          </Button>
        )}
      </div>
    </div>
  );
}
