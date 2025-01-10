'use client';

import React, { useMemo, useState } from 'react';
import { Block } from '@blocknote/core';
import TextEditor from '../editor/TextEditor';
import ReactMarkdown from 'react-markdown';
import { Pencil2Icon, TrashIcon } from '@radix-ui/react-icons';
import AvatarIcon from '@/components/ui/AvatarIcon';
import { IComment } from '@/interfaces/comment.interface';
import { IContact } from '@/interfaces/contact.interfaces';
import { IUserWithRoles } from '@/interfaces/auth.interfaces';
import CustomSelect from '@/components/ui/CustomSelect';
import UserPicker from '@/components/ui/UserPicker';
import ContactPickerDialog from '@/components/ui/ContactPickerDialog';
import { Button } from '@/components/ui/Button';
import { withDataAutomationId } from '@/types/ui-reflection/withDataAutomationId';

interface CommentItemProps {
  id?: string;
  conversation: IComment;
  user: { 
    first_name: string; 
    last_name: string;
    user_id: string;
    email?: string;
  } | null;
  contact: IContact | null;
  isLoadingContact: boolean;
  isEditing: boolean;
  currentComment: IComment | null;
  ticketId: string;
  userMap: Record<string, { first_name: string; last_name: string; user_id: string; email?: string; user_type: string; }>;
  contacts: IContact[];
  companyId?: string;
  onContentChange: (content: string) => void;
  onSave: (updates: Partial<IComment>) => void;
  onClose: () => void;
  onEdit: (conversation: IComment) => void;
  onDelete: (commentId: string) => void;
}

  const CommentItem: React.FC<CommentItemProps> = ({
  id,
  conversation,
  user,
  contact,
  isLoadingContact,
  isEditing,
  currentComment,
  ticketId,
  userMap,
  contacts,
  companyId,
  onContentChange,
  onSave,
  onClose,
  onEdit,
  onDelete
}) => {
  const [authorType, setAuthorType] = useState(conversation.author_type);
  const [selectedUserId, setSelectedUserId] = useState(conversation.user_id || '');
  const [selectedContactId, setSelectedContactId] = useState(conversation.contact_id || '');
  const [isContactPickerOpen, setIsContactPickerOpen] = useState(false);
  const [editedContent, setEditedContent] = useState(conversation.note || '');

  const commentId = useMemo(() => 
    conversation.comment_id || currentComment?.comment_id || id || 'unknown',
    [conversation.comment_id, currentComment?.comment_id, id]
  );

  const getAuthorName = () => {
    switch (conversation.author_type) {
      case 'user':
        return user ? `${user.first_name} ${user.last_name}` : 'Unknown User';
      case 'contact':
        if (isLoadingContact) return 'Loading...';
        return contact ? contact.full_name : 'Unknown Contact';
      case 'unknown':
      default:
        return 'Unknown Author';
    }
  };

  const getAuthorEmail = () => {
    switch (conversation.author_type) {
      case 'user':
        return user?.email;
      case 'contact':
        if (isLoadingContact) return null;
        return contact?.email;
      default:
        return null;
    }
  };

  const canEdit = useMemo(() => {
    return (conversation.author_type === 'user' && user?.user_id === conversation.user_id) ||
           (conversation.author_type === 'contact' && conversation.contact_id);
  }, [conversation.author_type, conversation.user_id, conversation.contact_id, user?.user_id]);

  const handleAuthorTypeChange = (newType: string) => {
    const newAuthorType = newType as 'user' | 'contact';
    setAuthorType(newAuthorType);
    
    if (newAuthorType === 'user') {
      setSelectedContactId('');
      setSelectedUserId(conversation.user_id || '');
    } else {
      setSelectedUserId('');
      setSelectedContactId(conversation.contact_id || '');
    }
  };

  const handleSave = () => {
    const updates: Partial<IComment> = {
      author_type: authorType,
      note: editedContent,
    };

    if (authorType === 'user' && selectedUserId) {
      updates.user_id = selectedUserId;
      updates.contact_id = undefined;
    } else if (authorType === 'contact' && selectedContactId) {
      updates.contact_id = selectedContactId;
      updates.user_id = undefined;
    }

    onSave(updates);
  };

  const handleContentChange = (blocks: Block[]) => {
    const content = blocks.map((block):any => block.content).join('\n');
    setEditedContent(content);
    onContentChange(content);
  };

  const selectedContact = contacts.find(c => c.contact_name_id === selectedContactId);

  const editorContent = useMemo(() => {
    if (!currentComment || !isEditing) return null;

    return (
      <div>
        <div className="mb-4 space-y-4">
          <div className="max-w-xs">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Author Type
            </label>
            <CustomSelect
              value={authorType}
              onValueChange={handleAuthorTypeChange}
              options={[
                { value: 'user', label: 'User' },
                { value: 'contact', label: 'Contact' }
              ]}
            />
          </div>
          
          <div>
            {authorType === 'user' ? (
              <UserPicker
                label="Select User"
                value={selectedUserId}
                onValueChange={setSelectedUserId}
                users={Object.entries(userMap).map(([id, user]): IUserWithRoles => {
                  return {
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
                  };
                })}
              />
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Select Contact
                </label>
                <div className="flex items-center gap-2">
                  {selectedContact ? (
                    <div className="flex-1 p-2 border rounded-md">
                      <div className="font-medium">{selectedContact.full_name}</div>
                      <div className="text-sm text-gray-500">{selectedContact.email}</div>
                    </div>
                  ) : (
                    <div className="flex-1 p-2 border rounded-md text-gray-500">
                      No contact selected
                    </div>
                  )}
                  <Button
                    {...withDataAutomationId({ id: `${commentId}-select-contact-btn` })}
                    onClick={() => setIsContactPickerOpen(true)}
                    variant="outline"
                  >
                    {selectedContact ? 'Change' : 'Select'} Contact
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        <TextEditor
          {...withDataAutomationId({ id: `${commentId}-text-editor` })}
          roomName={`ticket-${ticketId}-comment-${currentComment.comment_id}`}
          initialContent={editedContent}
          onContentChange={handleContentChange}
        />

        <div className="flex justify-end space-x-2 mt-2">
          <button
            {...withDataAutomationId({ id: `${commentId}-save-btn` })}
            onClick={handleSave}
            className="bg-green-500 hover:bg-green-600 text-white font-medium py-1 px-3 rounded-md transition duration-150 ease-in-out"
            disabled={!((authorType === 'user' && selectedUserId) || (authorType === 'contact' && selectedContactId))}
          >
            Save
          </button>
          <Button
            {...withDataAutomationId({ id: `${commentId}-cancel-btn` })}
            onClick={onClose}
            className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-medium py-1 px-3 rounded-md transition duration-150 ease-in-out"
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }, [
    currentComment,
    isEditing,
    authorType,
    selectedUserId,
    selectedContact,
    commentId,
    ticketId,
    editedContent,
    userMap,
    handleAuthorTypeChange,
    handleContentChange,
    handleSave,
    onClose
  ]);

  return (
    <>
      <div {...withDataAutomationId({ id: commentId })} className="bg-gray-50 rounded-lg p-4 mb-4 shadow-sm">
        <div className="flex items-start mb-2">
          <div className="mr-3">
            <AvatarIcon 
              {...withDataAutomationId({ id: `${commentId}-avatar` })}
              userId={conversation.author_type === 'user' ? conversation.user_id || '' : ''}
              firstName={user?.first_name || contact?.full_name?.split(' ')[0] || ''}
              lastName={user?.last_name || contact?.full_name?.split(' ')[1] || ''}
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
                  <button
                    id={`edit-comment-${conversation.comment_id}-button`}
                    onClick={() => onEdit(conversation)}
                    className="text-indigo-600 hover:text-indigo-800 font-medium p-1 rounded-full hover:bg-indigo-100 transition duration-150 ease-in-out"
                    aria-label="Edit comment"
                  >
                    <Pencil2Icon className="w-5 h-5" />
                  </button>
                  <Button
                    id='delete-comment-button'
                    onClick={() => onDelete(conversation.comment_id || '')}
                    className="text-red-600 hover:text-red-800 font-medium p-1 rounded-full hover:bg-red-100 transition duration-150 ease-in-out"
                    aria-label="Delete comment"
                  >
                    <TrashIcon className="w-5 h-5" />
                  </Button>
                </div>
              )}
            </div>
            {isEditing && currentComment?.comment_id === conversation.comment_id ? (
              editorContent
            ) : (
              <div {...withDataAutomationId({ id: `${commentId}-content` })} className="prose max-w-none mt-2">
                <ReactMarkdown>{conversation.note || ''}</ReactMarkdown>
              </div>
            )}
          </div>
        </div>
      </div>

      <ContactPickerDialog
        {...withDataAutomationId({ id: `${commentId}-contact-picker` })}
        isOpen={isContactPickerOpen}
        onClose={() => setIsContactPickerOpen(false)}
        onSelect={(contact) => {
          setSelectedContactId(contact.contact_name_id);
          setIsContactPickerOpen(false);
        }}
        contacts={contacts}
        prefilledCompanyId={companyId}
      />
    </>
  );
};

export default CommentItem;
