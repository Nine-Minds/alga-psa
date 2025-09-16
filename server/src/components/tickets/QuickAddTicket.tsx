'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { addTicket } from 'server/src/lib/actions/ticket-actions/ticketActions';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { getContactsByCompany } from 'server/src/lib/actions/contact-actions/contactActions';
import { getCompanyLocations } from 'server/src/lib/actions/company-actions/companyLocationActions';
import { getTicketFormData } from 'server/src/lib/actions/ticket-actions/ticketFormActions';
import { getTicketCategoriesByChannel, ChannelCategoryData } from 'server/src/lib/actions/ticketCategoryActions';
import { IUser, IChannel, ITicketStatus, IPriority, IStandardPriority, ICompany, ICompanyLocation, IContact, ITicket, ITicketCategory } from 'server/src/interfaces';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { ChannelPicker } from 'server/src/components/settings/general/ChannelPicker';
import { CompanyPicker } from 'server/src/components/companies/CompanyPicker';
import { CategoryPicker } from './CategoryPicker';
import { ContactPicker } from 'server/src/components/ui/ContactPicker';
import CustomSelect, { SelectOption } from 'server/src/components/ui/CustomSelect';
import UserPicker from 'server/src/components/ui/UserPicker';
import { Input } from 'server/src/components/ui/Input';
import { TextArea } from 'server/src/components/ui/TextArea';
import { toast } from 'react-hot-toast';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { DialogComponent, FormFieldComponent, ButtonComponent, ContainerComponent } from 'server/src/types/ui-reflection/types';
import { withDataAutomationId } from 'server/src/types/ui-reflection/withDataAutomationId';
import { useRegisterUIComponent } from 'server/src/types/ui-reflection/useRegisterUIComponent';
import { ItilFields } from './ItilFields';
import { calculateItilPriority, ItilLabels } from '../../lib/utils/itilUtils';

// Helper function to format location display
const formatLocationDisplay = (location: ICompanyLocation): string => {
  const parts: string[] = [];
  
  if (location.location_name) {
    parts.push(location.location_name);
  }
  
  if (location.address_line1) {
    parts.push(location.address_line1);
  }
  
  if (location.city && location.state_province) {
    parts.push(`${location.city}, ${location.state_province}`);
  } else if (location.city) {
    parts.push(location.city);
  } else if (location.state_province) {
    parts.push(location.state_province);
  }
  
  if (location.postal_code) {
    parts.push(location.postal_code);
  }
  
  return parts.join(' - ') || 'Unnamed Location';
};

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
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
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
  const [channelConfig, setChannelConfig] = useState<ChannelCategoryData['channelConfig']>({
    category_type: 'custom',
    display_itil_impact: false,
    display_itil_urgency: false,
    display_itil_category: false,
  });
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [users, setUsers] = useState<IUser[]>([]);
  const [channels, setChannels] = useState<IChannel[]>([]);
  const [statuses, setStatuses] = useState<ITicketStatus[]>([]);
  const [priorities, setPriorities] = useState<IPriority[]>([]);
  const [companies, setCompanies] = useState<ICompany[]>([]);
  const [contacts, setContacts] = useState<IContact[]>([]);
  const [locations, setLocations] = useState<ICompanyLocation[]>([]);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [isPrefilledCompany, setIsPrefilledCompany] = useState(false);
  const [quickAddChannelFilterState, setQuickAddChannelFilterState] = useState<'active' | 'inactive' | 'all'>('active');

  // ITIL-specific state
  const [itilImpact, setItilImpact] = useState<number | undefined>(undefined);
  const [itilUrgency, setItilUrgency] = useState<number | undefined>(undefined);
  const [itilCategory, setItilCategory] = useState<string>('');
  const [itilSubcategory, setItilSubcategory] = useState<string>('');
  const [resolutionCode, setResolutionCode] = useState<string>('');
  const [rootCause, setRootCause] = useState<string>('');
  const [workaround, setWorkaround] = useState<string>('');

  // Calculate ITIL priority when impact and urgency are set
  const calculatedItilPriority = useMemo(() => {
    if (itilImpact && itilUrgency) {
      try {
        return calculateItilPriority(itilImpact, itilUrgency);
      } catch {
        return null;
      }
    }
    return null;
  }, [itilImpact, itilUrgency]);

  const { automationIdProps: dialogProps, updateMetadata } = useAutomationIdAndRegister<DialogComponent>({
    id: 'quick-add-ticket-dialog',
    type: 'dialog',
    label: 'Quick Add Ticket Dialog',
    helperText: "",
    title: 'Quick Add Ticket',
  });

  useEffect(() => {
    if (!open) {
      setIsSubmitting(false);
      setIsLoading(false);
      resetForm();
      return;
    }

    resetForm();
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const formData = await getTicketFormData(prefilledCompany?.id);

        setUsers(formData.users);
        setChannels(formData.channels);
        setPriorities(formData.priorities);
        setCompanies(formData.companies);

        if (Array.isArray(formData.statuses) && formData.statuses.length > 0) {
          setStatuses(formData.statuses);
        }

        if (formData.selectedCompany) {
          setIsPrefilledCompany(true);
          setCompanyId(formData.selectedCompany.company_id);
          setSelectedCompanyType(formData.selectedCompany.client_type as 'company' | 'individual');
          if (formData.contacts) {
            setContacts(formData.contacts);
          }
        } else {
          // No prefilled company, ensure isPrefilledCompany is false
          setIsPrefilledCompany(false);
        }

        if (prefilledContact) {
          setContactId(prefilledContact.id);
        }

        if (prefilledDescription) {
          setDescription(prefilledDescription);
        }

      } catch (error) {
        console.error('Error fetching form data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [open, prefilledCompany?.id]);

  useEffect(() => {
    const fetchCompanyData = async () => {
      if (!companyId) {
        // Clear both contacts and locations when no company is selected
        setContacts([]);
        setLocations([]);
        return;
      }

      console.log('Fetching company data for:', { companyId, isPrefilledCompany });

      try {
        // Fetch both locations and contacts (when needed) in parallel
        const promises: Promise<any>[] = [
          getCompanyLocations(companyId)
        ];
        
        // Only fetch contacts if not prefilled (contacts are already loaded for prefilled companies)
        if (!isPrefilledCompany) {
          promises.push(getContactsByCompany(companyId, 'all'));
        }
        
        const results = await Promise.all(promises);
        const locationsData = results[0];
        console.log('Fetched locations:', locationsData);
        setLocations(locationsData || []);
        
        if (!isPrefilledCompany) {
          const contactsData = results[1];
          console.log('Fetched contacts:', contactsData);
          setContacts(contactsData || []);
        }
      } catch (error) {
        console.error('Error fetching company data:', error);
        setLocations([]);
        // Only clear contacts if we were trying to fetch them
        if (!isPrefilledCompany) {
          setContacts([]);
        }
      }
    };

    fetchCompanyData();
  }, [companyId, isPrefilledCompany]);

  useEffect(() => {
    const fetchCategories = async () => {
      if (channelId) {
        try {
          const data = await getTicketCategoriesByChannel(channelId);
          console.log('QuickAddTicket received:', {
            data,
            categoriesType: Array.isArray(data?.categories) ? 'array' : typeof data?.categories,
            categoriesLength: data?.categories?.length
          });
          // Ensure data is properly resolved and categories is an array
          if (data && data.categories && Array.isArray(data.categories)) {
            setCategories(data.categories);
            setChannelConfig(data.channelConfig);
          } else {
            console.error('Invalid categories data received:', data);
            setCategories([]);
            setChannelConfig({
              category_type: 'custom',
              display_itil_impact: false,
              display_itil_urgency: false,
              display_itil_category: false,
            });
          }
        } catch (error) {
          console.error('Error fetching categories:', error);
          setCategories([]);
          setChannelConfig({
            category_type: 'custom',
            display_itil_impact: false,
            display_itil_urgency: false,
            display_itil_category: false,
          });
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

  useEffect(() => {
    if (!updateMetadata) return;

    updateMetadata({
      helperText: error || undefined,
      open: open,
    });
  }, [error, open]);

  const clearErrorIfSubmitted = () => {
    if (hasAttemptedSubmit) {
      setError(null);
    }
  };

  const handleCompanyChange = async (newCompanyId: string | null) => {
    if (isPrefilledCompany) return;

    setCompanyId(newCompanyId || '');
    setContactId(null);
    clearErrorIfSubmitted();

    if (newCompanyId !== null) {
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
    clearErrorIfSubmitted();
  };

  const handleItilFieldChange = (field: string, value: any) => {
    switch (field) {
      case 'itil_impact':
        setItilImpact(value);
        break;
      case 'itil_urgency':
        setItilUrgency(value);
        break;
      case 'itil_category':
        setItilCategory(value);
        break;
      case 'itil_subcategory':
        setItilSubcategory(value);
        break;
      case 'resolution_code':
        setResolutionCode(value);
        break;
      case 'root_cause':
        setRootCause(value);
        break;
      case 'workaround':
        setWorkaround(value);
        break;
    }
    clearErrorIfSubmitted();
  };

  const applyItilPriorityToTicketPriority = () => {
    if (calculatedItilPriority && priorities.length > 0) {
      // Try to map ITIL priority (1-5) to existing ticket priorities
      // Find a priority that matches or is closest to the ITIL priority level
      const sortedPriorities = [...priorities].sort((a, b) => a.order_number - b.order_number);

      let selectedPriority = sortedPriorities[0]; // Default to first priority

      if (calculatedItilPriority <= sortedPriorities.length) {
        selectedPriority = sortedPriorities[calculatedItilPriority - 1];
      } else {
        // If calculated priority exceeds available priorities, use the last one
        selectedPriority = sortedPriorities[sortedPriorities.length - 1];
      }

      setPriorityId(selectedPriority.priority_id);
      clearErrorIfSubmitted();
    }
  };

  const resetForm = () => {
    setTitle('');
    setDescription(prefilledDescription || '');
    setAssignedTo('');
    setChannelId('');
    setStatusId('');
    setPriorityId('');
    setCompanyId(prefilledCompany?.id || '');
    setContactId(prefilledContact?.id || null);
    setLocationId(null);
    setLocations([]);
    setContacts([]);
    // Reset isPrefilledCompany - it will be set to true again if there's a prefilled company
    setIsPrefilledCompany(false);
    if (prefilledCompany?.id) {
      const company = companies.find(c => c.company_id === prefilledCompany.id);
      setSelectedCompanyType(company?.client_type as 'company' | 'individual' || null);
    } else {
      setSelectedCompanyType(null);
    }
    setSelectedCategories([]);
    // Reset ITIL fields
    setItilImpact(undefined);
    setItilUrgency(undefined);
    setItilCategory('');
    setItilSubcategory('');
    setResolutionCode('');
    setRootCause('');
    setWorkaround('');
    setError(null);
    setHasAttemptedSubmit(false);
  };

  const handleClose = () => {
    resetForm();
    onOpenChange(false);
  };


  const validateForm = () => {
    const validationErrors: string[] = [];
    if (!title.trim()) validationErrors.push('Title');
    if (!description.trim()) validationErrors.push('Description');
    if (!assignedTo) validationErrors.push('Assigned To');
    if (!channelId) validationErrors.push('Channel');
    if (!statusId) validationErrors.push('Status');
    if (!priorityId) validationErrors.push('Priority');
    if (!companyId) validationErrors.push('Client');
    return validationErrors;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);

      const validationErrors = validateForm();
    if (validationErrors.length > 0) {
      setError(validationErrors.join('\n'));
      return;
    }

    setIsSubmitting(true);

    try {
      const user = await getCurrentUser();
      if (!user) {
        throw new Error('You must be logged in to create a ticket');
      }

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

      if (locationId) {
        formData.append('location_id', locationId);
      }

      if (selectedCategories.length > 0) {
        const category = categories.find(c => c.category_id === selectedCategories[0]);
        if (category) {
          if (category.parent_category) {
            // This is a subcategory - set parent as category and this as subcategory
            formData.append('category_id', category.parent_category);
            formData.append('subcategory_id', category.category_id);
          } else {
            // This is a parent category - only set category_id
            formData.append('category_id', category.category_id);
          }
        }
      }

      // Add ITIL fields if provided
      if (itilImpact) {
        formData.append('itil_impact', itilImpact.toString());
      }
      if (itilUrgency) {
        formData.append('itil_urgency', itilUrgency.toString());
      }
      if (itilCategory) {
        formData.append('itil_category', itilCategory);
      }
      if (itilSubcategory) {
        formData.append('itil_subcategory', itilSubcategory);
      }
      if (resolutionCode) {
        formData.append('resolution_code', resolutionCode);
      }
      if (rootCause) {
        formData.append('root_cause', rootCause);
      }
      if (workaround) {
        formData.append('workaround', workaround);
      }

      const newTicket = await addTicket(formData, user);
      if (!newTicket) {
        throw new Error('Failed to create ticket');
      }


      await onTicketAdded(newTicket);
      resetForm();
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


  const memoizedStatusOptions = useMemo(
    () =>
      statuses.map((status): SelectOption => ({
        value: status.status_id,
        label: status.name ?? ""
      })),
    [statuses]
  );

  const memoizedPriorityOptions = useMemo(
    () =>
      priorities.map((priority): SelectOption => ({
        value: priority.priority_id,
        label: (
          <div className="flex items-center gap-2">
            <div 
              className="w-3 h-3 rounded-full border border-gray-300" 
              style={{ backgroundColor: priority.color || '#6B7280' }}
            />
            <span>{priority.priority_name}</span>
          </div>
        )
      })),
    [priorities]
  );

  return (
    <div>
      <Dialog
        id={`${id}-dialog`}
        isOpen={open}
        onClose={handleClose}
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
        title="Add Ticket"
      >
        <DialogContent>
          {isLoading ? (
            <div className="flex items-center justify-center p-6">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500" />
            </div>
          ) : (
            <>
              {hasAttemptedSubmit && error && (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>
                    <p className="font-medium mb-2">Please fill in the required fields:</p>
                    <ul className="list-disc list-inside space-y-1">
                      {error.split('\n').map((err, index) => (
                        <li key={index}>{err}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              <ReflectionContainer id={`${id}-form`} label="Quick Add Ticket Form">
                <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                  <Input
                    id={`${id}-title`}
                    value={title}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      clearErrorIfSubmitted();
                    }}
                    placeholder="Ticket Title *"
                    className={hasAttemptedSubmit && !title.trim() ? 'border-red-500' : ''}
                  />
                  <TextArea
                    id={`${id}-description`}
                    value={description}
                    onChange={(e) => {
                      setDescription(e.target.value);
                      clearErrorIfSubmitted();
                    }}
                    placeholder="Description *"
                    className={hasAttemptedSubmit && !description.trim() ? 'border-red-500' : ''}
                  />

                  <div className={hasAttemptedSubmit && !companyId ? 'ring-1 ring-red-500 rounded-lg' : ''}>
                    <CompanyPicker
                      id={`${id}-company`}
                      companies={filteredCompanies}
                      onSelect={handleCompanyChange}
                      selectedCompanyId={companyId}
                      filterState={companyFilterState}
                      onFilterStateChange={setCompanyFilterState}
                      clientTypeFilter={clientTypeFilter}
                      onClientTypeFilterChange={setClientTypeFilter}
                      placeholder="Select Client *"
                    />
                  </div>

                  {companyId && selectedCompanyType === 'company' && (
                    <ContactPicker
                      id={`${id}-contact`}
                      contacts={contacts}
                      value={contactId || ''}
                      onValueChange={(value) => {
                        setContactId(value || null);
                        clearErrorIfSubmitted();
                      }}
                      companyId={companyId}
                      placeholder={
                        contacts.length === 0
                          ? "No contacts for selected client"
                          : "Select contact"
                      }
                      disabled={contacts.length === 0}
                      buttonWidth="full"
                    />
                  )}
                  {companyId && (
                    <CustomSelect
                      id={`${id}-location`}
                      value={locationId || ''}
                      onValueChange={(value) => {
                        setLocationId(value || null);
                        clearErrorIfSubmitted();
                      }}
                      options={locations.map(location => ({
                        value: location.location_id,
                        label: formatLocationDisplay(location) + (location.is_default ? ' (Default)' : '')
                      }))}
                      placeholder={locations.length === 0 ? "No locations for selected client" : "No specific location"}
                    />
                  )}
                  <div className={hasAttemptedSubmit && !assignedTo ? 'ring-1 ring-red-500 rounded-lg' : ''}>
                    <UserPicker
                      value={assignedTo}
                      onValueChange={(value) => {
                        setAssignedTo(value);
                        clearErrorIfSubmitted();
                      }}
                      users={users.map(user => ({
                        ...user,
                        roles: []
                      }))}
                      buttonWidth="full"
                      size="sm"
                      placeholder="Assign To *"
                    />
                  </div>

                  <div className={hasAttemptedSubmit && !channelId ? 'ring-1 ring-red-500 rounded-lg' : ''}>
                    <ChannelPicker
                      id={`${id}-channel-picker`}
                      channels={channels}
                      onSelect={handleChannelChange}
                      selectedChannelId={channelId}
                      onFilterStateChange={setQuickAddChannelFilterState}
                      filterState={quickAddChannelFilterState}
                      placeholder="Select Board *"
                    />
                  </div>

                  {channelId && channelConfig.category_type === 'custom' && (
                    <CategoryPicker
                      id={`${id}-category-picker`}
                      categories={categories}
                      selectedCategories={selectedCategories}
                      onSelect={(categoryIds) => {
                        setSelectedCategories(categoryIds);
                        clearErrorIfSubmitted();
                      }}
                      placeholder="Select category"
                      multiSelect={false}
                      className="w-full"
                    />
                  )}

                  <CustomSelect
                    id={`${id}`}
                    value={statusId}
                    onValueChange={(value) => {
                      setStatusId(value);
                      clearErrorIfSubmitted();
                    }}
                    options={memoizedStatusOptions}
                    placeholder="Select Status *"
                    className={hasAttemptedSubmit && !statusId ? 'border-red-500' : ''}
                  />

                  <CustomSelect
                    id={`${id}-priority`}
                    value={priorityId}
                    onValueChange={(value) => {
                      setPriorityId(value);
                      clearErrorIfSubmitted();
                    }}
                    options={memoizedPriorityOptions}
                    placeholder="Select Priority *"
                    className={hasAttemptedSubmit && !priorityId ? 'border-red-500' : ''}
                  />

                  {/* ITIL Priority Integration Helper */}
                  {channelId && channelConfig.category_type === 'itil' && calculatedItilPriority && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className="text-sm text-blue-800 font-medium">
                            ITIL Calculated Priority:
                          </span>
                          <span className={`px-2 py-1 rounded text-sm font-semibold ${
                            calculatedItilPriority === 1 ? 'bg-red-100 text-red-800' :
                            calculatedItilPriority === 2 ? 'bg-orange-100 text-orange-800' :
                            calculatedItilPriority === 3 ? 'bg-yellow-100 text-yellow-800' :
                            calculatedItilPriority === 4 ? 'bg-blue-100 text-blue-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {ItilLabels.priority[calculatedItilPriority]}
                          </span>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={applyItilPriorityToTicketPriority}
                          className="text-xs"
                        >
                          Apply to Priority
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* ITIL Fields Section */}
                  {channelId && channelConfig.category_type === 'itil' && (
                    <div className="border-t pt-4">
                      <h3 className="text-sm font-medium mb-4 text-gray-700">ITIL Classification</h3>
                      <ItilFields
                        values={{
                          itil_impact: itilImpact,
                          itil_urgency: itilUrgency,
                          itil_category: itilCategory,
                          itil_subcategory: itilSubcategory,
                          resolution_code: resolutionCode,
                          root_cause: rootCause,
                          workaround: workaround
                        }}
                        onChange={handleItilFieldChange}
                        readOnly={false}
                        showResolutionFields={false}
                      />
                    </div>
                  )}

                  <DialogFooter>
                    <Button
                      id={`${id}-cancel-btn`}
                      type="button"
                      variant="outline"
                      onClick={handleClose}
                    >
                      Cancel
                    </Button>
                    <Button
                      id={`${id}-submit-btn`}
                      type="submit"
                      variant="default"
                      disabled={isSubmitting}
                      className={!title.trim() || !description.trim() || !assignedTo || !channelId || !statusId || !priorityId || !companyId ? 'opacity-50' : ''}
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
