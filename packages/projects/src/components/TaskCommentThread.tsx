'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { ArrowUpDown, Lock } from 'lucide-react';
import { Badge } from '@alga-psa/ui/components/Badge';
import TaskComment from './TaskComment';
import { TaskCommentForm } from './TaskCommentForm';
import { getTaskComments } from '../actions/projectTaskCommentActions';
import { toggleTaskCommentReaction, getTaskCommentsReactionsBatch } from '../actions/projectTaskCommentReactionActions';
import { IProjectTaskCommentWithUser, IAggregatedReaction } from '@alga-psa/types';
import { withDataAutomationId } from '@alga-psa/ui/ui-reflection/withDataAutomationId';
import { getCurrentUser, getCurrentUserAvatarUrl } from '@alga-psa/user-composition/actions';
import UserAvatar from '@alga-psa/ui/components/UserAvatar';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from 'react-i18next';

interface TaskCommentThreadProps {
  taskId: string;
  projectId: string;
  onCommentCountChange?: (taskId: string, count: number) => void;
}

export const TaskCommentThread: React.FC<TaskCommentThreadProps> = ({
  taskId,
  projectId,
  onCommentCountChange
}) => {
  const { t } = useTranslation(['features/projects', 'common']);
  const [comments, setComments] = useState<IProjectTaskCommentWithUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<{ user_id: string; name: string; avatarUrl: string | null } | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [reverseOrder, setReverseOrder] = useState(false);
  const [reactionsMap, setReactionsMap] = useState<Record<string, IAggregatedReaction[]>>({});
  const [reactionUserNames, setReactionUserNames] = useState<Record<string, string>>({});

  const loadComments = async () => {
    try {
      setIsLoading(true);
      const fetchedComments = await getTaskComments(taskId);
      setComments(fetchedComments);
      onCommentCountChange?.(taskId, fetchedComments.length);
      // Load reactions for fetched comments
      const commentIds = fetchedComments.map(c => c.taskCommentId).filter(Boolean);
      if (commentIds.length > 0) {
        try {
          const { reactions, userNames } = await getTaskCommentsReactionsBatch(commentIds);
          setReactionsMap(reactions);
          setReactionUserNames(prev => ({ ...prev, ...userNames }));
        } catch (err) {
          console.error('Failed to load reactions:', err);
        }
      }
    } catch (error) {
      console.error('Failed to load comments:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadCurrentUser = async () => {
    try {
      const user = await getCurrentUser();
      if (user) {
        const avatarUrl = await getCurrentUserAvatarUrl();

        setCurrentUser({
          user_id: user.user_id,
          name: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
          avatarUrl: avatarUrl
        });
      }
    } catch (error) {
      console.error('Failed to load current user:', error);
    }
  };

  useEffect(() => {
    loadComments();
    loadCurrentUser();
  }, [taskId]);

  const handleCommentAdded = async () => {
    await loadComments();
    setShowEditor(false);
  };

  const handleCommentUpdated = async () => {
    await loadComments();
  };

  const handleCommentDeleted = async () => {
    await loadComments();
  };

  const toggleCommentOrder = () => {
    setReverseOrder(!reverseOrder);
  };

  const handleToggleReaction = useCallback(async (taskCommentId: string, emoji: string) => {
    try {
      const { added } = await toggleTaskCommentReaction(taskCommentId, emoji);
      if (added && currentUser?.user_id && currentUser.name) {
        setReactionUserNames(prev => prev[currentUser.user_id] ? prev : { ...prev, [currentUser.user_id]: currentUser.name });
      }
      const userId = currentUser?.user_id || '';
      setReactionsMap((prev) => {
        const existing = prev[taskCommentId] || [];
        const idx = existing.findIndex((r) => r.emoji === emoji);
        if (idx === -1 && added) {
          return { ...prev, [taskCommentId]: [...existing, { emoji, count: 1, userIds: [userId], currentUserReacted: true }] };
        }
        if (idx !== -1) {
          const reaction = existing[idx];
          if (added) {
            const updated = { ...reaction, count: reaction.count + 1, userIds: [...reaction.userIds, userId], currentUserReacted: true };
            const newArr = [...existing];
            newArr[idx] = updated;
            return { ...prev, [taskCommentId]: newArr };
          } else {
            if (reaction.count <= 1) {
              return { ...prev, [taskCommentId]: existing.filter((_, i) => i !== idx) };
            }
            const updated = { ...reaction, count: reaction.count - 1, userIds: reaction.userIds.filter((id) => id !== userId), currentUserReacted: false };
            const newArr = [...existing];
            newArr[idx] = updated;
            return { ...prev, [taskCommentId]: newArr };
          }
        }
        return prev;
      });
    } catch (err) {
      console.error('Failed to toggle reaction:', err);
    }
  }, [currentUser?.user_id, currentUser?.name]);

  // Sort comments based on reverseOrder
  const sortedComments = [...comments].sort((a, b) => {
    const dateA = new Date(a.createdAt).getTime();
    const dateB = new Date(b.createdAt).getTime();
    return reverseOrder ? dateB - dateA : dateA - dateB;
  });

  return (
    <div
      {...withDataAutomationId({ id: `task-comment-thread-${taskId}` })}
      className="space-y-4"
    >
      {/* Header with Sort Button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3
            {...withDataAutomationId({ id: 'task-comments-title' })}
            className="text-lg font-semibold text-gray-900"
          >
            {t('comments.title', 'Comments')}
          </h3>
          <Badge
            {...withDataAutomationId({ id: 'task-comments-internal-badge' })}
            variant="secondary"
            className="flex items-center gap-1"
          >
            <Lock className="h-3 w-3" />
            {t('comments.internalOnly', 'Internal Only')}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <button
            {...withDataAutomationId({ id: 'task-comments-sort-toggle' })}
            onClick={toggleCommentOrder}
            className="flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-700 px-3 py-1 rounded hover:bg-gray-100"
          >
            <ArrowUpDown className="w-4 h-4" />
            <span>{reverseOrder ? t('comments.newestFirst', 'Newest first') : t('comments.oldestFirst', 'Oldest first')}</span>
          </button>
          {!showEditor && (
            <Button
              id="task-comments-add-button"
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowEditor(true);
              }}
            >
              {t('comments.addComment', 'Add Comment')}
            </Button>
          )}
        </div>
      </div>

      {/* Comment Form at Top (when visible) */}
      {showEditor && (
        <div
          {...withDataAutomationId({ id: 'task-comment-form-container' })}
          className="border rounded-lg p-4 bg-gray-50"
        >
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0">
              <UserAvatar
                {...withDataAutomationId({ id: 'task-comment-current-user-avatar' })}
                userId={currentUser?.user_id || ''}
                userName={currentUser?.name || ''}
                avatarUrl={currentUser?.avatarUrl || null}
                size="md"
              />
            </div>
            <div className="flex-grow">
              <TaskCommentForm
                taskId={taskId}
                projectId={projectId}
                onCommentAdded={handleCommentAdded}
                onCancel={() => setShowEditor(false)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div
          {...withDataAutomationId({ id: 'task-comments-loading' })}
          className="text-center py-8 text-gray-500"
        >
          {t('comments.loading', 'Loading...')}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && comments.length === 0 && (
        <div
          {...withDataAutomationId({ id: 'task-comments-empty' })}
          className="text-center py-8 text-gray-500"
        >
          {t('comments.empty', 'No comments yet. Be the first to comment!')}
        </div>
      )}

      {/* Comments List */}
      {!isLoading && comments.length > 0 && (
        <div
          {...withDataAutomationId({ id: 'task-comments-list' })}
          className="space-y-3"
        >
          {sortedComments.map((comment) => (
            <TaskComment
              key={comment.taskCommentId}
              comment={comment}
              onUpdate={handleCommentUpdated}
              onDelete={handleCommentDeleted}
              currentUserId={currentUser?.user_id}
              reactions={reactionsMap[comment.taskCommentId] || []}
              onToggleReaction={handleToggleReaction}
              userNames={reactionUserNames}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default TaskCommentThread;
