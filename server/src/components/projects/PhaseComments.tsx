'use client';

import React, { useState } from 'react';
import { ArrowUpDown, Edit2, Trash2 } from 'lucide-react';
import { IProjectPhaseComment } from 'server/src/interfaces';
import { Button } from 'server/src/components/ui/Button';
import UserAvatar from 'server/src/components/ui/UserAvatar';
import { TextArea } from 'server/src/components/ui/TextArea';

interface PhaseCommentsProps {
  phaseId: string;
  comments: IProjectPhaseComment[];
  userMap: Record<string, { first_name: string; last_name: string; user_id: string; email?: string; user_type: string; avatarUrl: string | null }>;
  currentUser: { id: string; name?: string | null; email?: string | null; avatarUrl?: string | null } | null | undefined;
  onAddComment: (content: string) => Promise<boolean>;
  onEditComment: (commentId: string, content: string) => Promise<void>;
  onDeleteComment: (commentId: string) => Promise<void>;
  isSubmitting?: boolean;
  className?: string;
  isCreateMode?: boolean;
}

const PhaseComments: React.FC<PhaseCommentsProps> = ({
  phaseId,
  comments,
  userMap,
  currentUser,
  onAddComment,
  onEditComment,
  onDeleteComment,
  isSubmitting = false,
  className = "",
  isCreateMode = false
}) => {
  const [showEditor, setShowEditor] = useState(false);
  const [reverseOrder, setReverseOrder] = useState(true);
  const [newCommentContent, setNewCommentContent] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [currentComment, setCurrentComment] = useState<IProjectPhaseComment | null>(null);
  const [editContent, setEditContent] = useState('');

  const handleAddCommentClick = () => {
    setShowEditor(true);
  };

  const handleSubmitComment = async () => {
    if (!newCommentContent.trim()) return;

    try {
      const success = await onAddComment(newCommentContent);

      if (success) {
        setShowEditor(false);
        setNewCommentContent('');
      }
    } catch (error) {
      console.error('Error during comment submission process:', error);
    }
  };

  const handleCancelComment = () => {
    setShowEditor(false);
    setNewCommentContent('');
  };

  const toggleCommentOrder = () => {
    setReverseOrder(!reverseOrder);
  };

  const handleEdit = (comment: IProjectPhaseComment) => {
    setIsEditing(true);
    setCurrentComment(comment);
    setEditContent(comment.note);
  };

  const handleSave = async () => {
    if (currentComment && editContent.trim()) {
      await onEditComment(currentComment.project_phase_comment_id!, editContent);
      setIsEditing(false);
      setCurrentComment(null);
      setEditContent('');
    }
  };

  const handleClose = () => {
    setIsEditing(false);
    setCurrentComment(null);
    setEditContent('');
  };

  const handleDelete = async (comment: IProjectPhaseComment) => {
    if (comment.project_phase_comment_id) {
      await onDeleteComment(comment.project_phase_comment_id);
    }
  };

  const getAuthorInfo = (comment: IProjectPhaseComment) => {
    if (comment.user_id) {
      // First check if we have the user in the userMap
      if (userMap[comment.user_id]) {
        return userMap[comment.user_id];
      }

      // If it's the current user and we're in create mode, use current user info
      if (isCreateMode && comment.user_id === currentUser?.id) {
        return {
          user_id: comment.user_id,
          first_name: currentUser?.name?.split(' ')[0] || 'Current',
          last_name: currentUser?.name?.split(' ').slice(1).join(' ') || 'User',
          email: currentUser?.email || '',
          user_type: 'internal',
          avatarUrl: currentUser?.avatarUrl || null
        };
      }

      // Fallback for unknown users
      return {
        user_id: comment.user_id,
        first_name: 'Unknown',
        last_name: 'User',
        email: '',
        user_type: 'internal',
        avatarUrl: null
      };
    }
    return null;
  };

  const sortedComments = reverseOrder ? [...comments].reverse() : comments;

  return (
    <div className={`border rounded-lg ${className}`}>
      <div className="p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Comments</h2>
          <div className="flex items-center gap-2">
            <button
              id="phase-comments-sort-button"
              type="button"
              onClick={toggleCommentOrder}
              className="flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-700 px-3 py-1 rounded"
            >
              <ArrowUpDown className="w-4 h-4" />
              <span>{reverseOrder ? 'Newest first' : 'Oldest first'}</span>
            </button>
            {!showEditor && (
              <Button
                id="phase-add-comment-button"
                onClick={handleAddCommentClick}
              >
                Add Comment
              </Button>
            )}
          </div>
        </div>

        {/* Add comment form */}
        {showEditor && (
          <div className="mb-6 p-4 border rounded-lg bg-gray-50">
            <div className="flex items-start gap-3">
              <UserAvatar
                userId={currentUser?.id || ''}
                userName={currentUser?.name || ''}
                avatarUrl={userMap[currentUser?.id || '']?.avatarUrl || currentUser?.avatarUrl || null}
                size="md"
              />
              <div className="flex-grow">
                <TextArea
                  id="phase-comment-input"
                  value={newCommentContent}
                  onChange={(e) => setNewCommentContent(e.target.value)}
                  placeholder="Write a comment..."
                  className="mb-3"
                  rows={3}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    id="phase-comment-save-button"
                    onClick={handleSubmitComment}
                    disabled={isSubmitting || !newCommentContent.trim()}
                  >
                    {isSubmitting ? 'Adding...' : 'Add Comment'}
                  </Button>
                  <Button
                    id="phase-comment-cancel-button"
                    onClick={handleCancelComment}
                    variant="outline"
                    disabled={isSubmitting}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Comments list */}
        <div className="space-y-4">
          {sortedComments.map((comment) => {
            const author = getAuthorInfo(comment);
            const isCurrentlyEditing = isEditing && currentComment?.project_phase_comment_id === comment.project_phase_comment_id;

            return (
              <div key={comment.project_phase_comment_id} className="border rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <UserAvatar
                    userId={author?.user_id || ''}
                    userName={`${author?.first_name || ''} ${author?.last_name || ''}`}
                    avatarUrl={author?.avatarUrl || null}
                    size="md"
                  />
                  <div className="flex-grow">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <span className="font-medium text-gray-900">
                          {author?.first_name} {author?.last_name}
                        </span>
                        <span className="text-sm text-gray-500 ml-2">
                          {comment.created_at ? new Date(comment.created_at).toLocaleString() : ''}
                        </span>
                      </div>
                      {comment.user_id === currentUser?.id && (
                        <div className="flex items-center gap-1">
                          <button
                            id="phase-comment-edit-button"
                            type="button"
                            onClick={() => handleEdit(comment)}
                            className="p-1 text-gray-400 hover:text-gray-600"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            id="phase-comment-delete-button"
                            type="button"
                            onClick={() => handleDelete(comment)}
                            className="p-1 text-gray-400 hover:text-red-600"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>

                    {isCurrentlyEditing ? (
                      <div>
                        <TextArea
                          id="phase-comment-edit-input"
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          className="mb-3"
                          rows={3}
                        />
                        <div className="flex justify-end gap-2">
                          <Button
                            id="phase-comment-edit-save-button"
                            onClick={handleSave}
                            disabled={!editContent.trim()}
                            size="sm"
                          >
                            Save
                          </Button>
                          <Button
                            id="phase-comment-edit-cancel-button"
                            onClick={handleClose}
                            variant="outline"
                            size="sm"
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-gray-700 whitespace-pre-wrap">
                        {comment.note}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {comments.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              No comments yet. Be the first to add one!
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PhaseComments;