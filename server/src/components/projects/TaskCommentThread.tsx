'use client';

import React, { useEffect, useState } from 'react';
import { ArrowUpDown, Lock } from 'lucide-react';
import { Badge } from 'server/src/components/ui/Badge';
import TaskComment from './TaskComment';
import { TaskCommentForm } from 'server/src/components/projects/TaskCommentForm';
import { getTaskComments } from 'server/src/lib/actions/project-actions/projectTaskCommentActions';
import { IProjectTaskCommentWithUser } from 'server/src/interfaces/projectTaskComment.interface';
import { withDataAutomationId } from 'server/src/types/ui-reflection/withDataAutomationId';
import { getCurrentUser, getCurrentUserAvatarUrl } from 'server/src/lib/actions/user-actions/userActions';
import UserAvatar from 'server/src/components/ui/UserAvatar';
import { Button } from 'server/src/components/ui/Button';

interface TaskCommentThreadProps {
  taskId: string;
  projectId: string;
}

export const TaskCommentThread: React.FC<TaskCommentThreadProps> = ({
  taskId,
  projectId
}) => {
  const [comments, setComments] = useState<IProjectTaskCommentWithUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<{ user_id: string; name: string; avatarUrl: string | null } | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [reverseOrder, setReverseOrder] = useState(false);

  const loadComments = async () => {
    try {
      setIsLoading(true);
      const fetchedComments = await getTaskComments(taskId);
      setComments(fetchedComments);
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

  const handleCommentAdded = () => {
    loadComments();
    setShowEditor(false);
  };

  const handleCommentUpdated = () => {
    loadComments();
  };

  const handleCommentDeleted = () => {
    loadComments();
  };

  const toggleCommentOrder = () => {
    setReverseOrder(!reverseOrder);
  };

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
            Comments
          </h3>
          <Badge
            {...withDataAutomationId({ id: 'task-comments-internal-badge' })}
            variant="secondary"
            className="flex items-center gap-1"
          >
            <Lock className="h-3 w-3" />
            Internal Only
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <button
            {...withDataAutomationId({ id: 'task-comments-sort-toggle' })}
            onClick={toggleCommentOrder}
            className="flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-700 px-3 py-1 rounded hover:bg-gray-100"
          >
            <ArrowUpDown className="w-4 h-4" />
            <span>{reverseOrder ? 'Newest first' : 'Oldest first'}</span>
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
              Add Comment
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
          Loading...
        </div>
      )}

      {/* Empty State */}
      {!isLoading && comments.length === 0 && (
        <div
          {...withDataAutomationId({ id: 'task-comments-empty' })}
          className="text-center py-8 text-gray-500"
        >
          No comments yet. Be the first to comment!
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
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default TaskCommentThread;
