'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/Dialog';
import { Button } from '../ui/Button';
import { AlertCircle } from 'lucide-react';
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

  const { automationIdProps: dialogProps, updateMetadata } = useAutomationIdAndRegister<DialogComponent>({
    id: 'quick-add-ticket-dialog',
    type: 'dialog',
    label: 'Quick Add Ticket Dialog',
    helperText: "",
    // open: open,
    title: 'Quick Add Ticket',
  });

  // const updateMetadata = useRegisterUIComponent<DialogComponent>({
  //   id: 'quick-add-ticket-dialog',
  //   type: 'dialog',
  //   label: 'Quick Add Ticket Dialog',
  //   // open: open,
  //   title: 'Quick Add Ticket',
  // })

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

  // Update dialog metadata when error or open state changes
  useEffect(() => {
    if (!updateMetadata) return;

    updateMetadata({
      helperText: error || undefined,
      open: open,
    });
  }, [error, open]);

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

  const memoizedUserOptions = useMemo(
    () =>
      users.map((user) => ({
        value: user.user_id,
        label: user.first_name + ' ' + user.last_name,
      })),
    [users]
  );

  const memoizedStatusOptions = useMemo(
    () =>
      statuses.map((status): SelectOption => ({
        value: status.status_id,
        label: status.name ?? ""
      })),
    [statuses]
  );

  const memoizedContactOptions = useMemo(
    () =>
      contacts.map((contact): SelectOption => ({
        value: contact.contact_name_id,
        label: contact.full_name
      })),
    [contacts]
  );

  const memoizedPriorityOptions = useMemo(
    () =>
      priorities.map((priority): SelectOption => ({
        value: priority.priority_id,
        label: priority.priority_name
      })),
    [priorities]
  );

  return (
    <div>
      <Dialog
        id={`${id}-dialog`}
        isOpen={open}
        onClose={() => onOpenChange(false)}
      >
        <DialogHeader>
          <DialogTitle>Quick Add Ticket</DialogTitle>
        </DialogHeader>
        <DialogContent>
          {isLoading ? (
            <div className="flex items-center justify-center p-6">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500" />
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-start space-x-2">
                  <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <span className="text-red-700 text-sm">{error}</span>
                </div>
              )}

              <ReflectionContainer id={`${id}-form`} label="Quick Add Ticket Form">
                <form onSubmit={handleSubmit} className="space-y-4">
                  <Input
                    id={`${id}-title`}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Ticket Title"
                    required
                  />
                  <TextArea
                    id={`${id}-description`}
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
                        id={`${id}-contact`}
                        value={contactId || ''}
                        onValueChange={(value) => setContactId(value || null)}
                        options={memoizedContactOptions}
                        placeholder="Select Contact"
                        disabled={!companyId || selectedCompanyType !== 'company'}
                      />
                    </div>
                  )}

                  <div className="relative z-30">
                    <CustomSelect
                      id={`${id}-assigned-to`}
                      value={assignedTo}
                      onValueChange={setAssignedTo}
                      options={memoizedUserOptions}
                      placeholder="Assign To"
                    />
                  </div>

                  <ChannelPicker
                    id={`${id}-channel-picker`}
                    channels={channels}
                    onSelect={handleChannelChange}
                    selectedChannelId={channelId}
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
                      id={`${id}`}
                      value={statusId}
                      onValueChange={setStatusId}
                      options={memoizedStatusOptions}
                      placeholder="Select Status"
                    />
                  </div>

                  <div className="relative z-10">
                    <CustomSelect
                      id={`${id}-priority`}
                      value={priorityId}
                      onValueChange={setPriorityId}
                      options={memoizedPriorityOptions}
                      placeholder="Select Priority"
                    />
                  </div>

                  <DialogFooter>
                    <Button
                      id={`${id}-cancel-btn`}
                      type="button"
                      variant="outline"
                      onClick={() => onOpenChange(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      id={`${id}-submit-btn`}
                      type="submit"
                      variant="default"
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? 'Saving...' : 'Save Ticket'}
                    </Button>
                  </DialogFooter>
                </form>
              </ReflectionContainer>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
