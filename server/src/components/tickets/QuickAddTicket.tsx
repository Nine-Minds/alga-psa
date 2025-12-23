'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { HelpCircle } from 'lucide-react';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { addTicket } from 'server/src/lib/actions/ticket-actions/ticketActions';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { getContactsByClient } from 'server/src/lib/actions/contact-actions/contactActions';
import { getClientLocations } from 'server/src/lib/actions/client-actions/clientLocationActions';
import { getTicketFormData } from 'server/src/lib/actions/ticket-actions/ticketFormActions';
import { getTicketCategoriesByBoard, BoardCategoryData } from 'server/src/lib/actions/ticketCategoryActions';
import { IUser, IBoard, ITicketStatus, IPriority, IStandardPriority, IClient, IClientLocation, IContact, ITicket, ITicketCategory } from 'server/src/interfaces';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { BoardPicker } from 'server/src/components/settings/general/BoardPicker';
import { ClientPicker } from 'server/src/components/clients/ClientPicker';
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
import { calculateItilPriority, ItilLabels } from '../../lib/utils/itilUtils';

// Helper function to format location display
const formatLocationDisplay = (location: IClientLocation): string => {
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
  prefilledClient?: {
    id: string;
    name: string;
  };
  prefilledContact?: {
    id: string;
    name: string;
  };
  prefilledDescription?: string;
  isEmbedded?: boolean;
  assetId?: string;
}

export function QuickAddTicket({
  id = 'ticket-quick-add',
  open,
  onOpenChange,
  onTicketAdded,
  prefilledClient,
  prefilledContact,
  prefilledDescription,
  isEmbedded = false,
  assetId
}: QuickAddTicketProps) {
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState(prefilledDescription || '');
  const [assignedTo, setAssignedTo] = useState('');
  const [boardId, setBoardId] = useState('');
  const [statusId, setStatusId] = useState('');
  const [priorityId, setPriorityId] = useState('');
  const [clientId, setClientId] = useState(prefilledClient?.id || '');
  const [contactId, setContactId] = useState(prefilledContact?.id || null);
  const [clientFilterState, setClientFilterState] = useState<'all' | 'active' | 'inactive'>('all');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [selectedClientType, setSelectedClientType] = useState<'company' | 'individual' | null>(null);
  const [categories, setCategories] = useState<ITicketCategory[]>([]);
  const [boardConfig, setBoardConfig] = useState<BoardCategoryData['boardConfig']>({
    category_type: 'custom',
    priority_type: 'custom',
    display_itil_impact: false,
    display_itil_urgency: false,
  });
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [users, setUsers] = useState<IUser[]>([]);
  const [boards, setBoards] = useState<IBoard[]>([]);
  const [statuses, setStatuses] = useState<ITicketStatus[]>([]);
  const [priorities, setPriorities] = useState<IPriority[]>([]);
  const [clients, setClients] = useState<IClient[]>([]);
  const [contacts, setContacts] = useState<IContact[]>([]);
  const [locations, setLocations] = useState<IClientLocation[]>([]);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [isPrefilledClient, setIsPrefilledClient] = useState(false);
  const [quickAddBoardFilterState, setQuickAddBoardFilterState] = useState<'active' | 'inactive' | 'all'>('active');

  // ITIL-specific state
  const [itilImpact, setItilImpact] = useState<number | undefined>(undefined);
  const [itilUrgency, setItilUrgency] = useState<number | undefined>(undefined);
  const [showPriorityMatrix, setShowPriorityMatrix] = useState(false);

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

  // NOTE: Categories are now unified - no need for separate ITIL category filtering

  // NOTE: ITIL category selection is now handled by the unified CategoryPicker
  // Categories are managed through the selectedCategories state and regular category handling


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
        const formData = await getTicketFormData(prefilledClient?.id);

        setUsers(formData.users);
        setBoards(formData.boards);
        setPriorities(formData.priorities);
        setClients(formData.clients);

        if (Array.isArray(formData.statuses) && formData.statuses.length > 0) {
          setStatuses(formData.statuses);
        }

        if (formData.selectedClient) {
          setIsPrefilledClient(true);
          setClientId(formData.selectedClient.client_id);
          setSelectedClientType(formData.selectedClient.client_type as 'company' | 'individual');
          if (formData.contacts) {
            setContacts(formData.contacts);
          }
        } else {
          // No prefilled client, ensure isPrefilledClient is false
          setIsPrefilledClient(false);
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
  }, [open, prefilledClient?.id]);

  useEffect(() => {
    const fetchClientData = async () => {
      if (!clientId) {
        // Clear both contacts and locations when no client is selected
        setContacts([]);
        setLocations([]);
        return;
      }

      console.log('Fetching client data for:', { clientId, isPrefilledClient });

      try {
        // Fetch both locations and contacts (when needed) in parallel
        const promises: Promise<any>[] = [
          getClientLocations(clientId)
        ];
        
        // Only fetch contacts if not prefilled (contacts are already loaded for prefilled clients)
        if (!isPrefilledClient) {
          promises.push(getContactsByClient(clientId, 'all'));
        }
        
        const results = await Promise.all(promises);
        const locationsData = results[0];
        console.log('Fetched locations:', locationsData);
        setLocations(locationsData || []);
        
        if (!isPrefilledClient) {
          const contactsData = results[1];
          console.log('Fetched contacts:', contactsData);
          setContacts(contactsData || []);
        }
      } catch (error) {
        console.error('Error fetching client data:', error);
        setLocations([]);
        // Only clear contacts if we were trying to fetch them
        if (!isPrefilledClient) {
          setContacts([]);
        }
      }
    };

    fetchClientData();
  }, [clientId, isPrefilledClient]);

  useEffect(() => {
    const fetchCategories = async () => {
      if (boardId) {
        try {
          const data = await getTicketCategoriesByBoard(boardId);
          // Ensure data is properly resolved and categories is an array
          if (data && data.categories && Array.isArray(data.categories)) {
            setCategories(data.categories);
            setBoardConfig(data.boardConfig);
          } else {
            console.error('Invalid categories data received:', data);
            setCategories([]);
            setBoardConfig({
              category_type: 'custom',
              priority_type: 'custom',
              display_itil_impact: false,
              display_itil_urgency: false,
            });
          }
        } catch (error) {
          console.error('Error fetching categories:', error);
          setCategories([]);
          setBoardConfig({
            category_type: 'custom',
            priority_type: 'custom',
            display_itil_impact: false,
            display_itil_urgency: false,
          });
        }
      } else {
        setCategories([]);
        setSelectedCategories([]);
      }
    };

    if (boardId) {
      fetchCategories();
    }
  }, [boardId]);

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

  const handleClientChange = async (newClientId: string | null) => {
    if (isPrefilledClient) return;

    setClientId(newClientId || '');
    setContactId(null);
    clearErrorIfSubmitted();

    if (newClientId !== null) {
      const selectedClient = clients.find(client => client.client_id === newClientId);

      if (selectedClient?.client_type === 'company') {
        setSelectedClientType('company');
      } else if (selectedClient?.client_type === 'individual') {
        setSelectedClientType('individual');
      } else {
        setSelectedClientType(null);
      }
    } else {
      setSelectedClientType(null);
    }
  };

  const handleBoardChange = (newBoardId: string) => {
    setBoardId(newBoardId);
    setSelectedCategories([]);
    setShowPriorityMatrix(false);
    clearErrorIfSubmitted();
  };


  const resetForm = () => {
    setTitle('');
    setDescription(prefilledDescription || '');
    setAssignedTo('');
    setBoardId('');
    setStatusId('');
    setPriorityId('');
    setClientId(prefilledClient?.id || '');
    setContactId(prefilledContact?.id || null);
    setLocationId(null);
    setLocations([]);
    setContacts([]);
    // Reset isPrefilledClient - it will be set to true again if there's a prefilled client
    setIsPrefilledClient(false);
    if (prefilledClient?.id) {
      const client = clients.find(c => c.client_id === prefilledClient.id);
      setSelectedClientType(client?.client_type as 'company' | 'individual' || null);
    } else {
      setSelectedClientType(null);
    }
    setSelectedCategories([]);
    // Reset ITIL fields
    setItilImpact(undefined);
    setItilUrgency(undefined);
    setShowPriorityMatrix(false);
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
    if (!boardId) validationErrors.push('Board');
    if (!statusId) validationErrors.push('Status');

    // Validate priority based on board type
    if (boardConfig.priority_type === 'custom') {
      // Custom priority boards require priority_id
      if (!priorityId) {
        validationErrors.push('Priority');
      }
    } else if (boardConfig.priority_type === 'itil') {
      // ITIL priority boards require impact and urgency
      if (!itilImpact) validationErrors.push('Impact');
      if (!itilUrgency) validationErrors.push('Urgency');
    } else {
      // Default to custom behavior if priority_type is undefined
      if (!priorityId) {
        validationErrors.push('Priority');
      }
    }

    if (!clientId) validationErrors.push('Client');
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
      formData.append('board_id', boardId);
      formData.append('status_id', statusId);

      // Always append priority_id - for ITIL boards, the backend will map
      // the calculated priority to the correct ITIL standard priority record
      formData.append('priority_id', priorityId);

      formData.append('client_id', clientId);

      if (selectedClientType === 'company' && contactId) {
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

      if (assetId) {
        formData.append('asset_id', assetId);
      }

      // Add ITIL Impact and Urgency for calculation (if provided)
      if (itilImpact) {
        formData.append('itil_impact', itilImpact.toString());
      }
      if (itilUrgency) {
        formData.append('itil_urgency', itilUrgency.toString());
      }

      // ITIL categories now use the unified category system
      // The selected ITIL category ID is already in selectedCategories/categoryId

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

  const filteredClients = clients.filter(client => {
    if (clientFilterState === 'all') return true;
    if (clientFilterState === 'active') return !client.is_inactive;
    if (clientFilterState === 'inactive') return client.is_inactive;
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
        className="w-full max-w-2xl max-h-[90vh]"
        title="Add Ticket"
        disableFocusTrap
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

                  <div className={hasAttemptedSubmit && !clientId ? 'ring-1 ring-red-500 rounded-lg' : ''}>
                    <ClientPicker
                      id={`${id}-client`}
                      clients={filteredClients}
                      onSelect={handleClientChange}
                      selectedClientId={clientId}
                      filterState={clientFilterState}
                      onFilterStateChange={setClientFilterState}
                      clientTypeFilter={clientTypeFilter}
                      onClientTypeFilterChange={setClientTypeFilter}
                      placeholder="Select Client *"
                    />
                  </div>

                  {clientId && selectedClientType === 'company' && (
                    <ContactPicker
                      id={`${id}-contact`}
                      contacts={contacts}
                      value={contactId || ''}
                      onValueChange={(value) => {
                        setContactId(value || null);
                        clearErrorIfSubmitted();
                      }}
                      clientId={clientId}
                      placeholder={
                        contacts.length === 0
                          ? "No contacts for selected client"
                          : "Select contact"
                      }
                      disabled={contacts.length === 0}
                      buttonWidth="full"
                    />
                  )}
                  {clientId && (
                    <CustomSelect
                      id={`${id}-location`}
                      value={locationId || ''}
                      onValueChange={(value) => {
                        setLocationId(value === 'none' ? null : value || null);
                        clearErrorIfSubmitted();
                      }}
                      options={[
                        ...(locations.length > 0 ? [{ value: 'none', label: 'None' }] : []),
                        ...locations.map(location => ({
                          value: location.location_id,
                          label: formatLocationDisplay(location) + (location.is_default ? ' (Default)' : '')
                        }))
                      ]}
                      placeholder={locations.length === 0 ? "No locations for selected client" : "Select location"}
                      showPlaceholderInDropdown={false}
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

                  <div className={hasAttemptedSubmit && !boardId ? 'ring-1 ring-red-500 rounded-lg' : ''}>
                    <BoardPicker
                      id={`${id}-board-picker`}
                      boards={boards}
                      onSelect={handleBoardChange}
                      selectedBoardId={boardId}
                      onFilterStateChange={setQuickAddBoardFilterState}
                      filterState={quickAddBoardFilterState}
                      placeholder="Select Board *"
                    />
                  </div>

                  {boardId && boardConfig.category_type && (
                    <CategoryPicker
                      id={`${id}-category-picker`}
                      categories={categories}
                      selectedCategories={selectedCategories}
                      onSelect={(categoryIds) => {
                        setSelectedCategories(categoryIds);
                        clearErrorIfSubmitted();
                      }}
                      placeholder={boardConfig.category_type === 'custom' ? "Select category" : "Select ITIL category"}
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

                  {/* Priority Section - Show different UI based on board priority type */}
                  {boardId && (
                    <>
                      {/* Custom Priority - Editable dropdown (only show if explicitly custom, not by default) */}
                      {boardConfig.priority_type && boardConfig.priority_type === 'custom' && (
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
                      {boardConfig.priority_type === 'itil' && (
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

                  {/* ITIL Categories are now handled by the unified CategoryPicker above */}



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
                      className={!title.trim() || !description.trim() || !assignedTo || !boardId || !statusId ||
                        (boardConfig.priority_type === 'custom' && !priorityId) ||
                        (boardConfig.priority_type === 'itil' && (!itilImpact || !itilUrgency)) ||
                        (boardConfig.priority_type === undefined && !priorityId) ||
                        !clientId ? 'opacity-50' : ''}
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
