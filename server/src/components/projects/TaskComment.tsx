'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { PartialBlock } from '@blocknote/core';
import { formatDistanceToNow } from 'date-fns';
import { Pencil, Trash } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/client';
import TextEditor from '../editor/TextEditor';
import RichTextViewer from '../editor/RichTextViewer';
import UserAvatar from '../ui/UserAvatar';
import { Button } from '../ui/Button';
import { ConfirmationDialog } from '../ui/ConfirmationDialog';
import { IProjectTaskCommentWithUser } from '@/interfaces/projectTaskComment.interface';
import { updateTaskComment, deleteTaskComment } from '@/lib/actions/project-actions/projectTaskCommentActions';
import { withDataAutomationId } from '@/types/ui-reflection/withDataAutomationId';

interface TaskCommentProps {
  comment: IProjectTaskCommentWithUser;
  onUpdate: () => void;
  onDelete: () => void;
  currentUserId?: string;
}

const TaskComment: React.FC<TaskCommentProps> = ({
  comment,
  onUpdate,
  onDelete,
  currentUserId
}) => {
  const { t } = useTranslation('common');
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editedContent, setEditedContent] = useState<PartialBlock[]>(() => {
    try {
      const parsedContent = JSON.parse(comment.note || '');
      if (Array.isArray(parsedContent) && parsedContent.length > 0) {
        return parsedContent;
      }
    } catch (e) {
      // If parsing fails, continue to the fallback
    }

    // Fallback: create a default block with the text
    return [{
      type: "paragraph",
      props: {
        textAlignment: "left",
        backgroundColor: "default",
        textColor: "default"
      },
      content: [{
        type: "text",
        text: comment.note || '',
        styles: {}
      }]
    }];
  });

  const commentId = useMemo(() =>
    `task-comment-${comment.taskCommentId}`,
    [comment.taskCommentId]
  );

  // Only allow users to edit their own comments
  const canEdit = useMemo(() => {
    return currentUserId === comment.userId;
  }, [comment.userId, currentUserId]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateTaskComment(comment.taskCommentId, {
        note: JSON.stringify(editedContent)
      });
      setIsEditing(false);
      onUpdate();
    } catch (error) {
      console.error('Failed to update comment:', error);
      // TODO: Show error toast
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteTaskComment(comment.taskCommentId);
      onDelete();
    } catch (error) {
      console.error('Failed to delete comment:', error);
      // TODO: Show error toast
    }
  };

  const handleContentChange = (blocks: PartialBlock[]) => {
    setEditedContent(blocks);
  };

  const handleCancelEdit = () => {
    // Reset to original content
    try {
      const parsedContent = JSON.parse(comment.note || '');
      if (Array.isArray(parsedContent) && parsedContent.length > 0) {
        setEditedContent(parsedContent);
      }
    } catch (e) {
      setEditedContent([{
        type: "paragraph",
        props: {
          textAlignment: "left",
          backgroundColor: "default",
          textColor: "default"
        },
        content: [{
          type: "text",
          text: comment.note || '',
          styles: {}
        }]
      }]);
    }
    setIsEditing(false);
  };

  const authorName = `${comment.firstName} ${comment.lastName}`;

  // Check if comment has been edited
  const hasBeenEdited = comment.editedAt &&
    new Date(comment.editedAt).getTime() > new Date(comment.createdAt).getTime();

  // Parse content for display
  const displayContent = useMemo(() => {
    try {
      const parsed = JSON.parse(comment.note || '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed;
    } catch {
      return [{
        type: "paragraph",
        props: {
          textAlignment: "left",
          backgroundColor: "default",
          textColor: "default"
        },
        content: [{
          type: "text",
          text: comment.note || '',
          styles: {}
        }]
      }];
    }
  }, [comment.note]);

  return (
    <div
      {...withDataAutomationId({ id: commentId })}
      className="rounded-lg p-2 mb-2 shadow-sm border border-gray-200 hover:border-gray-300 bg-white"
    >
      <div className="flex items-start mb-1">
        <div className="mr-2">
          <UserAvatar
            {...withDataAutomationId({ id: `${commentId}-avatar` })}
            userId={comment.userId}
            userName={authorName}
            avatarUrl={null}
            size="md"
          />
        </div>
        <div className="flex-grow">
          <div className="flex justify-between items-start">
            <div>
              <div className="flex items-center gap-2">
                <p
                  {...withDataAutomationId({ id: `${commentId}-author-name` })}
                  className="font-semibold text-gray-800"
                >
                  {authorName}
                </p>
              </div>
              <div className="flex flex-col">
                {comment.email && (
                  <p
                    {...withDataAutomationId({ id: `${commentId}-author-email` })}
                    className="text-sm text-gray-600"
                  >
                    <a href={`mailto:${comment.email}`} className="hover:text-indigo-600">
                      {comment.email}
                    </a>
                  </p>
                )}
                <p
                  {...withDataAutomationId({ id: `${commentId}-timestamp` })}
                  className="text-xs text-gray-500"
                >
                  {comment.createdAt && (
                    <span>
                      {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
                      {hasBeenEdited && ` (${t('common.edited', 'edited')})`}
                    </span>
                  )}
                </p>
              </div>
            </div>
            {canEdit && !isEditing && (
              <div className="space-x-2">
                <Button
                  id={`edit-comment-${comment.taskCommentId}-button`}
                  variant="ghost"
                  onClick={() => setIsEditing(true)}
                  className="text-indigo-600 hover:text-indigo-800 font-medium p-1 rounded-full hover:bg-indigo-100 transition duration-150 ease-in-out"
                  aria-label="Edit comment"
                >
                  <Pencil className="w-4 h-4" />
                </Button>
                <Button
                  id={`delete-comment-${comment.taskCommentId}-button`}
                  variant="ghost"
                  onClick={() => setIsDeleteDialogOpen(true)}
                  className="text-red-600 hover:text-red-800 font-medium p-1 rounded-full hover:bg-red-100 transition duration-150 ease-in-out"
                  aria-label="Delete comment"
                >
                  <Trash className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>
          {isEditing ? (
            <div className="mt-2">
              <TextEditor
                {...withDataAutomationId({ id: `${commentId}-text-editor` })}
                roomName={`task-${comment.taskId}-comment-${comment.taskCommentId}`}
                initialContent={editedContent}
                onContentChange={handleContentChange}
              />
              <div className="flex justify-end space-x-2 mt-1">
                <Button
                  id={`${commentId}-save-btn`}
                  onClick={handleSave}
                  disabled={isSaving}
                >
                  {isSaving ? t('common.saving', 'Saving...') : t('common.save', 'Save')}
                </Button>
                <Button
                  id={`${commentId}-cancel-btn`}
                  variant="outline"
                  onClick={handleCancelEdit}
                  disabled={isSaving}
                >
                  {t('common.cancel', 'Cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <div
              {...withDataAutomationId({ id: `${commentId}-content` })}
              className="prose max-w-none mt-1"
            >
              <RichTextViewer
                key={`${comment.taskCommentId}-${comment.updatedAt || comment.createdAt}`}
                content={displayContent as any}
              />
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Dialog for Delete */}
      <ConfirmationDialog
        id={`${commentId}-delete-dialog`}
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={async () => {
          await handleDelete();
          setIsDeleteDialogOpen(false);
        }}
        title={t('common.deleteComment', 'Delete Comment')}
        message={t('common.deleteCommentConfirmation', 'Are you sure you want to delete this comment? This action cannot be undone.')}
        confirmLabel={t('common.delete', 'Delete')}
        cancelLabel={t('common.cancel', 'Cancel')}
      />
    </div>
  );
};

export default TaskComment;
