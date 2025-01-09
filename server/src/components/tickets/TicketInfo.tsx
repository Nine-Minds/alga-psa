'use client';

import React, { useEffect, useState } from 'react';
import { ITicket, IComment, ITicketCategory } from '../../interfaces';
import CustomSelect from '../ui/CustomSelect';
import { CategoryPicker } from './CategoryPicker';
import styles from './TicketDetails.module.css';
import { getTicketCategories } from '../../lib/actions/ticketCategoryActions';
import { Pencil, Check } from 'lucide-react';
import { withDataAutomationId } from '@/types/ui-reflection/withDataAutomationId';
import { useRegisterUIComponent } from '@/types/ui-reflection/useRegisterUIComponent';
import { ContainerComponent, FormFieldComponent } from '@/types/ui-reflection/types';
import { useAutomationIdAndRegister } from '@/types/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from '@/types/ui-reflection/ReflectionContainer';

interface TicketInfoProps {
  id: string; // Made required since it's needed for reflection registration
  ticket: ITicket;
  conversations: IComment[];
  statusOptions: { value: string; label: string }[];
  agentOptions: { value: string; label: string }[];
  channelOptions: { value: string; label: string }[];
  priorityOptions: { value: string; label: string }[];
  onSelectChange: (field: keyof ITicket, newValue: string | null) => void;
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
}) => {
  const [categories, setCategories] = useState<ITicketCategory[]>([]);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(ticket.title);

  // Register with UI reflection system
  const { automationIdProps: containerProps } = useAutomationIdAndRegister<ContainerComponent>({
    id,
    type: 'container',
    label: `Info for ticket ${ticket.ticket_number}`
  });

  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const fetchedCategories = await getTicketCategories();
        setCategories(fetchedCategories);
      } catch (error) {
        console.error('Failed to fetch categories:', error);
      }
    };

    fetchCategories();
  }, []);

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

  return (
    <ReflectionContainer id={id} label={`Info for ticket ${ticket.ticket_number}`}>
      <div className={`${styles['card']}`}>
        <div className="p-6">
          <div className="flex items-center gap-2 mb-4">
            {isEditingTitle ? (
              <div className="flex items-center gap-2 flex-1">
                <input

                  type="text"
                  value={titleValue}
                  onChange={(e) => setTitleValue(e.target.value)}
                  onKeyDown={handleTitleKeyDown}
                  autoFocus
                  className="text-2xl font-bold flex-1 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
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
                {...useAutomationIdAndRegister<FormFieldComponent>({
                  id: `${id}-status-select`,
                  type: 'formField',
                  fieldType: 'select',
                  label: 'Status',
                  value: ticket.status_id || ''
                }).automationIdProps}
                value={ticket.status_id || ''}
                options={statusOptions}
                onValueChange={(value) => onSelectChange('status_id', value)}
                customStyles={customStyles}
                className="!w-fit"
              />
            </div>
            <div>
              <h5 className="font-bold mb-2">Assigned To</h5>
              <CustomSelect
                {...useAutomationIdAndRegister<FormFieldComponent>({
                  id: `${id}-assigned-to-select`,
                  type: 'formField',
                  fieldType: 'select',
                  label: 'Assigned To',
                  value: ticket.assigned_to || ''
                }).automationIdProps}
                value={ticket.assigned_to || ''}
                options={agentOptions}
                onValueChange={(value) => onSelectChange('assigned_to', value)}
                customStyles={customStyles}
                className="!w-fit"
              />
            </div>
            <div>
              <h5 className="font-bold mb-2">Channel</h5>
              <CustomSelect
                {...useAutomationIdAndRegister<FormFieldComponent>({
                  id: `${id}-channel-select`,
                  type: 'formField',
                  fieldType: 'select',
                  label: 'Channel',
                  value: ticket.channel_id || ''
                }).automationIdProps}
                value={ticket.channel_id || ''}
                options={channelOptions}
                onValueChange={(value) => onSelectChange('channel_id', value)}
                customStyles={customStyles}
                className="!w-fit"
              />
            </div>
            <div>
              <h5 className="font-bold mb-2">Priority</h5>
              <CustomSelect
                {...useAutomationIdAndRegister<FormFieldComponent>({
                  id: `${id}-priority-select`,
                  type: 'formField',
                  fieldType: 'select',
                  label: 'Priority',
                  value: ticket.priority_id || ''
                }).automationIdProps}
                value={ticket.priority_id || ''}
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
          <div className="mb-6">
            <h2 className="text-lg font-semibold mb-2">Description</h2>
            <p {...useAutomationIdAndRegister<ContainerComponent>({
              id: `${id}-description`,
              type: 'container',
              label: 'Description'
            }).automationIdProps}>
              {conversations.find(conv => conv.is_initial_description)?.note || 'No initial description found.'}
            </p>
          </div>
        </div>
      </div>
    </ReflectionContainer>
  );
};

export default TicketInfo;
