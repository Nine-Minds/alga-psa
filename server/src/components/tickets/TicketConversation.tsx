'use client';

import React, { useState, useMemo } from 'react';
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
  onAddNewComment: () => Promise<void>;
  onTabChange: (tab: string) => void;
  onEdit: (conversation: IComment) => void;
  onSave: (updates: Partial<IComment>) => void;
  onClose: () => void;
  onDelete: (comment: IComment) => void;
  onContentChange: (content: PartialBlock[]) => void;
  hideInternalTab?: boolean; // Optional prop to hide the Internal tab
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
}) => {
  const [showEditor, setShowEditor] = useState(false);
  const [reverseOrder, setReverseOrder] = useState(false);

  const handleAddCommentClick = () => {
    setShowEditor(true);
  };

  const handleSubmitComment = async () => {
    await onAddNewComment();
    setShowEditor(false);
  };

  const handleCancelComment = () => {
    setShowEditor(false);
  };

  const toggleCommentOrder = () => {
    setReverseOrder(!reverseOrder);
  };
  const renderButtonBar = (): JSX.Element => {
    // For MSP portal, always show the Internal tab
    // For client portal, never show the Internal tab
    const buttons = ['Comments', 'Resolution'];
    
    // Add Internal tab if not hidden (MSP portal)
    if (!hideInternalTab) {
      buttons.splice(1, 0, 'Internal');
    }
    
    return (
      <div className={styles.buttonBar}>
        {buttons.map((button: string): JSX.Element => (
          <button
            key={button}
            className={`${styles.button} ${activeTab === button ? styles.activeButton : styles.inactiveButton}`}
            onClick={() => onTabChange(button)}
          >
            {button}
          </button>
        ))}
      </div>
    );
  };

  const handleAddNewComment = async () => {
    await onAddNewComment();
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

  // Build tab content array
  const tabContent = [
    {
      label: "All Comments",
      content: (
        <ReflectionContainer id={`${id}-all-comments`} label="All Comments">
          {/* Filter out internal comments in client portal */}
          {hideInternalTab 
            ? renderComments(conversations.filter(conversation => !conversation.is_internal))
            : renderComments(conversations)
          }
        </ReflectionContainer>
      )
    }
  ];
  
  // Add Internal tab for MSP portal (not client portal)
  if (!hideInternalTab) {
    tabContent.push({
      label: "Internal",
      content: (
        <ReflectionContainer id={`${id}-internal-comments`} label="Internal Comments">
          <h3 className="text-lg font-medium mb-4">Internal Comments</h3>
          {renderComments(conversations.filter(conversation => conversation.is_internal))}
        </ReflectionContainer>
      )
    });
  }
  
  // Add Resolution tab
  tabContent.push({
    label: "Resolution",
    content: (
      <ReflectionContainer id={`${id}-resolution-comments`} label="Resolution Comments">
        <h3 className="text-lg font-medium mb-4">Resolution Comments</h3>
        {renderComments(conversations.filter(conversation => conversation.is_resolution))}
      </ReflectionContainer>
    )
  });
  
  // Add Documents tab
  tabContent.push({
    label: "Documents",
    content: (
      <ReflectionContainer id={`${id}-documents`} label="Documents">
        <div className="mx-8">
          <Documents
            id={`${id}-documents-list`}
            documents={documents}
            userId={`${currentUser?.id}`}
            entityId={ticket.ticket_id}
            entityType="ticket"
          />
        </div>
      </ReflectionContainer>
    )
  });

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
        <div className='mb-6'>
          {showEditor && (
            <div className='flex items-start'>
              <div className="mr-3">
                <AvatarIcon
                  {...withDataAutomationId({ id: `${id}-current-user-avatar` })}
                  userId={currentUser?.id || ''}
                  firstName={currentUser?.name?.split(' ')[0] || ''}
                  lastName={currentUser?.name?.split(' ')[1] || ''}
                  size="md"
                />
              </div>
              <div className='flex-grow'>
                <TextEditor
                  {...withDataAutomationId({ id: `${id}-editor` })}
                  key={editorKey}
                  roomName={`ticket-${ticket.ticket_id}`}
                  initialContent={DEFAULT_BLOCK}
                  onContentChange={onNewCommentContentChange}
                >
                  {renderButtonBar()}
                </TextEditor>
                <div className="flex justify-end space-x-2 mt-2">
                  <Button
                    id={`${id}-add-comment-btn`}
                    onClick={handleSubmitComment}
                  >
                    Add Comment
                  </Button>
                  <Button
                    id={`${id}-cancel-comment-btn`}
                    onClick={handleCancelComment}
                    variant="outline"
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
          defaultTab="All Comments"
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
