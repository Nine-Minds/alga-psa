'use client';

import React, { useEffect, useState } from 'react';
import { useTranslation } from '@/lib/i18n/client';
import { Lock } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import TaskComment from './TaskComment';
import { TaskCommentForm } from './TaskCommentForm';
import { getTaskComments } from '@/lib/actions/project-actions/projectTaskCommentActions';
import { IProjectTaskCommentWithUser } from '@/interfaces/projectTaskComment.interface';
import { withDataAutomationId } from '@/types/ui-reflection/withDataAutomationId';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';

interface TaskCommentThreadProps {
  taskId: string;
  projectId: string;
}

export const TaskCommentThread: React.FC<TaskCommentThreadProps> = ({
  taskId,
  projectId
}) => {
  const { t } = useTranslation('common');
  const [comments, setComments] = useState<IProjectTaskCommentWithUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | undefined>();

  const loadComments = async () => {
    try {
      setIsLoading(true);
      const fetchedComments = await getTaskComments(taskId);
      setComments(fetchedComments);
    } catch (error) {
      console.error('Failed to load comments:', error);
      // TODO: Show error toast
    } finally {
      setIsLoading(false);
    }
  };

  const loadCurrentUser = async () => {
    try {
      const user = await getCurrentUser();
      setCurrentUserId(user?.user_id);
    } catch (error) {
      console.error('Failed to load current user:', error);
    }
  };

  useEffect(() => {
    loadComments();
    loadCurrentUser();
  }, [taskId]);

  const handleCommentAdded = () => {
    loadComments();
  };

  const handleCommentUpdated = () => {
    loadComments();
  };

  const handleCommentDeleted = () => {
    loadComments();
  };

  return (
    <div
      {...withDataAutomationId({ id: `task-comment-thread-${taskId}` })}
      className="space-y-4"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3
          {...withDataAutomationId({ id: 'task-comments-title' })}
          className="text-lg font-semibold text-gray-900"
        >
          {t('projects.task.comments.title', 'Comments')}
        </h3>
        <Badge
          {...withDataAutomationId({ id: 'task-comments-internal-badge' })}
          variant="secondary"
          className="flex items-center gap-1"
        >
          <Lock className="h-3 w-3" />
          {t('projects.task.comments.internal_only', 'Internal Only')}
        </Badge>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div
          {...withDataAutomationId({ id: 'task-comments-loading' })}
          className="text-center py-8 text-gray-500"
        >
          {t('common.loading', 'Loading...')}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && comments.length === 0 && (
        <div
          {...withDataAutomationId({ id: 'task-comments-empty' })}
          className="text-center py-8 text-gray-500"
        >
          {t('projects.task.comments.empty', 'No comments yet. Be the first to comment!')}
        </div>
      )}

      {/* Comments List */}
      {!isLoading && comments.length > 0 && (
        <div
          {...withDataAutomationId({ id: 'task-comments-list' })}
          className="space-y-3"
        >
          {comments.map((comment) => (
            <TaskComment
              key={comment.taskCommentId}
              comment={comment}
              onUpdate={handleCommentUpdated}
              onDelete={handleCommentDeleted}
              currentUserId={currentUserId}
            />
          ))}
        </div>
      )}

      {/* Comment Form */}
      <div
        {...withDataAutomationId({ id: 'task-comment-form-container' })}
        className="border-t pt-4"
      >
        <TaskCommentForm
          taskId={taskId}
          projectId={projectId}
          onCommentAdded={handleCommentAdded}
        />
      </div>
    </div>
  );
};

export default TaskCommentThread;
