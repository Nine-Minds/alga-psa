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
import { Switch } from '@alga-psa/ui/components/Switch';
import { Label } from '@alga-psa/ui/components/Label';
import { withDataAutomationId } from '@alga-psa/ui/ui-reflection/withDataAutomationId';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { searchUsersForMentions } from '@alga-psa/users/actions';
import { getCommentResponseSource } from '../../lib/responseSource';
import type { CommentContactAuthor, CommentUserAuthor } from '../../lib/commentAuthorResolution';
import { resolveCommentAuthor } from '../../lib/commentAuthorResolution';
import ResponseSourceBadge from '../ResponseSourceBadge';

interface CommentItemProps {
  id?: string;
  conversation: IComment;
  currentUserId?: string | null;
  isEditing: boolean;
  currentComment: IComment | null;
  ticketId: string;
  userMap: Record<string, CommentUserAuthor>;
  contactMap: Record<string, CommentContactAuthor>;
  onContentChange: (content: PartialBlock[]) => void;
  onSave: (updates: Partial<IComment>) => void;
  onClose: () => void;
  onEdit: (conversation: IComment) => void;
  onDelete: (comment: IComment) => void;
  hideInternalTab?: boolean;
}

const CommentItem: React.FC<CommentItemProps> = ({
  id,
  conversation,
  currentUserId,
  isEditing,
  currentComment,
  ticketId,
  userMap,
  contactMap,
  onContentChange,
  onSave,
  onClose,
  onEdit,
  onDelete,
  hideInternalTab = false
}) => {
  const { t } = useTranslation('clientPortal');
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isInternalToggle, setIsInternalToggle] = useState(conversation.is_internal ?? false);
  const [isResolutionToggle, setIsResolutionToggle] = useState(conversation.is_resolution ?? false);
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

  const resolvedAuthor = useMemo(
    () =>
      resolveCommentAuthor(conversation, {
        userMap,
        contactMap,
      }),
    [conversation, userMap, contactMap]
  );

  const getAuthorName = () => {
    if (conversation.is_system_generated) return 'Bundled update';
    if (resolvedAuthor.source === 'user') {
      return `${resolvedAuthor.displayName}${resolvedAuthor.userType === 'client' ? ' (Client)' : ''}`;
    }
    return resolvedAuthor.displayName;
  };

  const getAuthorEmail = () => {
    if (conversation.is_system_generated) return null;
    return resolvedAuthor.email ?? null;
  };

  const commentSource = useMemo(
    () => getCommentResponseSource(conversation),
    [conversation]
  );
  const authorEmail = getAuthorEmail();

  // Only allow users to edit their own comments
  const canEdit = useMemo(() => {
    if (conversation.is_system_generated) return false;
    return currentUserId === conversation.user_id;
  }, [conversation.user_id, currentUserId]);

  const handleSave = () => {
    const updates: Partial<IComment> = {
      note: JSON.stringify(editedContent),
      is_internal: isInternalToggle,
      is_resolution: isResolutionToggle
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
        {/* Toggle switches above the editor - same pattern as TicketConversation */}
        <div className="flex items-center space-x-4 mt-2 mb-4">
          {!hideInternalTab && (
            <div className="flex items-center space-x-2">
              <Switch
                id={`${commentId}-edit-internal-toggle`}
                checked={isInternalToggle}
                onCheckedChange={setIsInternalToggle}
              />
              <Label htmlFor={`${commentId}-edit-internal-toggle`}>
                {isInternalToggle ? t('tickets.conversation.markedAsInternal', 'Marked as Internal') : t('tickets.conversation.markAsInternal', 'Mark as Internal')}
              </Label>
            </div>
          )}
          <div className="flex items-center space-x-2">
            <Switch
              id={`${commentId}-edit-resolution-toggle`}
              checked={isResolutionToggle}
              onCheckedChange={setIsResolutionToggle}
            />
            <Label htmlFor={`${commentId}-edit-resolution-toggle`}>
              {isResolutionToggle ? t('tickets.conversation.markedAsResolution', 'Marked as Resolution') : t('tickets.conversation.markAsResolution', 'Mark as Resolution')}
            </Label>
          </div>
        </div>
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
    t,
    hideInternalTab,
    isInternalToggle,
    isResolutionToggle
  ]);
  // Reset editor content and toggles when entering edit mode - always use conversation values (persisted)
  // NOTE: Do NOT depend on currentComment values - that would reload unsaved edits after cancel.
  // We intentionally only use conversation values (the persisted values from the database).
  useEffect(() => {
    if (isEditing && currentComment?.comment_id === conversation.comment_id) {
      // Reset toggles to persisted values
      setIsInternalToggle(conversation.is_internal ?? false);
      setIsResolutionToggle(conversation.is_resolution ?? false);

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
  }, [isEditing, currentComment?.comment_id, conversation.comment_id, conversation.note, conversation.is_internal, conversation.is_resolution]);


  return (
    <div {...withDataAutomationId({ id: commentId })} className="rounded-lg p-2 mb-2 shadow-sm border border-gray-200 hover:border-gray-300 bg-white">
      <div className="flex items-start mb-1">
        <div className="mr-2">
          {/* Conditionally render UserAvatar or ContactAvatar */}
          {conversation.is_system_generated || resolvedAuthor.source === 'unknown' ? (
            <UserAvatar
              {...withDataAutomationId({ id: `${commentId}-avatar` })}
              userId=""
              userName="Unknown User"
              avatarUrl={null}
              size="md"
            />
          ) : resolvedAuthor.source === 'contact' ? (
            <ContactAvatar
              {...withDataAutomationId({ id: `${commentId}-avatar` })}
              contactId={resolvedAuthor.contactId || conversation.contact_id || ''}
              contactName={resolvedAuthor.displayName}
              avatarUrl={resolvedAuthor.avatarUrl}
              size="md"
            />
          ) : resolvedAuthor.avatarKind === 'contact' ? (
            <ContactAvatar
              {...withDataAutomationId({ id: `${commentId}-avatar` })}
              contactId={conversation.contact_id || resolvedAuthor.userId || ''}
              contactName={resolvedAuthor.displayName}
              avatarUrl={resolvedAuthor.avatarUrl}
              size="md"
            />
          ) : (
            <UserAvatar
              {...withDataAutomationId({ id: `${commentId}-avatar` })}
              userId={resolvedAuthor.userId || ''}
              userName={resolvedAuthor.displayName}
              avatarUrl={resolvedAuthor.avatarUrl}
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
                {commentSource && (
                  <ResponseSourceBadge
                    source={commentSource}
                    labels={{
                      clientPortal: t('tickets.responseSource.clientPortal', 'Received via Client Portal'),
                      inboundEmail: t('tickets.responseSource.inboundEmail', 'Received via Inbound Email'),
                    }}
                  />
                )}
              </div>
              <div className="flex flex-col">
                {authorEmail && (
                  <p {...withDataAutomationId({ id: `${commentId}-author-email` })} className="text-sm text-gray-600">
                    <a href={`mailto:${authorEmail}`} className="hover:text-indigo-600">
                      {authorEmail}
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
