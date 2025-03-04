'use client';

import React, { useMemo, useState } from 'react';
import { PartialBlock } from '@blocknote/core';
import { extractTextFromBlocks } from 'server/src/lib/utils/textUtils';
import TextEditor from '../editor/TextEditor';
import ReactMarkdown from 'react-markdown';
import { Pencil, Trash } from 'lucide-react';
import { Pencil2Icon, TrashIcon } from '@radix-ui/react-icons';
import AvatarIcon from 'server/src/components/ui/AvatarIcon';
import { IComment } from 'server/src/interfaces/comment.interface';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import UserPicker from 'server/src/components/ui/UserPicker';
import { Button } from 'server/src/components/ui/Button';
import { withDataAutomationId } from 'server/src/types/ui-reflection/withDataAutomationId';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';

interface CommentItemProps {
  id?: string;
  conversation: IComment;
  user: { 
    first_name: string; 
    last_name: string;
    user_id: string;
    email?: string;
  } | null;
  isEditing: boolean;
  currentComment: IComment | null;
  ticketId: string;
  userMap: Record<string, { first_name: string; last_name: string; user_id: string; email?: string; user_type: string; }>;
  onContentChange: (content: PartialBlock[]) => void;
  onSave: (updates: Partial<IComment>) => void;
  onClose: () => void;
  onEdit: (conversation: IComment) => void;
  onDelete: (comment: IComment) => void;
}

const CommentItem: React.FC<CommentItemProps> = ({
  id,
  conversation,
  user,
  isEditing,
  currentComment,
  ticketId,
  userMap,
  onContentChange,
  onSave,
  onClose,
  onEdit,
  onDelete
}) => {
  const [selectedUserId, setSelectedUserId] = useState(conversation.user_id || '');
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [editedContent, setEditedContent] = useState<PartialBlock[]>(() => {
    try {
      // Try to parse the note as JSON
      const parsedContent = JSON.parse(conversation.note || '');
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
        text: conversation.note || '',
        styles: {}
      }]
    }];
  });

  const commentId = useMemo(() => 
    conversation.comment_id || currentComment?.comment_id || id || 'unknown',
    [conversation.comment_id, currentComment?.comment_id, id]
  );

  const getAuthorName = () => {
    if (!conversation.user_id) return 'Unknown User';
    const commentUser = userMap[conversation.user_id];
    if (!commentUser) return 'Unknown User';
    return `${commentUser.first_name} ${commentUser.last_name}${commentUser.user_type === 'client' ? ' (Client)' : ''}`;
  };

  const getAuthorEmail = () => {
    if (!conversation.user_id) return null;
    const commentUser = userMap[conversation.user_id];
    return commentUser?.email;
  };

  // Only allow users to edit their own comments
  const canEdit = useMemo(() => {
    return user?.user_id === conversation.user_id;
  }, [conversation.user_id, user?.user_id]);

  const handleSave = () => {
    const selectedUser = userMap[selectedUserId];
    const updates: Partial<IComment> = {
      note: JSON.stringify(editedContent),
      user_id: selectedUserId,
      author_type: selectedUser?.user_type === 'internal' ? 'internal' : 'client'
    };

    onSave(updates);
  };

  const handleContentChange = (blocks: PartialBlock[]) => {
    setEditedContent(blocks);
    onContentChange(blocks);
  };

  const editorContent = useMemo(() => {
    if (!currentComment || !isEditing) return null;

    return (
      <div>
        <div className="mb-4">
          <UserPicker
            label="Select User"
            value={selectedUserId}
            onValueChange={setSelectedUserId}
            users={Object.entries(userMap).map(([id, user]): IUserWithRoles => ({
              user_id: id,
              username: id,
              first_name: user.first_name,
              last_name: user.last_name,
              email: user.email || '',
              hashed_password: '',
              is_inactive: false,
              tenant: '',
              roles: [],
              created_at: new Date(),
              two_factor_enabled: false,
              is_google_user: false,
              user_type: user.user_type
            }))}
          />
        </div>

        <TextEditor
          {...withDataAutomationId({ id: `${commentId}-text-editor` })}
          roomName={`ticket-${ticketId}-comment-${currentComment.comment_id}`}
          initialContent={editedContent}
          onContentChange={handleContentChange}
        />

        <div className="flex justify-end space-x-2 mt-2">
          <Button
            id={`${commentId}-save-btn`}
            onClick={handleSave}
            disabled={!selectedUserId}
          >
            Save
          </Button>
          <Button
            id={`${commentId}-cancel-btn`}
            variant="outline"
            onClick={onClose}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }, [
    currentComment,
    isEditing,
    selectedUserId,
    commentId,
    ticketId,
    editedContent,
    userMap,
    handleContentChange,
    handleSave,
    onClose
  ]);

  const authorFirstName = conversation.user_id ? userMap[conversation.user_id]?.first_name || '' : '';
  const authorLastName = conversation.user_id ? userMap[conversation.user_id]?.last_name || '' : '';


  return (
    <div {...withDataAutomationId({ id: commentId })} className="bg-gray-50 rounded-lg p-4 mb-4 shadow-sm">
      <div className="flex items-start mb-2">
        <div className="mr-3">
          <AvatarIcon 
            {...withDataAutomationId({ id: `${commentId}-avatar` })}
            userId={conversation.user_id || ''}
            firstName={authorFirstName}
            lastName={authorLastName}
            size="md"
          />
        </div>
        <div className="flex-grow">
          <div className="flex justify-between items-start">
            <div>
              <p {...withDataAutomationId({ id: `${commentId}-author-name` })} className="font-semibold text-gray-800">
                {getAuthorName()}
              </p>
              {getAuthorEmail() && (
                <p {...withDataAutomationId({ id: `${commentId}-author-email` })} className="text-sm text-gray-600">
                  <a href={`mailto:${getAuthorEmail()}`} className="hover:text-indigo-600">
                    {getAuthorEmail()}
                  </a>
                </p>
              )}
            </div>
            {canEdit && (
              <div className="space-x-2">
                <Button
                  id={`edit-comment-${conversation.comment_id}-button`}
                  variant="ghost"
                  onClick={() => onEdit(conversation)}
                  className="text-indigo-600 hover:text-indigo-800 font-medium p-1 rounded-full hover:bg-indigo-100 transition duration-150 ease-in-out"
                  aria-label="Edit comment"
                >
                  <Pencil className="w-4 h-4" />
                </Button>
                <Button
                  id='delete-comment-button'
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
          {isEditing && currentComment?.comment_id === conversation.comment_id ? (
            editorContent
          ) : (
            <div {...withDataAutomationId({ id: `${commentId}-content` })} className="prose max-w-none mt-2">
              <ReactMarkdown>{extractTextFromBlocks(conversation.note || '')}</ReactMarkdown>
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
          onDelete(conversation);
          setIsDeleteDialogOpen(false);
        }}
        title="Delete Comment"
        message="Are you sure you want to delete this comment? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />
    </div>
  );
};

export default CommentItem;
