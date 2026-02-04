'use client';

import React, { useState, useRef } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { DEFAULT_BLOCK, TextEditor } from '@alga-psa/ui/editor';
import { createTaskComment } from '../actions/projectTaskCommentActions';
import { BlockNoteEditor, PartialBlock } from '@blocknote/core';
import { searchUsersForMentions } from '@alga-psa/users/actions';

interface TaskCommentFormProps {
  taskId: string;
  projectId: string;
  onCommentAdded: () => void;
  onCancel?: () => void;
}

export function TaskCommentForm({
  taskId,
  projectId,
  onCommentAdded,
  onCancel
}: TaskCommentFormProps): React.JSX.Element {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const editorRef = useRef<BlockNoteEditor<any, any, any> | null>(null);

  const handleSubmit = async (): Promise<void> => {
    if (!editorRef.current || isSubmitting) {
      return;
    }

    const blocks = editorRef.current.topLevelBlocks;

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

      await createTaskComment({
        taskId: taskId,
        note
      });

      // Clear the editor by replacing content with default empty block
      editorRef.current.replaceBlocks(
        editorRef.current.topLevelBlocks,
        DEFAULT_BLOCK
      );

      // Call the callback to notify parent component
      onCommentAdded();
    } catch (error) {
      console.error('Failed to add comment:', error);
      // You might want to show an error toast/notification here
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-3">
      <TextEditor
        id="task-comment-editor"
        editorRef={editorRef}
        initialContent={DEFAULT_BLOCK}
        searchMentions={searchUsersForMentions}
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
          {isSubmitting ? 'Submitting...' : 'Add Comment'}
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
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
