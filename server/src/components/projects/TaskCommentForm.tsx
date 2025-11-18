'use client';

import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from 'server/src/components/ui/button';
import TextEditor, { DEFAULT_BLOCK } from '@/components/editor/TextEditor';
import { createTaskComment } from '@/lib/actions/project-actions/projectTaskCommentActions';
import { BlockNoteEditor, PartialBlock } from '@blocknote/core';

interface TaskCommentFormProps {
  taskId: string;
  projectId: string;
  onCommentAdded: () => void;
}

export function TaskCommentForm({
  taskId,
  projectId,
  onCommentAdded
}: TaskCommentFormProps): JSX.Element {
  const { t } = useTranslation();
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
      />
      <Button
        id="add-task-comment-button"
        onClick={handleSubmit}
        disabled={isSubmitting}
        variant="default"
      >
        {isSubmitting ? t('common.submitting') : t('projects.task.comments.add_comment')}
      </Button>
    </div>
  );
}
