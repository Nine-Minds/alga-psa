'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { PartialBlock } from '@blocknote/core';
import { RichTextViewer, TextEditor } from '@alga-psa/ui/editor';
import { Pencil, Trash, Lock, CheckCircle } from 'lucide-react';
import UserAvatar from '@alga-psa/ui/components/UserAvatar';
import ContactAvatar from '@alga-psa/ui/components/ContactAvatar';
import { IComment } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { withDataAutomationId } from '@alga-psa/ui/ui-reflection/withDataAutomationId';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { searchUsersForMentions } from '@alga-psa/users/actions';

interface CommentItemProps {
  id?: string;
  conversation: IComment;
  user: {
    first_name: string;
    last_name: string;
    user_id: string;
    email?: string;
  } | null;
  currentUserId?: string | null;
  isEditing: boolean;
  currentComment: IComment | null;
  ticketId: string;
  userMap: Record<string, { first_name: string; last_name: string; user_id: string; email?: string; user_type: string; avatarUrl: string | null }>;
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
  currentUserId,
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
  const { t } = useTranslation('clientPortal');
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [editedContent, setEditedContent] = useState<PartialBlock[]>(() => {
    const noteContent = conversation.note || '';
    // Check if content looks like JSON array before parsing
    if (noteContent.trim().startsWith('[')) {
      try {
        const parsedContent = JSON.parse(noteContent);
        if (Array.isArray(parsedContent) && parsedContent.length > 0) {
          return parsedContent;
        }
      } catch (e) {
        // Log malformed JSON for debugging - shouldn't happen with valid BlockNote content
        console.error('[CommentItem] Failed to parse initial comment note as JSON:', {
          comment_id: conversation.comment_id,
          noteLength: noteContent.length,
          notePreview: noteContent.substring(0, 100),
          error: e instanceof Error ? e.message : 'Unknown error'
        });
      }
    }

    // Fallback: create a default block with the text (plain text or failed parse)
    return [{
      type: "paragraph",
      props: {
        textAlignment: "left",
        backgroundColor: "default",
        textColor: "default"
      },
      content: [{
        type: "text",
        text: noteContent,
        styles: {}
      }]
    }];
  });

  const commentId = useMemo(() => 
    conversation.comment_id || currentComment?.comment_id || id || 'unknown',
    [conversation.comment_id, currentComment?.comment_id, id]
  );

  const getAuthorName = () => {
    if (conversation.is_system_generated) return 'Bundled update';
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
    if (conversation.is_system_generated) return false;
    return currentUserId === conversation.user_id;
  }, [conversation.user_id, currentUserId]);

  const handleSave = () => {
    const updates: Partial<IComment> = {
      note: JSON.stringify(editedContent)
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
        <TextEditor
          {...withDataAutomationId({ id: `${commentId}-text-editor` })}
          roomName={`ticket-${ticketId}-comment-${currentComment.comment_id}`}
          initialContent={editedContent}
          onContentChange={handleContentChange}
          searchMentions={searchUsersForMentions}
        />

        <div className="flex justify-end space-x-2 mt-1">
          <Button
            id={`${commentId}-save-btn`}
            onClick={handleSave}
            disabled={false}
          >
            {t('tickets.conversation.save', 'Save')}
          </Button>
          <Button
            id={`${commentId}-cancel-btn`}
            variant="outline"
            onClick={onClose}
          >
            {t('tickets.conversation.cancel', 'Cancel')}
          </Button>
        </div>
      </div>
    );
  }, [
    currentComment,
    isEditing,
    commentId,
    ticketId,
    editedContent,
    handleContentChange,
    handleSave,
    onClose,
    t
  ]);

  const authorFirstName = conversation.user_id ? userMap[conversation.user_id]?.first_name || '' : '';
  const authorLastName = conversation.user_id ? userMap[conversation.user_id]?.last_name || '' : '';

  // Reset editor content when entering edit mode - always use conversation.note (persisted value)
  // NOTE: Do NOT depend on currentComment?.note - that would reload unsaved edits after cancel.
  // We intentionally only use conversation.note (the persisted value from the database).
  useEffect(() => {
    if (isEditing && currentComment?.comment_id === conversation.comment_id) {
      const noteContent = conversation.note || '';
      // Check if content looks like JSON array before parsing to avoid unnecessary exceptions
      if (noteContent.trim().startsWith('[')) {
        try {
          const parsed = JSON.parse(noteContent);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setEditedContent(parsed);
            return;
          }
        } catch (error) {
          // Log malformed JSON for debugging - this shouldn't happen with valid BlockNote content
          console.error('[CommentItem] Failed to parse comment note as JSON:', {
            comment_id: conversation.comment_id,
            noteLength: noteContent.length,
            notePreview: noteContent.substring(0, 100),
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
      // Fallback: treat as plain text
      setEditedContent([
        {
          type: "paragraph",
          props: {
            textAlignment: "left",
            backgroundColor: "default",
            textColor: "default"
          },
          content: [
            {
              type: "text",
              text: noteContent,
              styles: {}
            }
          ]
        }
      ]);
    }
  }, [isEditing, currentComment?.comment_id, conversation.comment_id, conversation.note]);


  return (
    <div {...withDataAutomationId({ id: commentId })} className="rounded-lg p-2 mb-2 shadow-sm border border-gray-200 hover:border-gray-300 bg-white">
      <div className="flex items-start mb-1">
        <div className="mr-2">
          {/* Conditionally render UserAvatar or ContactAvatar */}
          {conversation.user_id && userMap[conversation.user_id] ? (
            userMap[conversation.user_id].user_type === 'internal' ? (
              <UserAvatar
                {...withDataAutomationId({ id: `${commentId}-avatar` })}
                userId={conversation.user_id || ''}
                userName={`${authorFirstName} ${authorLastName}`}
                avatarUrl={userMap[conversation.user_id]?.avatarUrl || null}
                size="md"
              />
            ) : (
              <ContactAvatar
                {...withDataAutomationId({ id: `${commentId}-avatar` })}
                contactId={conversation.user_id || ''}
                contactName={`${authorFirstName} ${authorLastName}`}
                avatarUrl={userMap[conversation.user_id]?.avatarUrl || null}
                size="md"
              />
            )
          ) : (
            <UserAvatar
              {...withDataAutomationId({ id: `${commentId}-avatar` })}
              userId=""
              userName="Unknown User"
              avatarUrl={null}
              size="md"
            />
          )}
        </div>
        <div className="flex-grow">
          <div className="flex justify-between items-start">
            <div>
              <div className="flex items-center gap-2">
                <p {...withDataAutomationId({ id: `${commentId}-author-name` })} className="font-semibold text-gray-800">
                  {getAuthorName()}
                </p>
                {conversation.is_internal && (
                  <Tooltip content="Internal Comment">
                    <span {...withDataAutomationId({ id: `${commentId}-internal-badge` })}>
                      <Lock className="h-4 w-4 text-amber-500" />
                    </span>
                  </Tooltip>
                )}
                {conversation.is_resolution && (
                  <Tooltip content="Resolution Comment">
                    <span {...withDataAutomationId({ id: `${commentId}-resolution-badge` })}>
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    </span>
                  </Tooltip>
                )}
              </div>
              <div className="flex flex-col">
                {getAuthorEmail() && (
                  <p {...withDataAutomationId({ id: `${commentId}-author-email` })} className="text-sm text-gray-600">
                    <a href={`mailto:${getAuthorEmail()}`} className="hover:text-indigo-600">
                      {getAuthorEmail()}
                    </a>
                  </p>
                )}
                <p {...withDataAutomationId({ id: `${commentId}-timestamp` })} className="text-xs text-gray-500">
                  {conversation.created_at && (
                    <span>
                      {new Date(conversation.created_at).toLocaleString()}
                      {conversation.updated_at &&
                       new Date(conversation.updated_at).getTime() > new Date(conversation.created_at).getTime() &&
                       ` (${t('tickets.conversation.edited', 'edited')})`}
                    </span>
                  )}
                </p>
              </div>
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
                  id={`delete-comment-${conversation.comment_id}-button`}
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
            (() => {
              let parsed: PartialBlock[];
              const noteContent = conversation.note || '';
              // Check if content looks like JSON before parsing
              if (noteContent.trim().startsWith('[')) {
                try {
                  const result = JSON.parse(noteContent);
                  parsed = Array.isArray(result) ? result : [];
                } catch (error) {
                  // Log malformed JSON for debugging
                  console.error('[CommentItem] Failed to parse comment note for display:', {
                    comment_id: conversation.comment_id,
                    noteLength: noteContent.length,
                    notePreview: noteContent.substring(0, 100),
                    error: error instanceof Error ? error.message : 'Unknown error'
                  });
                  parsed = [];
                }
              } else {
                parsed = [];
              }
              // If no valid blocks, create fallback with plain text
              if (parsed.length === 0) {
                parsed = [{
                  type: "paragraph",
                  props: {
                    textAlignment: "left",
                    backgroundColor: "default",
                    textColor: "default"
                  },
                  content: [{
                    type: "text",
                    text: noteContent,
                    styles: {}
                  }]
                }];
              }
              if (process.env.NODE_ENV !== 'production') console.log('[CommentItem] render viewer', {
                comment_id: conversation.comment_id,
                updated_at: conversation.updated_at,
                noteLen: (conversation.note || '').length,
                usingArray: Array.isArray(parsed),
                blocks: Array.isArray(parsed) ? (parsed as PartialBlock[]).length : undefined,
              });
              return (
                <div {...withDataAutomationId({ id: `${commentId}-content` })} className="prose max-w-none mt-1">
                  <RichTextViewer 
                    key={`${conversation.comment_id}-${conversation.updated_at || conversation.created_at}`}
                    content={parsed as any} />
                </div>
              );
            })()
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
