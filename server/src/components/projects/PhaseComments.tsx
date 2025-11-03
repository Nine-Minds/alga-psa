'use client';

import React, { useState, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { Switch } from 'server/src/components/ui/Switch';
import { Label } from 'server/src/components/ui/Label';
import { ArrowUpDown } from 'lucide-react';
import { IComment } from 'server/src/interfaces';
import { PartialBlock } from '@blocknote/core';
import RichTextEditorSkeleton from 'server/src/components/ui/skeletons/RichTextEditorSkeleton';
import { Button } from 'server/src/components/ui/Button';
import UserAvatar from 'server/src/components/ui/UserAvatar';
import CustomTabs from 'server/src/components/ui/CustomTabs';
import CommentItem from '../tickets/ticket/CommentItem';

// Dynamic import for TextEditor
const TextEditor = dynamic(() => import('server/src/components/editor/TextEditor'), {
  loading: () => <RichTextEditorSkeleton height="200px" title="Comment Editor" />,
  ssr: false
});

// Import DEFAULT_BLOCK statically since it's just a constant
export const DEFAULT_BLOCK: PartialBlock[] = [{
  type: "paragraph",
  props: {
    textAlignment: "left",
    backgroundColor: "default",
    textColor: "default"
  },
  content: [{
    type: "text",
    text: "",
    styles: {}
  }]
}];

interface PhaseCommentsProps {
  phaseId: string;
  comments: IComment[];
  userMap: Record<string, { first_name: string; last_name: string; user_id: string; email?: string; user_type: string; avatarUrl: string | null }>;
  currentUser: { id: string; name?: string | null; email?: string | null; avatarUrl?: string | null } | null | undefined;
  onAddComment: (content: PartialBlock[], isInternal: boolean, isResolution: boolean) => Promise<boolean>;
  onEditComment: (commentId: string, updates: Partial<IComment>) => Promise<void>;
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
  const [reverseOrder, setReverseOrder] = useState(false);
  const [isInternalToggle, setIsInternalToggle] = useState(false);
  const [isResolutionToggle, setIsResolutionToggle] = useState(false);
  const [newCommentContent, setNewCommentContent] = useState<PartialBlock[]>(DEFAULT_BLOCK);
  const [editorKey, setEditorKey] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [currentComment, setCurrentComment] = useState<IComment | null>(null);
  const [editContent, setEditContent] = useState<PartialBlock[]>(DEFAULT_BLOCK);
  const [activeTab, setActiveTab] = useState('Client');

  const handleAddCommentClick = () => {
    setShowEditor(true);
  };

  const handleSubmitComment = async () => {
    try {
      const success = await onAddComment(newCommentContent, isInternalToggle, isResolutionToggle);

      if (success) {
        console.log('Comment added successfully, closing editor');
        setShowEditor(false);
        setIsInternalToggle(false);
        setIsResolutionToggle(false);
        setNewCommentContent(DEFAULT_BLOCK);
        setEditorKey(prev => prev + 1);
      } else {
        console.log('Comment addition failed, keeping editor open');
      }
    } catch (error) {
      console.error('Error during comment submission process:', error);
    }
  };

  const handleCancelComment = () => {
    setShowEditor(false);
    setNewCommentContent(DEFAULT_BLOCK);
    setEditorKey(prev => prev + 1);
  };

  const toggleCommentOrder = () => {
    setReverseOrder(!reverseOrder);
  };

  const handleEdit = (comment: IComment) => {
    setIsEditing(true);
    setCurrentComment(comment);
  };

  const handleSave = async (updates: Partial<IComment>) => {
    if (currentComment) {
      await onEditComment(currentComment.comment_id!, updates);
      setIsEditing(false);
      setCurrentComment(null);
    }
  };

  const handleClose = () => {
    setIsEditing(false);
    setCurrentComment(null);
  };

  const handleDelete = async (comment: IComment) => {
    if (comment.comment_id) {
      await onDeleteComment(comment.comment_id);
    }
  };

  const getAuthorInfo = (comment: IComment) => {
    if (comment.user_id) {
      return userMap[comment.user_id] || {
        user_id: comment.user_id,
        first_name: isCreateMode && comment.user_id === currentUser?.id ? 'Current' : 'Unknown',
        last_name: isCreateMode && comment.user_id === currentUser?.id ? 'User' : 'User',
        email: '',
        user_type: 'internal',
        avatarUrl: null
      };
    }
    return null;
  };

  const renderComments = (commentsToRender: IComment[]): JSX.Element[] => {
    const sortedComments = reverseOrder ? [...commentsToRender].reverse() : commentsToRender;

    return sortedComments.map((comment): JSX.Element => {
      const itemKey = `${comment.comment_id}-${comment.updated_at || ''}-${(comment.note || '').length}`;

      return (
        <CommentItem
          key={itemKey}
          id={`phase-comment-${comment.comment_id}`}
          conversation={comment}
          user={getAuthorInfo(comment)}
          currentUserId={currentUser?.id}
          isEditing={isEditing && currentComment?.comment_id === comment.comment_id}
          currentComment={currentComment}
          ticketId={phaseId}
          userMap={userMap}
          onContentChange={setEditContent}
          onSave={handleSave}
          onClose={handleClose}
          onEdit={() => handleEdit(comment)}
          onDelete={handleDelete}
        />
      );
    });
  };

  // Build tab content array
  const tabContent = [
    {
      label: 'Client',
      content: (
        <div>
          {renderComments(comments.filter(comment => !comment.is_internal))}
        </div>
      )
    },
    {
      label: 'Internal',
      content: (
        <div>
          <h3 className="text-lg font-medium mb-4">Internal Comments</h3>
          {renderComments(comments.filter(comment => comment.is_internal))}
        </div>
      )
    },
    {
      label: 'Resolution',
      content: (
        <div>
          <h3 className="text-lg font-medium mb-4">Resolution Comments</h3>
          {renderComments(comments.filter(comment => comment.is_resolution))}
        </div>
      )
    },
    {
      label: 'All Comments',
      content: (
        <div>
          {renderComments(comments)}
        </div>
      )
    }
  ];

  const tabStyles = {
    trigger: "px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 hover:border-gray-300 focus:outline-none focus:text-gray-700 focus:border-gray-300 border-b-2 border-transparent",
    activeTrigger: "data-[state=active]:border-indigo-500 data-[state=active]:text-indigo-600"
  };

  return (
    <div className={`border rounded-lg ${className}`}>
      <div className="p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Comments</h2>
          {!showEditor && (
            <Button
              onClick={handleAddCommentClick}
            >
              Add Comment
            </Button>
          )}
        </div>

        <div className='mb-3'>
          {showEditor && (
            <div className='flex items-start'>
              <div className="mr-2">
                <UserAvatar
                  userId={currentUser?.id || ''}
                  userName={currentUser?.name || ''}
                  avatarUrl={userMap[currentUser?.id || '']?.avatarUrl || currentUser?.avatarUrl || null}
                  size="md"
                />
              </div>
              <div className='flex-grow'>
                {/* Toggle switches above the editor */}
                <div className="flex items-center space-x-4 mb-2 ml-2">
                  <div className="flex items-center space-x-2">
                    <Switch
                      id={`phase-${phaseId}-internal-toggle`}
                      checked={isInternalToggle}
                      onCheckedChange={setIsInternalToggle}
                    />
                    <Label htmlFor={`phase-${phaseId}-internal-toggle`}>
                      {isInternalToggle ? 'Marked as Internal' : 'Mark as Internal'}
                    </Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch
                      id={`phase-${phaseId}-resolution-toggle`}
                      checked={isResolutionToggle}
                      onCheckedChange={setIsResolutionToggle}
                    />
                    <Label htmlFor={`phase-${phaseId}-resolution-toggle`}>
                      {isResolutionToggle ? 'Marked as Resolution' : 'Mark as Resolution'}
                    </Label>
                  </div>
                </div>

                <Suspense fallback={<RichTextEditorSkeleton height="200px" title="Comment Editor" />}>
                  <TextEditor
                    key={editorKey}
                    roomName={`phase-${phaseId}`}
                    initialContent={DEFAULT_BLOCK}
                    onContentChange={setNewCommentContent}
                  />
                </Suspense>

                <div className="flex justify-end space-x-2 mt-1">
                  <Button
                    onClick={handleSubmitComment}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? 'Loading...' : 'Add Comment'}
                  </Button>
                  <Button
                    onClick={handleCancelComment}
                    variant="outline"
                    disabled={isSubmitting}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        <CustomTabs
          tabs={tabContent}
          defaultTab="Client"
          tabStyles={tabStyles}
          onTabChange={setActiveTab}
          extraContent={
            <button
              onClick={toggleCommentOrder}
              className="flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent px-4 py-2 ml-auto"
            >
              <ArrowUpDown className="w-4 h-4" />
              <span>{reverseOrder ? 'Newest first' : 'Oldest first'}</span>
            </button>
          }
        />
      </div>
    </div>
  );
};

export default PhaseComments;