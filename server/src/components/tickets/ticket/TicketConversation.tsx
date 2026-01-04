'use client';

import React, { useState, useMemo, useEffect, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useTranslation } from 'server/src/lib/i18n/client';
import { Switch } from 'server/src/components/ui/Switch';
import { Label } from 'server/src/components/ui/Label';
import { ArrowUpDown } from 'lucide-react';
import { IComment, ITicket } from 'server/src/interfaces';
import { IDocument } from 'server/src/interfaces/document.interface';
import { PartialBlock } from '@blocknote/core';
import RichTextEditorSkeleton from 'server/src/components/ui/skeletons/RichTextEditorSkeleton';

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
import CommentItem from './CommentItem';
import CustomTabs from 'server/src/components/ui/CustomTabs';
import styles from './TicketDetails.module.css';
import { Button } from 'server/src/components/ui/Button';
import UserAvatar from 'server/src/components/ui/UserAvatar';
import { withDataAutomationId } from 'server/src/types/ui-reflection/withDataAutomationId';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { getContactAvatarUrlAction } from 'server/src/lib/actions/avatar-actions';
import { getUserContactId } from 'server/src/lib/actions/user-actions/userActions';
import { createTenantKnex } from 'server/src/lib/db';

interface TicketConversationProps {
  id?: string;
  ticket: ITicket;
  conversations: IComment[];
  documents: IDocument[];
  userMap: Record<string, { first_name: string; last_name: string; user_id: string; email?: string; user_type: string; avatarUrl: string | null }>;
  currentUser: { id: string; name?: string | null; email?: string | null; avatarUrl?: string | null } | null | undefined;
  activeTab: string;
  isEditing: boolean;
  currentComment: IComment | null;
  editorKey: number;
  onNewCommentContentChange: (content: PartialBlock[]) => void;
  onAddNewComment: (isInternal: boolean, isResolution: boolean) => Promise<boolean>;
  onTabChange: (tab: string) => void;
  onEdit: (conversation: IComment) => void;
  onSave: (updates: Partial<IComment>) => void;
  onClose: () => void;
  onDelete: (comment: IComment) => void;
  onContentChange: (content: PartialBlock[]) => void;
  hideInternalTab?: boolean; // Optional prop to hide the Internal tab
  isSubmitting?: boolean; // Flag to indicate if a submission is in progress
  overrides?: Record<string, { note?: string; updated_at?: string }>; // Optional local overrides by comment_id
  externalComments?: Array<IComment & { child_ticket_id?: string; child_ticket_number?: string; child_ticket_title?: string; child_client_name?: string }>;
}

const TicketConversation: React.FC<TicketConversationProps> = ({
  id,
  ticket,
  conversations,
  documents,
  userMap,
  currentUser,
  activeTab,
  isEditing,
  currentComment,
  editorKey,
  onNewCommentContentChange,
  onAddNewComment,
  onTabChange,
  onEdit,
  onSave,
  onClose,
  onDelete,
  onContentChange,
  hideInternalTab = false,
  isSubmitting = false,
  overrides = {},
  externalComments = [],
}) => {
  const { t } = useTranslation('clientPortal');
  // Ensure we have a stable id for interactive element ids
  const compId = id || `ticket-${ticket.ticket_id || 'unknown'}-conversation`;
  const [showEditor, setShowEditor] = useState(false);
  const [reverseOrder, setReverseOrder] = useState(false);
  const [isInternalToggle, setIsInternalToggle] = useState(false);
  const [isResolutionToggle, setIsResolutionToggle] = useState(false);
  const [contactAvatarUrls, setContactAvatarUrls] = useState<Record<string, string | null>>({});

  const handleAddCommentClick = () => {
    setShowEditor(true);
  };
  const handleSubmitComment = async () => {
    let success = false;
    try {
      if (hideInternalTab) {
        // Client Portal: Call with false for isInternal and use isResolutionToggle for isResolution
        success = await onAddNewComment(false, isResolutionToggle);
        if (success) {
          setIsResolutionToggle(false);
        }
      } else {
        // Main App: Use toggle states for isInternal and isResolution
        success = await onAddNewComment(isInternalToggle, isResolutionToggle);
        if (success) {
          setIsInternalToggle(false);
          setIsResolutionToggle(false);
        }
      }
      
      if (success) {
        console.log('Comment added successfully, closing editor');
        setShowEditor(false);
      } else {
        console.log('Comment addition failed, keeping editor open');
      }
    } catch (error) {
      console.error('Error during comment submission process:', error);
    }
  };

  const handleCancelComment = () => {
    setShowEditor(false);
  };

  const toggleCommentOrder = () => {
    setReverseOrder(!reverseOrder);
  };
  // Removed renderButtonBar function as it's no longer needed
  const handleAddNewComment = async () => {
    if (hideInternalTab) {
      await onAddNewComment(false, isResolutionToggle);
    } else {
      await onAddNewComment(isInternalToggle, isResolutionToggle);
    }
  };

  // Fetch contact avatar URLs for client users
  useEffect(() => {
    const fetchContactAvatarUrls = async () => {
      if (!ticket.tenant) return;
      
      const newContactAvatarUrls: Record<string, string | null> = {};
      const updatedUserMap = { ...userMap };
      
      // Find all client users in the conversations
      for (const conversation of conversations) {
        if (conversation.user_id && userMap[conversation.user_id]?.user_type === 'client') {
          try {
            const contactId = await getUserContactId(conversation.user_id);
            
            if (contactId) {
              const avatarUrl = await getContactAvatarUrlAction(contactId, ticket.tenant);
              if (avatarUrl) {
                newContactAvatarUrls[conversation.user_id] = avatarUrl;
                
                updatedUserMap[conversation.user_id] = {
                  ...userMap[conversation.user_id],
                  avatarUrl: avatarUrl
                };
              }
            }
          } catch (error) {
            console.error(`Error fetching avatar URL for contact ${conversation.user_id}:`, error);
          }
        }
      }
      
      setContactAvatarUrls(newContactAvatarUrls);
      
      Object.keys(updatedUserMap).forEach(key => {
        if (updatedUserMap[key].avatarUrl !== userMap[key].avatarUrl) {
          userMap[key] = updatedUserMap[key];
        }
      });
    };
    
    fetchContactAvatarUrls();
  }, [conversations, ticket.tenant, userMap]);

  // Log when conversations prop changes
  useEffect(() => {
    try {
      if (process.env.NODE_ENV !== 'production') console.log('[TicketConversation] conversations changed', {
        count: conversations.length,
        items: conversations.map(c => ({ id: c.comment_id, updated_at: c.updated_at, noteLen: (c.note || '').length }))
      });
    } catch {}
  }, [conversations]);

  const getAuthorInfo = (conversation: IComment) => {
    if (conversation.user_id) {
      // The userMap should already have the updated avatar URLs from the useEffect above
      return userMap[conversation.user_id] || null;
    }
    return null;
  };

  const renderComments = (comments: IComment[]): React.JSX.Element[] => {
    // Use the sorted comments based on the reverseOrder state
    const commentsToRender = reverseOrder ? [...comments].reverse() : comments;
    
    return commentsToRender.map((conversation): React.JSX.Element => {
      const override = overrides[conversation.comment_id || ''];
      const mergedConversation = override
        ? { ...conversation, ...(override.note ? { note: override.note } : {}), ...(override.updated_at ? { updated_at: override.updated_at } : {}) }
        : conversation;
      const itemKey = `${conversation.comment_id}-${conversation.updated_at || ''}-${(conversation.note || '').length}`;
      if (process.env.NODE_ENV !== 'production') console.log('[TicketConversation][renderComments] Rendering', {
        key: itemKey,
        comment_id: mergedConversation.comment_id,
        updated_at: mergedConversation.updated_at,
        noteLen: (mergedConversation.note || '').length,
      });
      return (
      <CommentItem
        key={itemKey}
        id={`${id}-comment-${mergedConversation.comment_id}`}
        conversation={mergedConversation}
        user={getAuthorInfo(conversation)}
        currentUserId={currentUser?.id}
        isEditing={isEditing && currentComment?.comment_id === mergedConversation.comment_id}
        currentComment={currentComment}
        ticketId={ticket.ticket_id || ''}
        userMap={userMap}
        onContentChange={onContentChange}
        onSave={onSave}
        onClose={onClose}
        onEdit={() => onEdit(mergedConversation)}
        onDelete={onDelete}
      />
    );
    });
  };

  const renderExternalComments = (): React.JSX.Element | null => {
    if (!externalComments || externalComments.length === 0) {
      return null;
    }

    const commentsToRender = reverseOrder ? [...externalComments].reverse() : externalComments;
    return (
      <div className="mt-4" id={`${compId}-external-comments`}>
        <div className="text-xs text-gray-500 mb-2">
          Inbound replies on child tickets (view-only)
        </div>
        {commentsToRender.map((conversation) => {
          const key = `ext-${conversation.child_ticket_id || 'unknown'}-${conversation.comment_id || conversation.created_at || ''}`;
          return (
            <div key={key} className="mb-2">
              <div className="text-xs text-gray-600 mb-1">
                {conversation.child_client_name ? `${conversation.child_client_name} • ` : ''}
                {conversation.child_ticket_number ? `Ticket ${conversation.child_ticket_number}` : 'Child ticket'}
                {conversation.child_ticket_title ? ` • ${conversation.child_ticket_title}` : ''}
              </div>
              <CommentItem
                key={key}
                id={`${compId}-external-comment-${conversation.comment_id}`}
                conversation={conversation}
                user={getAuthorInfo(conversation)}
                currentUserId={null}
                isEditing={false}
                currentComment={null}
                ticketId={ticket.ticket_id || ''}
                userMap={userMap}
                onContentChange={() => {}}
                onSave={() => {}}
                onClose={() => {}}
                onEdit={() => {}}
                onDelete={() => {}}
              />
            </div>
          );
        })}
      </div>
    );
  };

  // Build tab content array based on hideInternalTab
  const baseTabs = [
    {
      label: t('tickets.conversation.client', 'Client'),
      content: (
        <ReflectionContainer id={`${id}-client-visible-comments`} label="Client Comments">
          {renderComments(conversations.filter(conversation => !conversation.is_internal))}
          {renderExternalComments()}
        </ReflectionContainer>
      )
    },
    {
      label: t('tickets.conversation.internal', 'Internal'),
      content: (
        <ReflectionContainer id={`${id}-internal-comments`} label="Internal Comments">
          <h3 className="text-lg font-medium mb-4">{t('tickets.conversation.internalComments', 'Internal Comments')}</h3>
          {renderComments(conversations.filter(conversation => conversation.is_internal))}
        </ReflectionContainer>
      )
    },
    {
      label: t('tickets.conversation.resolution', 'Resolution'),
      content: (
        <ReflectionContainer id={`${id}-resolution-comments`} label="Resolution Comments">
          <h3 className="text-lg font-medium mb-4">{t('tickets.conversation.resolutionComments', 'Resolution Comments')}</h3>
          {renderComments(conversations.filter(conversation => 
            conversation.is_resolution && (!hideInternalTab || !conversation.is_internal)
          ))}
        </ReflectionContainer>
      )
    },
    {
      label: t('tickets.conversation.allComments', 'All Comments'),
      content: (
        <ReflectionContainer id={`${id}-all-comments`} label="All Comments">
          {renderComments(hideInternalTab
            // For client portal, "All Comments" should exclude internal comments (same as "Client Visible")
            ? conversations.filter(conversation => !conversation.is_internal)
            // For MSP portal, "All Comments" includes all comments
            : conversations)}
        </ReflectionContainer>
      )
    }
  ];
  
  // Filter and order tabs based on hideInternalTab
  let tabContent;
  if (hideInternalTab) {
    // For client portal, only show "All Comments" (index 3) and "Resolution" (index 2) tabs
    tabContent = [
      baseTabs[3], // All Comments
      baseTabs[2]  // Resolution
    ];
  } else {
    // For MSP portal, show all tabs
    tabContent = baseTabs;
  }

  const tabStyles = {
    trigger: "px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 hover:border-gray-300 focus:outline-none focus:text-gray-700 focus:border-gray-300 border-b-2 border-transparent",
    activeTrigger: "data-[state=active]:border-indigo-500 data-[state=active]:text-indigo-600"
  };


  return (
    <div {...withDataAutomationId({ id })} className={`${styles['card']}`}>
      <div className="p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">{t('tickets.conversation.comments', 'Comments')}</h2>
          {!showEditor && (
            <Button
              id={`${compId}-show-comment-editor-btn`}
              onClick={handleAddCommentClick}
            >
              {t('tickets.conversation.addComment', 'Add Comment')}
            </Button>
          )}
        </div>
        <div className='mb-3'>
          {showEditor && (
            <div className='flex items-start'>
              <div className="mr-2">
                {/* Use UserAvatar component for current user */}
                <UserAvatar
                  {...withDataAutomationId({ id: `${id}-current-user-avatar` })}
                  userId={currentUser?.id || ''}
                  userName={currentUser?.name || ''}
                  avatarUrl={userMap[currentUser?.id || '']?.avatarUrl || currentUser?.avatarUrl || null}
                  size="md"
                />
              </div>
              <div className='flex-grow'>
                {/* Toggle switches above the editor */}
                <div className="flex items-center space-x-4 mb-2 ml-2">
                  {!hideInternalTab && (
                    <div className="flex items-center space-x-2">
                      <Switch
                        id={`${compId}-internal-toggle`}
                        checked={isInternalToggle}
                        onCheckedChange={setIsInternalToggle}
                      />
                      <Label htmlFor={`${id}-internal-toggle`}>
                        {isInternalToggle ? t('tickets.conversation.markedAsInternal', 'Marked as Internal') : t('tickets.conversation.markAsInternal', 'Mark as Internal')}
                      </Label>
                    </div>
                  )}
                  <div className="flex items-center space-x-2">
                    <Switch
                      id={`${compId}-resolution-toggle`}
                      checked={isResolutionToggle}
                      onCheckedChange={setIsResolutionToggle}
                    />
                    <Label htmlFor={`${id}-resolution-toggle`}>
                      {isResolutionToggle ? t('tickets.conversation.markedAsResolution', 'Marked as Resolution') : t('tickets.conversation.markAsResolution', 'Mark as Resolution')}
                    </Label>
                  </div>
                </div>
                <Suspense fallback={<RichTextEditorSkeleton height="200px" title="Comment Editor" />}>
                  <TextEditor
                    {...withDataAutomationId({ id: `${compId}-editor` })}
                    key={editorKey}
                    roomName={`ticket-${ticket.ticket_id}`}
                    initialContent={DEFAULT_BLOCK}
                    onContentChange={onNewCommentContentChange}
                  />
                </Suspense>
                <div className="flex justify-end space-x-2 mt-1">
                  <Button
                    id={`${compId}-add-comment-btn`}
                    onClick={handleSubmitComment}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? t('common.loading', 'Loading...') : t('tickets.conversation.addComment', 'Add Comment')}
                  </Button>
                  <Button
                    id={`${compId}-cancel-comment-btn`}
                    onClick={handleCancelComment}
                    variant="outline"
                    disabled={isSubmitting}
                  >
                    {t('common.cancel', 'Cancel')}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
        <CustomTabs
          tabs={tabContent}
          defaultTab={hideInternalTab ? t('tickets.conversation.allComments', 'All Comments') : t('tickets.conversation.client', 'Client')}
          tabStyles={tabStyles}
          onTabChange={onTabChange}
          extraContent={
            <button
              id={`${compId}-toggle-order-btn`}
              onClick={toggleCommentOrder}
              className="flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent px-4 py-2 ml-auto"
            >
              <ArrowUpDown className="w-4 h-4" />
              <span>{reverseOrder ? t('tickets.conversation.newestFirst', 'Newest first') : t('tickets.conversation.oldestFirst', 'Oldest first')}</span>
            </button>
          }
        />
      </div>
    </div>
  );
};

export default TicketConversation;
