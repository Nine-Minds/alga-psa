'use client';

import React, { useState, useEffect } from 'react';
import { IComment, ITicket } from '../../interfaces';
import { IDocument } from '../../interfaces/document.interface';
import { IContact } from '../../interfaces/contact.interfaces';
import TextEditor from '../editor/TextEditor';
import { PartialBlock } from '@blocknote/core';
import CommentItem from './CommentItem';
import CustomTabs from '../ui/CustomTabs';
import Documents from '../documents/Documents';
import styles from './TicketDetails.module.css';
import { Button } from '@/components/ui/Button';
import AvatarIcon from '@/components/ui/AvatarIcon';
import { getContactByContactNameId, getAllContacts } from '@/lib/actions/contact-actions/contactActions';
import { withDataAutomationId } from '@/types/ui-reflection/withDataAutomationId';
import { ReflectionContainer } from '@/types/ui-reflection/ReflectionContainer';

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
  onDelete: (commentId: string) => void;
  onContentChange: (content: PartialBlock[]) => void;
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
}) => {
  const [contactMap, setContactMap] = useState<Record<string, IContact>>({});
  const [loadingContacts, setLoadingContacts] = useState<Record<string, boolean>>({});
  const [contacts, setContacts] = useState<IContact[]>([]);

  useEffect(() => {
    const fetchAllContacts = async () => {
      try {
        const allContacts = await getAllContacts();
        setContacts(allContacts);
      } catch (error) {
        console.error('Error fetching contacts:', error);
      }
    };

    fetchAllContacts();
  }, []);

  useEffect(() => {
    const fetchContactsForComments = async () => {
      const contactIds = conversations
        .filter(conv => conv.author_type === 'contact' && conv.contact_id)
        .map((conv): string => conv.contact_id!)
        .filter((id, index, self) => self.indexOf(id) === index);

      for (const contactId of contactIds) {
        if (!contactMap[contactId] && !loadingContacts[contactId]) {
          setLoadingContacts(prev => ({ ...prev, [contactId]: true }));
          try {
            const contactData = await getContactByContactNameId(contactId);
            if (contactData) {
              setContactMap(prev => ({ ...prev, [contactId]: contactData }));
            }
          } catch (error) {
            console.error(`Error fetching contact info for ${contactId}:`, error);
          } finally {
            setLoadingContacts(prev => ({ ...prev, [contactId]: false }));
          }
        }
      }
    };

    fetchContactsForComments();
  }, [conversations]);

  const renderButtonBar = (): JSX.Element => {
    const buttons = ['Comments', 'Internal', 'Resolution'];
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
    if (conversation.author_type === 'user' && conversation.user_id) {
      return userMap[conversation.user_id] || null;
    }
    return null;
  };

  const getContactInfo = (conversation: IComment): IContact | null => {
    if (conversation.author_type === 'contact' && conversation.contact_id) {
      return contactMap[conversation.contact_id] || null;
    }
    return null;
  };

  const isLoadingContact = (conversation: IComment): boolean => {
    return conversation.author_type === 'contact' &&
      conversation.contact_id !== undefined &&
      loadingContacts[conversation.contact_id] === true;
  };

  const renderComments = (comments: IComment[]): JSX.Element[] => {
    return comments.map((conversation): JSX.Element => (
      <CommentItem
        key={conversation.comment_id}
        id={`${id}-comment-${conversation.comment_id}`}
        conversation={conversation}
        user={getAuthorInfo(conversation)}
        contact={getContactInfo(conversation)}
        isLoadingContact={isLoadingContact(conversation)}
        isEditing={isEditing && currentComment?.comment_id === conversation.comment_id}
        currentComment={currentComment}
        ticketId={ticket.ticket_id || ''}
        userMap={userMap}
        contacts={contacts}
        companyId={ticket.company_id}
        onContentChange={onContentChange}
        onSave={onSave}
        onClose={onClose}
        onEdit={() => onEdit(conversation)}
        onDelete={onDelete}
      />
    ));
  };

  const tabContent = [
    {
      label: "All Comments",
      content: (
        <ReflectionContainer id={`${id}-all-comments`} label="All Comments">
          {renderComments(conversations)}
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
    }
  ];

  const tabStyles = {
    trigger: "px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 hover:border-gray-300 focus:outline-none focus:text-gray-700 focus:border-gray-300 border-b-2 border-transparent",
    activeTrigger: "data-[state=active]:border-indigo-500 data-[state=active]:text-indigo-600"
  };

  return (
    <div {...withDataAutomationId({ id })} className={`${styles['card']}`}>
      <div className="p-6">
        <h2 className="text-xl font-bold mb-4">Comments</h2>
        <div className='mb-6'>
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
                initialContent={[]}
                onContentChange={onNewCommentContentChange}
              >
                {renderButtonBar()}
              </TextEditor>
              <div className="flex justify-end mt-2">
                <Button
                  id={`${id}-add-comment-btn`}
                  onClick={handleAddNewComment}
                  className="bg-purple-500 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded"
                >
                  Add Comment
                </Button>
              </div>
            </div>
          </div>
        </div>
        <CustomTabs
          tabs={tabContent}
          defaultTab="All Comments"
          tabStyles={tabStyles}
        />
      </div>
    </div>
  );
};

export default TicketConversation;
