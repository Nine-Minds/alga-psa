// server/src/components/tickets/TicketConversation.tsx
import React, { useState, useRef, useEffect } from 'react';
import { IComment, ITicket } from '@/interfaces';
import { IContact } from '@/interfaces/contact.interfaces';
import TextEditor from '@/components/editor/TextEditor';
import CommentItem from '@/components/tickets/CommentItem';
import CustomTabs from '@/components/ui/CustomTabs';
import Documents from '@/components/documents/Documents';
import styles from './TicketDetails.module.css';
import { Button } from '@/components/ui/Button';
import { Editor } from '@tiptap/react';
import AvatarIcon from '@/components/ui/AvatarIcon';
import { getContactByContactNameId, getAllContacts } from '@/lib/actions/contact-actions/contactActions';

// Match the exact type expected by CommentItem
type UserInfo = {
  user_id: string;
  first_name: string;
  last_name: string;
  email?: string;
  user_type: string;
};

interface TicketConversationProps {
  ticket: ITicket;
  conversations: IComment[];
  documents: any[];
  userMap: Record<string, UserInfo>;
  currentUser: { id: string; name?: string | null; email?: string | null; } | null | undefined;
  newCommentContent: string;
  activeTab: string;
  isEditing: boolean;
  currentComment: IComment | null;
  editorKey: number;
  onNewCommentContentChange: (content: string) => void;
  onAddNewComment: () => Promise<void>;
  onTabChange: (tab: string) => void;
  onEdit: (conversation: IComment) => void;
  onSave: (updates: Partial<IComment>) => void;
  onClose: () => void;
  onDelete: (commentId: string) => void;
  onContentChange: (content: string) => void;
}

const TicketConversation: React.FC<TicketConversationProps> = ({
  ticket,
  conversations,
  documents,
  userMap,
  currentUser,
  newCommentContent,
  activeTab,
  isEditing,
  currentComment,
  onNewCommentContentChange,
  onAddNewComment,
  onTabChange,
  onEdit,
  onSave,
  onClose,
  onDelete,
  onContentChange,
}) => {
  const [editorKey, setEditorKey] = useState(0);
  const editorRef = useRef<Editor | null>(null);
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
        .map((conv):string => conv.contact_id!)
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

  const renderButtonBar = () => {
    const buttons = ['Comments', 'Internal', 'Resolution'];
    return (
      <div className={styles.buttonBar}>
        {buttons.map((button):JSX.Element => (
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
    if (editorRef.current) {
      editorRef.current.commands.setContent('');
    }
    setEditorKey(prev => prev + 1);
  };

  const getAuthorInfo = (conversation: IComment): UserInfo | null => {
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

  const renderComments = (comments: IComment[]) => {
    return comments.map((conversation):JSX.Element => (
      <CommentItem
        key={conversation.comment_id}
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
        <>
          {renderComments(conversations)}
        </>
      )
    },
    {
      label: "Internal",
      content: (
        <>
          <h3 className="text-lg font-medium mb-4">Internal Comments</h3>
          {renderComments(conversations.filter(conversation => conversation.is_internal))}
        </>
      )
    },
    {
      label: "Resolution",
      content: (
        <>
          <h3 className="text-lg font-medium mb-4">Resolution Comments</h3>
          {renderComments(conversations.filter(conversation => conversation.is_resolution))}
        </>
      )
    },
    {
      label: "Documents",
      content: (
        <div className="mx-8">
          <Documents 
            documents={documents} 
            userId={`${currentUser?.id}`}
            entityId={ticket.ticket_id}
            entityType="ticket"
          />
        </div>
      )
    }
  ];

  const tabStyles = {
    trigger: "px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 hover:border-gray-300 focus:outline-none focus:text-gray-700 focus:border-gray-300 border-b-2 border-transparent",
    activeTrigger: "data-[state=active]:border-indigo-500 data-[state=active]:text-indigo-600"
  };

  return (
    <div className={`${styles['card']}`}>
      <div className="p-6">
        <h2 className="text-xl font-bold mb-4">Comments</h2>
        <div className='mb-6'>
          <div className='flex items-start'>
            <div className="mr-3">
              <AvatarIcon
                userId={currentUser?.id || ''}
                firstName={currentUser?.name?.split(' ')[0] || ''}
                lastName={currentUser?.name?.split(' ')[1] || ''}
                size="md"
              />
            </div>
            <div className='flex-grow'>
              <TextEditor
                key={editorKey}
                roomName={`ticket-${ticket.ticket_id}`}
                initialContent=""
                onContentChange={onNewCommentContentChange}
                handleSubmit={(content) => {
                  console.log('Submitted:', content);
                  return Promise.resolve();
                }}
                editorRef={editorRef}
              >
                {renderButtonBar()}
              </TextEditor>
              <div className="flex justify-end mt-2">
                <Button
                  onClick={handleAddNewComment}
                  className="bg-purple-500 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded"
                >
                  Add Comment
                </Button>
              </div>
            </div>
          </div>
        </div>
        <CustomTabs tabs={tabContent} defaultTab="All Comments" tabStyles={tabStyles} />
      </div>
    </div>
  );
};

export default TicketConversation;
