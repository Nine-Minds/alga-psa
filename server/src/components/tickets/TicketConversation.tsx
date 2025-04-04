'use client';

import React, { useState, useMemo } from 'react';
import { Switch } from 'server/src/components/ui/Switch';
import { Label } from 'server/src/components/ui/Label';
import { ArrowUpDown } from 'lucide-react';
import { IComment, ITicket } from '../../interfaces';
import { IDocument } from '../../interfaces/document.interface';
import TextEditor, { DEFAULT_BLOCK } from '../editor/TextEditor';
import { PartialBlock } from '@blocknote/core';
import CommentItem from './CommentItem';
import CustomTabs from '../ui/CustomTabs';
import Documents from '../documents/Documents';
import styles from './TicketDetails.module.css';
import { Button } from 'server/src/components/ui/Button';
import AvatarIcon from 'server/src/components/ui/AvatarIcon';
import { withDataAutomationId } from 'server/src/types/ui-reflection/withDataAutomationId';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';

interface TicketConversationProps {
  id?: string;
  ticket: ITicket;
  conversations: IComment[];
  documents: IDocument[];
  userMap: Record<string, { first_name: string; last_name: string; user_id: string; email?: string; user_type: string; }>;
  currentUser: { id: string; name?: string | null; email?: string | null; } | null | undefined;
  activeTab: string;
  isEditing: boolean;
  currentComment: IComment | null;
  editorKey: number;
  onNewCommentContentChange: (content: PartialBlock[]) => void;
  onAddNewComment: (isInternal: boolean, isResolution: boolean) => Promise<void>;
  onTabChange: (tab: string) => void;
  onEdit: (conversation: IComment) => void;
  onSave: (updates: Partial<IComment>) => void;
  onClose: () => void;
  onDelete: (comment: IComment) => void;
  onContentChange: (content: PartialBlock[]) => void;
  hideInternalTab?: boolean; // Optional prop to hide the Internal tab
  isSubmitting?: boolean; // Flag to indicate if a submission is in progress
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
}) => {
  const [showEditor, setShowEditor] = useState(false);
  const [reverseOrder, setReverseOrder] = useState(false);
  const [isInternalToggle, setIsInternalToggle] = useState(false);
  const [isResolutionToggle, setIsResolutionToggle] = useState(false);

  const handleAddCommentClick = () => {
    setShowEditor(true);
  };
  const handleSubmitComment = async () => {
    try {
      if (hideInternalTab) {
        // Client Portal: Call with false for isInternal and use isResolutionToggle for isResolution
        await onAddNewComment(false, isResolutionToggle);
        // Reset the resolution toggle
        setIsResolutionToggle(false);
      } else {
        // Main App: Use toggle states for isInternal and isResolution
        await onAddNewComment(isInternalToggle, isResolutionToggle);
        // Reset both toggles
        setIsInternalToggle(false);
        setIsResolutionToggle(false);
      }
      
      // Only hide the editor after the comment has been successfully added
      console.log('Comment added successfully, closing editor');
      setShowEditor(false);
    } catch (error) {
      console.error('Error adding comment:', error);
      // Don't close the editor if there was an error
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

  const getAuthorInfo = (conversation: IComment) => {
    if (conversation.user_id) {
      return userMap[conversation.user_id] || null;
    }
    return null;
  };

  const renderComments = (comments: IComment[]): JSX.Element[] => {
    // Use the sorted comments based on the reverseOrder state
    const commentsToRender = reverseOrder ? [...comments].reverse() : comments;
    
    return commentsToRender.map((conversation): JSX.Element => (
      <CommentItem
        key={conversation.comment_id}
        id={`${id}-comment-${conversation.comment_id}`}
        conversation={conversation}
        user={getAuthorInfo(conversation)}
        isEditing={isEditing && currentComment?.comment_id === conversation.comment_id}
        currentComment={currentComment}
        ticketId={ticket.ticket_id || ''}
        userMap={userMap}
        onContentChange={onContentChange}
        onSave={onSave}
        onClose={onClose}
        onEdit={() => onEdit(conversation)}
        onDelete={onDelete}
      />
    ));
  };

  // Build tab content array based on hideInternalTab
  const baseTabs = [
    {
      label: "Client Visible",
      content: (
        <ReflectionContainer id={`${id}-client-visible-comments`} label="Client Visible Comments">
          {renderComments(conversations.filter(conversation => !conversation.is_internal))}
        </ReflectionContainer>
      )
    },
    {
      label: "Internal",
      content: (
        <ReflectionContainer id={`${id}-internal-comments`} label="Internal Comments">
          <h3 className="text-lg font-medium mb-4">Internal Comments</h3>
          {renderComments(conversations.filter(conversation => conversation.is_internal))}
        </ReflectionContainer>
      )
    },
    {
      label: "Resolution",
      content: (
        <ReflectionContainer id={`${id}-resolution-comments`} label="Resolution Comments">
          <h3 className="text-lg font-medium mb-4">Resolution Comments</h3>
          {renderComments(conversations.filter(conversation => conversation.is_resolution))}
        </ReflectionContainer>
      )
    },
    {
      label: "All Comments",
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
    // For client portal, only show "All Comments" and "Resolution" tabs
    tabContent = [
      baseTabs.find(tab => tab.label === "All Comments")!,
      baseTabs.find(tab => tab.label === "Resolution")!
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
          <h2 className="text-xl font-bold">Comments</h2>
          {!showEditor && (
            <Button
              id={`${id}-show-comment-editor-btn`}
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
                <AvatarIcon
                  {...withDataAutomationId({ id: `${id}-current-user-avatar` })}
                  userId={currentUser?.id || ''}
                  firstName={currentUser?.name?.split(' ')[0] || ''}
                  lastName={currentUser?.name?.split(' ')[1] || ''}
                  size="md"
                />
              </div>
              <div className='flex-grow'>
                {/* Toggle switches above the editor */}
                <div className="flex items-center space-x-4 mb-2 ml-2">
                  {!hideInternalTab && (
                    <div className="flex items-center space-x-2">
                      <Switch
                        id={`${id}-internal-toggle`}
                        checked={isInternalToggle}
                        onCheckedChange={setIsInternalToggle}
                      />
                      <Label htmlFor={`${id}-internal-toggle`}>
                        {isInternalToggle ? "Marked as Internal" : "Mark as Internal"}
                      </Label>
                    </div>
                  )}
                  <div className="flex items-center space-x-2">
                    <Switch
                      id={`${id}-resolution-toggle`}
                      checked={isResolutionToggle}
                      onCheckedChange={setIsResolutionToggle}
                    />
                    <Label htmlFor={`${id}-resolution-toggle`}>
                      {isResolutionToggle ? "Marked as Resolution" : "Mark as Resolution"}
                    </Label>
                  </div>
                </div>
                <TextEditor
                  {...withDataAutomationId({ id: `${id}-editor` })}
                  key={editorKey}
                  roomName={`ticket-${ticket.ticket_id}`}
                  initialContent={DEFAULT_BLOCK}
                  onContentChange={onNewCommentContentChange}
                />
                <div className="flex justify-end space-x-2 mt-1">
                  <Button
                    id={`${id}-add-comment-btn`}
                    onClick={handleSubmitComment}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? 'Adding...' : 'Add Comment'}
                  </Button>
                  <Button
                    id={`${id}-cancel-comment-btn`}
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
          defaultTab={hideInternalTab ? "All Comments" : "Client Visible"}
          tabStyles={tabStyles}
          onTabChange={onTabChange}
          extraContent={
            <button
              onClick={toggleCommentOrder}
              className="flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent px-4 py-2 ml-auto"
            >
              <ArrowUpDown className="w-4 h-4" />
              <span>{reverseOrder ? "Newest first" : "Oldest first"}</span>
            </button>
          }
        />
      </div>
    </div>
  );
};

export default TicketConversation;
