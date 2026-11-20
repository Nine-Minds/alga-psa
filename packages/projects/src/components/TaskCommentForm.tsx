'use client';

import React, { useState, useRef } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { DEFAULT_BLOCK, hasEditorContent, TextEditor } from '@alga-psa/ui/editor';
import { createTaskComment } from '../actions/projectTaskCommentActions';
import { BlockNoteEditor, PartialBlock } from '@blocknote/core';
import { searchUsersForMentions } from '@alga-psa/user-composition/actions';
import { useTranslation } from 'react-i18next';
import type { CommentAudience } from '@alga-psa/types';
import { useTaskCommentAudience } from '../context/TaskCommentAudienceContext';
import { useDialogSubmitShortcut } from '@alga-psa/ui/keyboard-shortcuts';
import { toast } from 'react-hot-toast';
import { useTaskCommentUploadSession } from './useTaskCommentUploadSession';
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
  userId?: string;
}

export function TaskCommentForm({
  taskId,
  projectId,
  parentCommentId = null,
  onCommentAdded,
  onCancel,
  autoFocus = false,
  userId,
}: TaskCommentFormProps): React.JSX.Element {
  const { t } = useTranslation(['features/projects', 'common']);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const editorRef = useRef<BlockNoteEditor<any, any, any> | null>(null);
  // Present only where the composition layer injects the audience select (a seat technician's screen). A reply takes
  // its thread's audience, so only a new comment asks.
  const audienceSlot = useTaskCommentAudience();
  const asksAudience = audienceSlot !== null && !parentCommentId;
  const [audience, setAudience] = useState<CommentAudience | null>(null);
  const uploadSession = useTaskCommentUploadSession(
    'ProjectTaskCommentForm', taskId, userId, () => onCancel?.(),
  );

  const handleSubmit = async (): Promise<void> => {
    if (!editorRef.current || submittingRef.current || isSubmitting || uploadSession.isUploading || uploadSession.isDeletingDraftImages) {
      return;
    }
    // Without a choice nothing is posted: the author names who can read it (the select says so).
    if (asksAudience && audience === null) {
      return;
    }

    const blocks = editorRef.current.document;

    // Check if editor has any meaningful content
    if (!hasEditorContent(blocks as unknown as PartialBlock[])) {
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);

    try {
      const note = JSON.stringify(blocks);

      const result = await createTaskComment({
        taskId: taskId,
        note,
        parent_comment_id: parentCommentId,
        ...(asksAudience ? { audience } : {}),
      });
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }

      // Clear the editor by replacing content with default empty block
      await uploadSession.reconcileDraftUploads(note);
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
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  useDialogSubmitShortcut(() => { void handleSubmit(); }, {
    enabled: !isSubmitting && !uploadSession.isUploading && !uploadSession.isDeletingDraftImages,
  });

  return (
    <div className="space-y-3">
      <TextEditor
        id="task-comment-editor"
        editorRef={editorRef}
        initialContent={DEFAULT_BLOCK}
        searchMentions={searchUsersForMentions}
        autoFocus={autoFocus}
        uploadFile={uploadSession.uploadFile}
      />
      {asksAudience && audienceSlot.renderSelect({
        id: parentCommentId ? 'task-reply-audience' : 'task-comment-audience',
        audiences: audienceSlot.audiences,
        value: audience,
        onChange: setAudience,
        disabled: isSubmitting,
      })}
      <div className="flex justify-end gap-2">
        <Button
          id="add-task-comment-button"
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleSubmit();
          }}
          disabled={isSubmitting || uploadSession.isUploading || uploadSession.isDeletingDraftImages || (asksAudience && audience === null)}
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
              uploadSession.requestDiscard();
            }}
            disabled={isSubmitting || uploadSession.isUploading || uploadSession.isDeletingDraftImages}
            variant="outline"
          >
            {t('common:actions.cancel', 'Cancel')}
          </Button>
        )}
      </div>
    </div>
  );
}
