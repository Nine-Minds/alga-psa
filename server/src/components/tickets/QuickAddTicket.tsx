'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { HelpCircle } from 'lucide-react';
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
import { calculateItilPriority, ItilLabels, getItilCategoriesAsTicketCategories } from '../../lib/utils/itilUtils';

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
    priority_type: 'custom',
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
  const [showPriorityMatrix, setShowPriorityMatrix] = useState(false);
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

  // ITIL options for selects
  const itilImpactOptions: SelectOption[] = [
    { value: '1', label: '1 - High (Critical business function affected)' },
    { value: '2', label: '2 - Medium-High (Important function affected)' },
    { value: '3', label: '3 - Medium (Minor function affected)' },
    { value: '4', label: '4 - Medium-Low (Minimal impact)' },
    { value: '5', label: '5 - Low (No business impact)' }
  ];

  const itilUrgencyOptions: SelectOption[] = [
    { value: '1', label: '1 - High (Work cannot continue)' },
    { value: '2', label: '2 - Medium-High (Work severely impaired)' },
    { value: '3', label: '3 - Medium (Work continues with limitations)' },
    { value: '4', label: '4 - Medium-Low (Minor inconvenience)' },
    { value: '5', label: '5 - Low (Work continues normally)' }
  ];

  // Get ITIL categories in the same format as custom categories
  const itilCategoriesForPicker = useMemo(() => {
    return getItilCategoriesAsTicketCategories();
  }, []);

  // Get currently selected ITIL category ID for CategoryPicker
  const getSelectedItilCategoryId = (): string => {
    if (!itilCategory) return '';

    // If we have both category and subcategory, return the subcategory ID
    if (itilSubcategory) {
      const categoryKey = itilCategory.toLowerCase().replace(/\s+/g, '-');
      const subcategoryKey = itilSubcategory.toLowerCase().replace(/[\s\/]+/g, '-');
      return `itil-${categoryKey}-${subcategoryKey}`;
    }

    // If we only have category, return the parent category ID
    const categoryKey = itilCategory.toLowerCase().replace(/\s+/g, '-');
    return `itil-${categoryKey}`;
  };

  // Handle ITIL category selection from CategoryPicker
  const handleItilCategoryChange = (categoryIds: string[]) => {
    if (categoryIds.length === 0) {
      // Clear both category and subcategory
      setItilCategory('');
      setItilSubcategory('');
      return;
    }

    const selectedCategoryId = categoryIds[0];
    const selectedCategory = itilCategoriesForPicker.find(c => c.category_id === selectedCategoryId);

    if (!selectedCategory) {
      console.error('Selected ITIL category not found');
      return;
    }

    if (selectedCategory.parent_category) {
      // This is a subcategory selection
      const parentCategory = itilCategoriesForPicker.find(c => c.category_id === selectedCategory.parent_category);
      if (parentCategory) {
        setItilCategory(parentCategory.category_name);
        setItilSubcategory(selectedCategory.category_name);
      }
    } else {
      // This is a parent category selection
      setItilCategory(selectedCategory.category_name);
      setItilSubcategory('');
    }
  };


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
            categoriesLength: data?.categories?.length,
            channelConfig: data?.channelConfig,
            priority_type: data?.channelConfig?.priority_type
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
              priority_type: 'custom',
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
            priority_type: 'custom',
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
    setShowPriorityMatrix(false);
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
    setShowPriorityMatrix(false);
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

    // Validate priority based on channel type
    if (channelConfig.priority_type === 'custom') {
      // Custom priority boards require priority_id
      if (!priorityId) {
        validationErrors.push('Priority');
      }
    } else if (channelConfig.priority_type === 'itil') {
      // ITIL priority boards require impact and urgency
      if (!itilImpact) validationErrors.push('Impact');
      if (!itilUrgency) validationErrors.push('Urgency');
    } else {
      // Default to custom behavior if priority_type is undefined
      if (!priorityId) {
        validationErrors.push('Priority');
      }
    }

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

      // Handle priority based on channel configuration
      if (channelConfig.priority_type === 'itil') {
        // For ITIL priority type, store the calculated priority level
        if (calculatedItilPriority) {
          formData.append('itil_priority_level', calculatedItilPriority.toString());
        }
        // Don't set priority_id for ITIL boards
      } else {
        // For custom priority type, use the selected priority
        formData.append('priority_id', priorityId);
      }

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

                  {/* Priority Section - Show different UI based on channel priority type */}
                  {channelId && (
                    <>
                      {/* Custom Priority - Editable dropdown (only show if explicitly custom, not by default) */}
                      {channelConfig.priority_type && channelConfig.priority_type === 'custom' && (
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
                      )}

                      {/* ITIL Priority - Show Impact and Urgency fields */}
                      {channelConfig.priority_type === 'itil' && (
                        <>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Impact *</label>
                            <CustomSelect
                              options={itilImpactOptions}
                              value={itilImpact?.toString() || null}
                              onValueChange={(value) => {
                                setItilImpact(value ? parseInt(value) : undefined);
                                clearErrorIfSubmitted();
                              }}
                              placeholder="Select Impact"
                              className={hasAttemptedSubmit && !itilImpact ? 'border-red-500' : ''}
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Urgency *</label>
                            <CustomSelect
                              options={itilUrgencyOptions}
                              value={itilUrgency?.toString() || null}
                              onValueChange={(value) => {
                                setItilUrgency(value ? parseInt(value) : undefined);
                                clearErrorIfSubmitted();
                              }}
                              placeholder="Select Urgency"
                              className={hasAttemptedSubmit && !itilUrgency ? 'border-red-500' : ''}
                            />
                          </div>

                          {/* Read-only Priority field showing calculated value */}
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <label className="block text-sm font-medium text-gray-700">Priority (Calculated)</label>
                              <button
                                type="button"
                                onClick={() => setShowPriorityMatrix(!showPriorityMatrix)}
                                className="text-gray-400 hover:text-gray-600 transition-colors"
                                title="Show ITIL Priority Matrix"
                              >
                                <HelpCircle className="w-4 h-4" />
                              </button>
                            </div>
                            <div className={`w-full px-3 py-2 border rounded-md bg-gray-50 ${
                              hasAttemptedSubmit && (!itilImpact || !itilUrgency) ? 'border-red-500' : 'border-gray-300'
                            }`}>
                              {calculatedItilPriority ? (
                                <div className="flex items-center gap-2">
                                  <div
                                    className="w-3 h-3 rounded-full border border-gray-300"
                                    style={{ backgroundColor:
                                      calculatedItilPriority === 1 ? '#DC2626' : // Red
                                      calculatedItilPriority === 2 ? '#EA580C' : // Orange
                                      calculatedItilPriority === 3 ? '#F59E0B' : // Amber
                                      calculatedItilPriority === 4 ? '#3B82F6' : // Blue
                                      '#6B7280' // Gray
                                    }}
                                  />
                                  <span className="text-gray-900">
                                    {ItilLabels.priority[calculatedItilPriority]}
                                  </span>
                                  <span className="text-sm text-gray-500">
                                    (Impact {itilImpact} × Urgency {itilUrgency})
                                  </span>
                                </div>
                              ) : (
                                <span className="text-gray-500">Select Impact and Urgency to calculate priority</span>
                              )}
                            </div>

                            {/* ITIL Priority Matrix - Show when help icon is clicked */}
                            {showPriorityMatrix && (
                              <div className="mt-3 p-4 bg-gray-50 border rounded-lg">
                                <h4 className="text-sm font-medium text-gray-800 mb-3">ITIL Priority Matrix (Impact × Urgency)</h4>
                                <div className="overflow-x-auto">
                                  <table className="min-w-full text-xs">
                                    <thead>
                                      <tr>
                                        <th className="px-2 py-1 text-left text-gray-600 border-b"></th>
                                        <th className="px-2 py-1 text-center text-gray-600 border-b">High<br/>Urgency (1)</th>
                                        <th className="px-2 py-1 text-center text-gray-600 border-b">Medium-High<br/>Urgency (2)</th>
                                        <th className="px-2 py-1 text-center text-gray-600 border-b">Medium<br/>Urgency (3)</th>
                                        <th className="px-2 py-1 text-center text-gray-600 border-b">Medium-Low<br/>Urgency (4)</th>
                                        <th className="px-2 py-1 text-center text-gray-600 border-b">Low<br/>Urgency (5)</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      <tr>
                                        <td className="px-2 py-1 text-gray-600 border-r font-medium">High Impact (1)</td>
                                        <td className="px-2 py-1 text-center bg-red-100 text-red-800 font-semibold">Critical (1)</td>
                                        <td className="px-2 py-1 text-center bg-orange-100 text-orange-800 font-semibold">High (2)</td>
                                        <td className="px-2 py-1 text-center bg-orange-100 text-orange-800 font-semibold">High (2)</td>
                                        <td className="px-2 py-1 text-center bg-yellow-100 text-yellow-800 font-semibold">Medium (3)</td>
                                        <td className="px-2 py-1 text-center bg-yellow-100 text-yellow-800 font-semibold">Medium (3)</td>
                                      </tr>
                                      <tr>
                                        <td className="px-2 py-1 text-gray-600 border-r font-medium">Medium-High Impact (2)</td>
                                        <td className="px-2 py-1 text-center bg-orange-100 text-orange-800 font-semibold">High (2)</td>
                                        <td className="px-2 py-1 text-center bg-orange-100 text-orange-800 font-semibold">High (2)</td>
                                        <td className="px-2 py-1 text-center bg-yellow-100 text-yellow-800 font-semibold">Medium (3)</td>
                                        <td className="px-2 py-1 text-center bg-yellow-100 text-yellow-800 font-semibold">Medium (3)</td>
                                        <td className="px-2 py-1 text-center bg-blue-100 text-blue-800 font-semibold">Low (4)</td>
                                      </tr>
                                      <tr>
                                        <td className="px-2 py-1 text-gray-600 border-r font-medium">Medium Impact (3)</td>
                                        <td className="px-2 py-1 text-center bg-orange-100 text-orange-800 font-semibold">High (2)</td>
                                        <td className="px-2 py-1 text-center bg-yellow-100 text-yellow-800 font-semibold">Medium (3)</td>
                                        <td className="px-2 py-1 text-center bg-yellow-100 text-yellow-800 font-semibold">Medium (3)</td>
                                        <td className="px-2 py-1 text-center bg-blue-100 text-blue-800 font-semibold">Low (4)</td>
                                        <td className="px-2 py-1 text-center bg-blue-100 text-blue-800 font-semibold">Low (4)</td>
                                      </tr>
                                      <tr>
                                        <td className="px-2 py-1 text-gray-600 border-r font-medium">Medium-Low Impact (4)</td>
                                        <td className="px-2 py-1 text-center bg-yellow-100 text-yellow-800 font-semibold">Medium (3)</td>
                                        <td className="px-2 py-1 text-center bg-yellow-100 text-yellow-800 font-semibold">Medium (3)</td>
                                        <td className="px-2 py-1 text-center bg-blue-100 text-blue-800 font-semibold">Low (4)</td>
                                        <td className="px-2 py-1 text-center bg-blue-100 text-blue-800 font-semibold">Low (4)</td>
                                        <td className="px-2 py-1 text-center bg-gray-100 text-gray-800 font-semibold">Planning (5)</td>
                                      </tr>
                                      <tr>
                                        <td className="px-2 py-1 text-gray-600 border-r font-medium">Low Impact (5)</td>
                                        <td className="px-2 py-1 text-center bg-yellow-100 text-yellow-800 font-semibold">Medium (3)</td>
                                        <td className="px-2 py-1 text-center bg-blue-100 text-blue-800 font-semibold">Low (4)</td>
                                        <td className="px-2 py-1 text-center bg-blue-100 text-blue-800 font-semibold">Low (4)</td>
                                        <td className="px-2 py-1 text-center bg-gray-100 text-gray-800 font-semibold">Planning (5)</td>
                                        <td className="px-2 py-1 text-center bg-gray-100 text-gray-800 font-semibold">Planning (5)</td>
                                      </tr>
                                    </tbody>
                                  </table>
                                </div>
                                <div className="mt-2 text-xs text-gray-600">
                                  <p><strong>Impact:</strong> How many users/business functions are affected?</p>
                                  <p><strong>Urgency:</strong> How quickly does this need to be resolved?</p>
                                </div>
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </>
                  )}

                  {/* ITIL Categories - Show when using ITIL categories */}
                  {channelId && channelConfig.category_type === 'itil' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">ITIL Category</label>
                      <CategoryPicker
                        id="quick-add-itil-category-picker"
                        categories={itilCategoriesForPicker}
                        selectedCategories={getSelectedItilCategoryId() ? [getSelectedItilCategoryId()] : []}
                        onSelect={(categoryIds) => {
                          handleItilCategoryChange(categoryIds);
                          clearErrorIfSubmitted();
                        }}
                        placeholder="Select ITIL category..."
                        multiSelect={false}
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
                      className={!title.trim() || !description.trim() || !assignedTo || !channelId || !statusId ||
                        (channelConfig.priority_type === 'custom' && !priorityId) ||
                        (channelConfig.priority_type === 'itil' && (!itilImpact || !itilUrgency)) ||
                        (channelConfig.priority_type === undefined && !priorityId) ||
                        !companyId ? 'opacity-50' : ''}
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
