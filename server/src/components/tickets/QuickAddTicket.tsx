'use client';

import React, { useState, useEffect, useMemo } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '../ui/Button';
import { X, AlertCircle } from 'lucide-react';
import { addTicket } from '../../lib/actions/ticket-actions/ticketActions';
import { getCurrentUser } from '../../lib/actions/user-actions/userActions';
import { getContactsByCompany } from '../../lib/actions/contact-actions/contactActions';
import { getTicketFormData } from '../../lib/actions/ticket-actions/ticketFormActions';
import { getTicketCategoriesByChannel } from '../../lib/actions/categoryActions';
import { IUser, IChannel, ITicketStatus, IPriority, ICompany, IContact, ITicket, ITicketCategory } from '../../interfaces';
import { TicketFormData } from '../../lib/actions/ticket-actions/ticketFormActions';
import { ChannelPicker } from '../settings/general/ChannelPicker';
import { CompanyPicker } from '../companies/CompanyPicker';
import { CategoryPicker } from './CategoryPicker';
import CustomSelect, { SelectOption } from '../ui/CustomSelect';
import { Input } from '../ui/Input';
import { TextArea } from '../ui/TextArea';
import { toast } from 'react-hot-toast';
import { useAutomationIdAndRegister } from '../../types/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from '../../types/ui-reflection/ReflectionContainer';
import { DialogComponent, FormFieldComponent, ButtonComponent, ContainerComponent } from '../../types/ui-reflection/types';
import { withDataAutomationId } from '@/types/ui-reflection/withDataAutomationId';
import { useRegisterUIComponent } from '@/types/ui-reflection/useRegisterUIComponent';

interface QuickAddTicketProps {
  id?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTicketAdded: (ticket: ITicket) => void;
  prefilledCompany?: {
    id: string;
    name: string;
  };
  prefilledContact?: {
    id: string;
    name: string;
  };
  prefilledDescription?: string;
  isEmbedded?: boolean;
}

export function QuickAddTicket({ 
  id = 'ticket-quick-add',
  open, 
  onOpenChange, 
  onTicketAdded, 
  prefilledCompany, 
  prefilledContact, 
  prefilledDescription,
  isEmbedded = false
}: QuickAddTicketProps) {
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState(prefilledDescription || '');
  const [assignedTo, setAssignedTo] = useState('');
  const [channelId, setChannelId] = useState('');
  const [statusId, setStatusId] = useState('');
  const [priorityId, setPriorityId] = useState('');
  const [companyId, setCompanyId] = useState(prefilledCompany?.id || '');
  const [contactId, setContactId] = useState(prefilledContact?.id || null);
  const [companyFilterState, setCompanyFilterState] = useState<'all' | 'active' | 'inactive'>('all');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [selectedCompanyType, setSelectedCompanyType] = useState<'company' | 'individual' | null>(null);
  const [categories, setCategories] = useState<ITicketCategory[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [users, setUsers] = useState<IUser[]>([]);
  const [channels, setChannels] = useState<IChannel[]>([]);
  const [statuses, setStatuses] = useState<ITicketStatus[]>([]);
  const [priorities, setPriorities] = useState<IPriority[]>([]);
  const [companies, setCompanies] = useState<ICompany[]>([]);
  const [contacts, setContacts] = useState<IContact[]>([]);
  const [isPrefilledCompany, setIsPrefilledCompany] = useState(false);

  // Register all components with UI reflection system
  const { automationIdProps: titleProps } = useAutomationIdAndRegister<FormFieldComponent>({
    id: `${id}-title-input`,
    type: 'formField',
    fieldType: 'textField',
    label: 'Title',
    value: title,
    required: true
  });

  const { automationIdProps: descriptionProps } = useAutomationIdAndRegister<FormFieldComponent>({
    id: `${id}-description-input`,
    type: 'formField',
    fieldType: 'textField',
    label: 'Description',
    value: description,
    required: true
  });

  const { automationIdProps: assignedToProps } = useAutomationIdAndRegister<FormFieldComponent>({
    id: `${id}-assigned-to-select`,
    type: 'formField',
    fieldType: 'select',
    label: 'Assign To',
    value: assignedTo
  });

  const { automationIdProps: statusProps } = useAutomationIdAndRegister<FormFieldComponent>({
    id: `${id}-status-select`,
    type: 'formField',
    fieldType: 'select',
    label: 'Status',
    value: statusId
  });

  const { automationIdProps: priorityProps } = useAutomationIdAndRegister<FormFieldComponent>({
    id: `${id}-priority-select`,
    type: 'formField',
    fieldType: 'select',
    label: 'Priority',
    value: priorityId
  });

  const { automationIdProps: contactProps } = useAutomationIdAndRegister<FormFieldComponent>({
    id: `${id}-contact-select`,
    type: 'formField',
    fieldType: 'select',
    label: 'Contact',
    value: contactId || '',
    disabled: !companyId || selectedCompanyType !== 'company'
  });

  const { automationIdProps: cancelButtonProps } = useAutomationIdAndRegister<ButtonComponent>({
    id: `${id}-cancel-btn`,
    type: 'button',
    label: 'Cancel',
    actions: ['click']
  });

  const { automationIdProps: saveButtonProps } = useAutomationIdAndRegister<ButtonComponent>({
    id: `${id}-save-btn`,
    type: 'button',
    label: 'Save Ticket',
    disabled: isSubmitting,
    actions: ['click']
  });

  const { automationIdProps: closeButtonProps } = useAutomationIdAndRegister<ButtonComponent>({
    id: `${id}-close-btn`,
    type: 'button',
    label: 'Close',
    actions: ['click']
  });

  useEffect(() => {
    if (!open) {
      setError(null);
      setIsSubmitting(false);
      setIsLoading(false);
      return;
    }
    
    const fetchData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const formData = await getTicketFormData(prefilledCompany?.id);
        
        setUsers(formData.users);
        setChannels(formData.channels);
        setPriorities(formData.priorities);
        setCompanies(formData.companies);

        if (Array.isArray(formData.statuses) && formData.statuses.length > 0) {
          setStatuses(formData.statuses);
          if (!statusId) {
            const defaultStatus = formData.statuses.find(s => !s.is_closed);
            if (defaultStatus) {
              setStatusId(defaultStatus.status_id);
            }
          }
        }

        if (formData.selectedCompany) {
          setIsPrefilledCompany(true);
          setCompanyId(formData.selectedCompany.company_id);
          setSelectedCompanyType(formData.selectedCompany.client_type as 'company' | 'individual');
          if (formData.contacts) {
            setContacts(formData.contacts);
          }
        }
        if (formData.selectedCompany) {
          setIsPrefilledCompany(true);
          setCompanyId(formData.selectedCompany.company_id);
          setSelectedCompanyType(formData.selectedCompany.client_type as 'company' | 'individual');
          if (formData.contacts) {
            setContacts(formData.contacts);
          }
        }

        if (prefilledContact) {
          setContactId(prefilledContact.id);
        }

        if (prefilledDescription) {
          setDescription(prefilledDescription);
        }
      } catch (error) {
        console.error('Error fetching form data:', error);
        setError('Failed to load form data. Please try again.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [open, prefilledCompany?.id]);

  useEffect(() => {
    const fetchContacts = async () => {
      if (companyId && !isPrefilledCompany) {
        try {
          const contactsData = await getContactsByCompany(companyId);
          setContacts(contactsData || []);
        } catch (error) {
          console.error('Error fetching contacts:', error);
          setContacts([]);
        }
      } else if (!isPrefilledCompany) {
        setContacts([]);
      }
    };
    
    if (companyId) {
      fetchContacts();
    }
  }, [companyId, isPrefilledCompany]);

  useEffect(() => {
    const fetchCategories = async () => {
      if (channelId) {
        try {
          const categoriesData = await getTicketCategoriesByChannel(channelId);
          setCategories(categoriesData || []);
        } catch (error) {
          console.error('Error fetching categories:', error);
          setCategories([]);
        }
      } else {
        setCategories([]);
        setSelectedCategories([]);
      }
    };

    if (channelId) {
      fetchCategories();
    }
  }, [channelId]);

  const handleCompanyChange = async (newCompanyId: string) => {
    if (isPrefilledCompany) return;

    setCompanyId(newCompanyId);
    setContactId(null);
    setError(null);
  
    if (newCompanyId) {
      const selectedCompany = companies.find(company => company.company_id === newCompanyId);
      
      if (selectedCompany?.client_type === 'company') {
        setSelectedCompanyType('company');
      } else if (selectedCompany?.client_type === 'individual') {
        setSelectedCompanyType('individual');
      } else {
        setSelectedCompanyType(null);
      }
    } else {
      setSelectedCompanyType(null);
    }
  };

  const handleChannelChange = (newChannelId: string) => {
    setChannelId(newChannelId);
    setSelectedCategories([]);
  };
    
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const user = await getCurrentUser();
      if (!user) {
        throw new Error('You must be logged in to create a ticket');
      }

      if (!title.trim()) throw new Error('Title is required');
      if (!description.trim()) throw new Error('Description is required');
      if (!assignedTo) throw new Error('Please assign the ticket to someone');
      if (!channelId) throw new Error('Please select a channel');
      if (!statusId) throw new Error('Please select a status');
      if (!priorityId) throw new Error('Please select a priority');
      if (!companyId) throw new Error('Please select a company');

      const formData = new FormData();
      formData.append('title', title);
      formData.append('description', description);
      formData.append('assigned_to', assignedTo);
      formData.append('channel_id', channelId);
      formData.append('status_id', statusId);
      formData.append('priority_id', priorityId);
      formData.append('company_id', companyId);
      
      if (selectedCompanyType === 'company' && contactId) {
        formData.append('contact_name_id', contactId);
      }

      if (selectedCategories.length > 0) {
        const category = categories.find(c => c.category_id === selectedCategories[0]);
        if (category) {
          formData.append('category_id', category.category_id);
          if (category.parent_category) {
            formData.append('subcategory_id', category.category_id);
            formData.append('category_id', category.parent_category);
          }
        }
      }

      const newTicket = await addTicket(formData, user);
      if (!newTicket) {
        throw new Error('Failed to create ticket');
      }
      
      await onTicketAdded(newTicket);
      
      setTitle('');
      setDescription('');
      setAssignedTo('');
      setChannelId('');
      setStatusId('');
      setPriorityId('');
      setCompanyId('');
      setContactId(null);
      setSelectedCompanyType(null);
      setSelectedCategories([]);
      setError(null);
      
      onOpenChange(false);
    } catch (error) {
      console.error('Error creating ticket:', error);
      setError(error instanceof Error ? error.message : 'Failed to create ticket. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredCompanies = companies.filter(company => {
    if (companyFilterState === 'all') return true;
    if (companyFilterState === 'active') return !company.is_inactive;
    if (companyFilterState === 'inactive') return company.is_inactive;
    return true;
  });

  if (isLoading) {
    return (
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 animate-fade-in" />
          <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 animate-scale-in">
            <div className="bg-white p-6 rounded-lg shadow-lg">
              <div className="flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500" />
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  const dialogContent = (
    <ReflectionContainer id={id} label="Quick Add Ticket Form">
      <div className="bg-white p-6 rounded-lg shadow-lg w-96 max-h-[90vh] overflow-y-auto">
        <Dialog.Title className="text-xl font-bold mb-4">Quick Add Ticket</Dialog.Title>
        <Dialog.Description className="sr-only">
          Form to create a new ticket with fields for title, description, company, contact, assignee, channel, category, status, and priority.
        </Dialog.Description>
        
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-start space-x-2">
            <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
            <span className="text-red-700 text-sm">{error}</span>
          </div>
        )}

        <ReflectionContainer id={`${id}-form`} label="Quick Add Ticket Form">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              {...titleProps}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ticket Title"
              required
            />
            <TextArea
              {...descriptionProps}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description"
              required
            />

            <CompanyPicker
              id={`${id}-company-picker`}
              companies={filteredCompanies}
              onSelect={handleCompanyChange}
              selectedCompanyId={companyId}
              filterState={companyFilterState}
              onFilterStateChange={setCompanyFilterState}
              clientTypeFilter={clientTypeFilter}
              onClientTypeFilterChange={setClientTypeFilter}
            />

            {selectedCompanyType === 'company' && contacts.length > 0 && (
              <div className="relative z-20">
                <CustomSelect
                  {...contactProps}
                  value={contactId || ''}
                  onValueChange={(value) => setContactId(value || null)}
                  options={contacts.map((contact): SelectOption => ({
                    value: contact.contact_name_id,
                    label: contact.full_name
                  }))}
                  placeholder="Select Contact"
                  disabled={!companyId || selectedCompanyType !== 'company'}
                />
              </div>
            )}

            <div className="relative z-30">
              <CustomSelect
                {...assignedToProps}
                value={assignedTo}
                onValueChange={setAssignedTo}
                options={users.map((user): SelectOption => ({
                  value: user.user_id,
                  label: `${user.first_name} ${user.last_name}`
                }))}
                placeholder="Assign To"
              />
            </div>

            <ChannelPicker
              id={`${id}-channel-picker`}
              channels={channels}
              onSelect={handleChannelChange}
              selectedChannelId={channelId}
              onFilterStateChange={() => {}}
              filterState="all"
            />

            <CategoryPicker
              id={`${id}-category-picker`}
              categories={categories}
              selectedCategories={selectedCategories}
              onSelect={(categoryIds) => setSelectedCategories(categoryIds)}
              placeholder={channelId ? "Select category" : "Select a channel first"}
              multiSelect={false}
              className="w-full"
            />

            <div className="relative z-20">
              <CustomSelect
                {...statusProps}
                value={statusId}
                onValueChange={setStatusId}
                options={statuses.map((status): SelectOption => ({
                  value: status.status_id!,
                  label: status.name ?? ""
                }))}
                placeholder="Select Status"
              />
            </div>

            <div className="relative z-10">
              <CustomSelect
                {...priorityProps}
                value={priorityId}
                onValueChange={setPriorityId}
                options={priorities.map((priority): SelectOption => ({
                  value: priority.priority_id,
                  label: priority.priority_name
                }))}
                placeholder="Select Priority"
              />
            </div>

            <div className="flex justify-end space-x-2 pt-4">
              <Button 
                {...cancelButtonProps}
                type="button" 
                variant="outline" 
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button 
                {...saveButtonProps}
                type="submit" 
                variant="default" 
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Saving...' : 'Save Ticket'}
              </Button>
            </div>
          </form>
        </ReflectionContainer>
      </div>
    </ReflectionContainer>
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay 
          className="fixed inset-0 bg-black/50 animate-fade-in"
          onClick={() => onOpenChange(false)}
        />
        <Dialog.Content 
          className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 animate-scale-in"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          {dialogContent}
          <Dialog.Close asChild>
            <Button 
              {...closeButtonProps}
              variant="ghost"
              className="absolute top-4 right-4" 
              aria-label="Close"
              tabIndex={-1}
            >
              <X className="h-4 w-4" />
            </Button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
