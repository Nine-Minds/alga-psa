'use client';

import React, { useEffect, useState } from 'react';
import RichTextViewer from 'server/src/components/editor/RichTextViewer';
import TextEditor from 'server/src/components/editor/TextEditor';
import { PartialBlock } from '@blocknote/core';
import { ITicket, IComment, ITicketCategory } from 'server/src/interfaces';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import { Button } from 'server/src/components/ui/Button';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { PrioritySelect } from '@/components/tickets/PrioritySelect';
import UserPicker from 'server/src/components/ui/UserPicker';
import { CategoryPicker } from 'server/src/components/tickets/CategoryPicker';
import { TagManager } from 'server/src/components/tags';
import styles from './TicketDetails.module.css';
import { getTicketCategories } from 'server/src/lib/actions/ticketCategoryActions';
import { Pencil, Check } from 'lucide-react';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { Input } from 'server/src/components/ui/Input';

interface TicketInfoProps {
  id: string; // Made required since it's needed for reflection registration
  ticket: ITicket;
  conversations: IComment[];
  statusOptions: { value: string; label: string }[];
  agentOptions: { value: string; label: string }[];
  channelOptions: { value: string; label: string }[];
  priorityOptions: { value: string; label: string }[];
  onSelectChange: (field: keyof ITicket, newValue: string | null) => void;
  onUpdateDescription?: (content: string) => Promise<boolean>;
  isSubmitting?: boolean;
  users?: IUserWithRoles[];
  tags?: ITag[];
  allTagTexts?: string[];
  onTagsChange?: (tags: ITag[]) => void;
  isInDrawer?: boolean;
}

const TicketInfo: React.FC<TicketInfoProps> = ({
  id,
  ticket,
  conversations,
  statusOptions,
  agentOptions,
  channelOptions,
  priorityOptions,
  onSelectChange,
  onUpdateDescription,
  isSubmitting = false,
  users = [],
  tags = [],
  allTagTexts = [],
  onTagsChange,
  isInDrawer = false,
}) => {
  const [categories, setCategories] = useState<ITicketCategory[]>([]);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(ticket.title);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [descriptionContent, setDescriptionContent] = useState<PartialBlock[]>([{
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
  }]);

  useEffect(() => {
    // Initialize description content from the ticket attributes
    const descriptionText = (ticket.attributes?.description as string) || '';

    if (descriptionText) {
      try {
        const parsedContent = JSON.parse(descriptionText);
        if (Array.isArray(parsedContent) && parsedContent.length > 0) {
          setDescriptionContent(parsedContent);
          return;
        }
      } catch (e) {
        // If parsing fails, continue to the fallback
      }
      
      // Fallback: create a default block with the text
      setDescriptionContent([{
        type: "paragraph",
        props: {
          textAlignment: "left",
          backgroundColor: "default",
          textColor: "default"
        },
        content: [{
          type: "text",
          text: descriptionText,
          styles: {}
        }]
      }]);
    }

    const fetchCategories = async () => {
      try {
        const fetchedCategories = await getTicketCategories();
        setCategories(fetchedCategories);
      } catch (error) {
        console.error('Failed to fetch categories:', error);
      }
    };

    fetchCategories();
  }, [ticket, conversations]);

  useEffect(() => {
    setTitleValue(ticket.title);
  }, [ticket.title]);

  const handleTitleSubmit = () => {
    if (titleValue.trim() !== '') {
      onSelectChange('title', titleValue.trim());
      setIsEditingTitle(false);
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setTitleValue(ticket.title);
      setIsEditingTitle(false);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleTitleSubmit();
    }
  };

  const getCategoryChannel = (categoryId: string): string | undefined => {
    const category = categories.find(c => c.category_id === categoryId);
    return category?.channel_id;
  };

  const handleCategoryChange = (categoryIds: string[]) => {
    if (categoryIds.length === 0) {
      onSelectChange('category_id', null);
      onSelectChange('subcategory_id', null);
      return;
    }

    const selectedCategoryId = categoryIds[0];
    const selectedCategory = categories.find(c => c.category_id === selectedCategoryId);
    
    if (!selectedCategory) {
      console.error('Selected category not found');
      return;
    }

    if (selectedCategory.parent_category) {
      onSelectChange('category_id', selectedCategory.parent_category);
      onSelectChange('subcategory_id', selectedCategoryId);
    } else {
      onSelectChange('category_id', selectedCategoryId);
      onSelectChange('subcategory_id', null);
    }

    if (selectedCategory.channel_id && selectedCategory.channel_id !== ticket.channel_id) {
      onSelectChange('channel_id', selectedCategory.channel_id);
    }
  };

  const getSelectedCategoryId = () => {
    if (ticket.subcategory_id) {
      return ticket.subcategory_id;
    }
    return ticket.category_id || '';
  };

  const customStyles = {
    trigger: "w-fit !inline-flex items-center justify-between rounded px-3 py-2 text-sm font-medium bg-white border border-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500",
    content: "bg-white rounded-md shadow-lg ring-1 ring-black ring-opacity-5 overflow-auto",
    item: "text-gray-900 cursor-default select-none relative py-2 pl-3 pr-9 hover:bg-indigo-600 hover:text-white",
    itemIndicator: "absolute inset-y-0 right-0 flex items-center pr-4 text-indigo-600",
  };

  // If we don't have users data but have agentOptions, convert agentOptions to users format
  const usersList: IUserWithRoles[] = users.length > 0
    ? users
    : agentOptions.map((agent): IUserWithRoles => ({
        user_id: agent.value,
        username: agent.value,
        first_name: agent.label.split(' ')[0] || '',
        last_name: agent.label.split(' ').slice(1).join(' ') || '',
        email: '',
        hashed_password: '',
        is_inactive: false,
        tenant: '',
        user_type: 'internal',
        roles: []
      }));

  return (
    <ReflectionContainer id={id} label={`Info for ticket ${ticket.ticket_number}`}>
      <div className={`${styles['card']}`}>
        <div className="p-6">
          <div className="flex items-center gap-2 mb-4">
            {isEditingTitle ? (
              <div className="flex items-center gap-2 flex-1">
                <Input

                  type="text"
                  value={titleValue}
                  onChange={(e) => setTitleValue(e.target.value)}
                  onKeyDown={handleTitleKeyDown}
                  autoFocus
                  className="text-2xl font-bold flex-1 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  containerClassName="mb-2"
                />
                <button

                  onClick={handleTitleSubmit}
                  className="p-1 hover:bg-gray-100 rounded-full transition-colors duration-200"
                  title="Save title"
                >
                  <Check className="w-4 h-4 text-gray-500" />
                </button>
              </div>
            ) : (
              <>
                <h1 

                  className="text-2xl font-bold"
                >
                  {ticket.title}
                </h1>
                <button
                  onClick={() => setIsEditingTitle(true)}
                  className="p-1 hover:bg-gray-100 rounded-full transition-colors duration-200"
                  title="Edit title"
                >
                  <Pencil className="w-4 h-4 text-gray-500" />
                </button>
              </>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <h5 className="font-bold mb-2">Status</h5>
              <CustomSelect
                value={ticket.status_id || ''}
                options={statusOptions}
                onValueChange={(value) => onSelectChange('status_id', value)}
                customStyles={customStyles}
                className="!w-fit"
              />
            </div>
            <div>
              <h5 className="font-bold mb-2">Assigned To</h5>
              <UserPicker
                value={ticket.assigned_to || ''}
                onValueChange={(value) => onSelectChange('assigned_to', value)}
                users={usersList}
                labelStyle="none"
                buttonWidth="fit"
                size="sm"
                className="!w-fit"
                placeholder="Not assigned"
              />
            </div>
            <div>
              <h5 className="font-bold mb-2">Board</h5>
              <CustomSelect
                value={ticket.channel_id || ''}
                options={channelOptions}
                onValueChange={(value) => onSelectChange('channel_id', value)}
                customStyles={customStyles}
                className="!w-fit"
              />
            </div>
            <div>
              <h5 className="font-bold mb-2">Priority</h5>
              <PrioritySelect
                value={ticket.priority_id}
                options={priorityOptions}
                onValueChange={(value) => onSelectChange('priority_id', value)}
                customStyles={customStyles}
                className="!w-fit"
              />
            </div>
            <div className="col-span-2">
              <h5 className="font-bold mb-1">Category</h5>
              <div className="w-fit">
                <CategoryPicker
                  id={`${id}-category-picker`}
                  categories={categories}
                  selectedCategories={[getSelectedCategoryId()]}
                  onSelect={handleCategoryChange}
                  placeholder="Select a category..."
                />
              </div>
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-lg font-semibold">Description</h2>
              {!isEditingDescription && (
                <button
                  onClick={() => setIsEditingDescription(true)}
                  className="p-1 hover:bg-gray-100 rounded-full transition-colors duration-200"
                  title="Edit description"
                >
                  <Pencil className="w-4 h-4 text-gray-500" />
                </button>
              )}
            </div>
            
            {isEditingDescription ? (
              <div>
                <TextEditor
                  id={`${id}-description-editor`}
                  initialContent={descriptionContent}
                  onContentChange={setDescriptionContent}
                />
                <div className="flex justify-end space-x-2 mt-2">
                  <Button
                    id="save-description-button"
                    onClick={async () => {
                      if (onUpdateDescription) {
                        const success = await onUpdateDescription(JSON.stringify(descriptionContent));
                        if (success) {
                          setIsEditingDescription(false);
                        }
                      }
                    }}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? 'Saving...' : 'Save'}
                  </Button>
                  <Button
                    id="cancel-description-button"
                    disabled={isSubmitting}
                    variant="outline"
                    onClick={() => {
                      // Reset to original content and cancel editing
                      setIsEditingDescription(false);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="prose max-w-none">
                {(() => {
                  // Get description from ticket attributes
                  const descriptionText = ticket.attributes?.description as string;

                  if (!descriptionText) return 'No description found.';

                  return <RichTextViewer content={descriptionText} />;
                })()}
              </div>
            )}
          </div>
          
          {/* Tags Section */}
          <div className="mt-6">
            <h2 className="text-lg font-semibold mb-2">Tags</h2>
            {onTagsChange && ticket.ticket_id ? (
              <TagManager
                entityId={ticket.ticket_id}
                entityType="ticket"
                initialTags={tags}
                onTagsChange={onTagsChange}
                useInlineInput={isInDrawer}
              />
            ) : (
              <p className="text-sm text-gray-500">Tags cannot be managed</p>
            )}
          </div>
        </div>
      </div>
    </ReflectionContainer>
  );
};

export default TicketInfo;
