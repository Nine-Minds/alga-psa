// server/src/components/interactions/QuickAddInteraction.tsx
'use client'

import React, { useState, useEffect, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Input } from '@alga-psa/ui/components/Input';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import RichTextEditorSkeleton from '@alga-psa/ui/components/skeletons/RichTextEditorSkeleton';

// Dynamic import for TextEditor
const TextEditor = dynamic<any>(() => import('@alga-psa/ui/editor').then((mod) => mod.TextEditor), {
  loading: () => <RichTextEditorSkeleton height="150px" title="Interaction Notes" />,
  ssr: false
});
import { DateTimePicker } from '@alga-psa/ui/components/DateTimePicker';
import { PartialBlock } from '@blocknote/core';
import InteractionIcon from '@alga-psa/ui/components/InteractionIcon';
import { addInteraction, updateInteraction, getInteractionById, getInteractionStatuses } from '@alga-psa/clients/actions';
import { getAllInteractionTypes } from '@alga-psa/clients/actions';
import { IInteraction, IInteractionType } from '@alga-psa/types';
import { useTenant } from '@alga-psa/ui/components/providers/TenantProvider';
import { useSession } from 'next-auth/react';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { ContactPicker } from '@alga-psa/ui/components/ContactPicker';
import { getAllUsersBasicAsync } from '../../lib/usersHelpers';
import { clampDuration } from '../../lib/durationHelpers';
import { getAllClients } from '@alga-psa/clients/actions';
import { getAllContacts } from '@alga-psa/clients/actions';
import { IUser } from '@shared/interfaces/user.interfaces';
import { IContact } from '@alga-psa/types';
import { IClient } from '@alga-psa/types';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { useAutomationIdAndRegister } from '@alga-psa/ui/ui-reflection/useAutomationIdAndRegister';
import { ButtonComponent, FormFieldComponent } from '@alga-psa/ui/ui-reflection/types';

interface QuickAddInteractionProps {
  id?: string; // Made optional to maintain backward compatibility
  entityId: string;
  entityType: 'contact' | 'client';
  clientId?: string;
  onInteractionAdded: (newInteraction: IInteraction) => void;
  isOpen: boolean;
  onClose: () => void;
  editingInteraction?: IInteraction; // Optional prop for editing mode
}

export function QuickAddInteraction({ 
  id = 'quick-add-interaction',
  entityId, 
  entityType, 
  clientId, 
  onInteractionAdded, 
  isOpen, 
  onClose,
  editingInteraction
}: QuickAddInteractionProps) {
  const [title, setTitle] = useState('');
  const [notesContent, setNotesContent] = useState<PartialBlock[]>([]);
  const [isNotesContentReady, setIsNotesContentReady] = useState<boolean>(false);
  const [typeId, setTypeId] = useState('');
  const [durationHours, setDurationHours] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('');
  const [startTime, setStartTime] = useState<Date | undefined>(undefined);
  const [endTime, setEndTime] = useState<Date | undefined>(undefined);
  const [statusId, setStatusId] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [selectedContactId, setSelectedContactId] = useState<string>('');
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [interactionTypes, setInteractionTypes] = useState<IInteractionType[]>([]);
  const [statuses, setStatuses] = useState<any[]>([]);
  const [users, setUsers] = useState<IUser[]>([]);
  const [clients, setClients] = useState<IClient[]>([]);
  const [clientFilterState, setClientFilterState] = useState<'all' | 'active' | 'inactive'>('all');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [contacts, setContacts] = useState<IContact[]>([]);
  const tenant = useTenant()!;
  const { data: session } = useSession();
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [endTimeError, setEndTimeError] = useState('');

  const isEditMode = !!editingInteraction;

  // UI Reflection System Integration
  const { automationIdProps: typeSelectProps } = useAutomationIdAndRegister<FormFieldComponent>({
    id: `${id}-type-select`,
    type: 'formField',
    fieldType: 'select',
    label: 'Interaction Type',
    helperText: 'Select the type of interaction (phone call, email, meeting, etc.)'
  });

  const { automationIdProps: titleInputProps } = useAutomationIdAndRegister<FormFieldComponent>({
    id: `${id}-title-input`,
    type: 'formField',
    fieldType: 'textField',
    label: 'Interaction Title',
    helperText: 'Enter a descriptive title for this interaction'
  });

  const { automationIdProps: notesEditorProps } = useAutomationIdAndRegister<FormFieldComponent>({
    id: `${id}-notes-editor`,
    type: 'formField',
    fieldType: 'textField',
    label: 'Interaction Notes',
    helperText: 'Add detailed notes about this interaction'
  });

  const { automationIdProps: statusSelectProps } = useAutomationIdAndRegister<FormFieldComponent>({
    id: `${id}-status-select`,
    type: 'formField',
    fieldType: 'select',
    label: 'Interaction Status',
    helperText: 'Set the current status of this interaction'
  });

  const { automationIdProps: userPickerProps } = useAutomationIdAndRegister<FormFieldComponent>({
    id: `${id}-user-picker`,
    type: 'formField',
    fieldType: 'select',
    label: 'Assigned User',
    helperText: 'Select the user responsible for this interaction'
  });

  const { automationIdProps: clientPickerProps } = useAutomationIdAndRegister<FormFieldComponent>({
    id: `${id}-client-picker`,
    type: 'formField',
    fieldType: 'select',
    label: 'Associated Client',
    helperText: 'Select the client this interaction is related to'
  });

  const { automationIdProps: contactPickerProps } = useAutomationIdAndRegister<FormFieldComponent>({
    id: `${id}-contact-picker`,
    type: 'formField',
    fieldType: 'select',
    label: 'Associated Contact',
    helperText: 'Select the contact this interaction is with'
  });

  const { automationIdProps: startTimeProps } = useAutomationIdAndRegister<FormFieldComponent>({
    id: `${id}-start-time`,
    type: 'formField',
    fieldType: 'textField',
    label: 'Start Time',
    helperText: 'When did this interaction start?'
  });

  const { automationIdProps: endTimeProps } = useAutomationIdAndRegister<FormFieldComponent>({
    id: `${id}-end-time`,
    type: 'formField',
    fieldType: 'textField',
    label: 'End Time',
    helperText: 'When did this interaction end?'
  });

  const { automationIdProps: durationHoursProps } = useAutomationIdAndRegister<FormFieldComponent>({
    id: `${id}-duration-hours`,
    type: 'formField',
    fieldType: 'textField',
    label: 'Duration Hours',
    helperText: 'Duration hours of the interaction'
  });

  const { automationIdProps: durationMinutesProps } = useAutomationIdAndRegister<FormFieldComponent>({
    id: `${id}-duration-minutes`,
    type: 'formField',
    fieldType: 'textField',
    label: 'Duration Minutes',
    helperText: 'Duration minutes of the interaction'
  });

  const { automationIdProps: cancelButtonProps } = useAutomationIdAndRegister<ButtonComponent>({
    id: `${id}-cancel-button`,
    type: 'button',
    label: 'Cancel',
    helperText: 'Cancel creating/editing this interaction'
  });

  const { automationIdProps: saveButtonProps } = useAutomationIdAndRegister<ButtonComponent>({
    id: `${id}-save-button`,
    type: 'button',
    label: isEditMode ? 'Update Interaction' : 'Save Interaction',
    helperText: isEditMode ? 'Save changes to this interaction' : 'Create this new interaction'
  });

  const { automationIdProps: closeButtonProps } = useAutomationIdAndRegister<ButtonComponent>({
    id: `${id}-close-button`,
    type: 'button',
    label: 'Close Dialog',
    helperText: 'Close the interaction dialog'
  });

  useEffect(() => {
    console.log('QuickAddInteraction props:', { isEditMode, editingInteraction, isOpen });
    if (editingInteraction) {
      console.log('Editing interaction ID:', editingInteraction.interaction_id);
    }
    
    // Reset notes content ready state when dialog opens
    setIsNotesContentReady(false);
    
    const fetchData = async () => {
      try {
        // Fetch interaction types (already sorted by display_order from the server)
        const types = await getAllInteractionTypes();
        setInteractionTypes(types);

        // Fetch interaction statuses
        const statusList = await getInteractionStatuses();
        setStatuses(statusList);
        
        // Fetch users, clients, and contacts for edit mode
        if (isEditMode) {
          const usersList = await getAllUsersBasicAsync();
          setUsers(usersList);
          
          const clientsList = await getAllClients();
          setClients(clientsList);
          
          // Get all contacts - the ContactPicker will filter by client internally
          const allContacts = await getAllContacts();
          setContacts(allContacts);
        }
        
        // Set default status if available (only for new interactions)
        if (!isEditMode) {
          const defaultStatus = statusList.find(s => s.is_default);
          if (defaultStatus) {
            setStatusId(defaultStatus.status_id);
          }
        }
      } catch (error) {
        console.error('Error fetching data:', error);
      }
    };

    fetchData();
    
    // Populate fields if editing
    if (isEditMode && editingInteraction) {
      setTitle(editingInteraction.title || '');
      setTypeId(editingInteraction.type_id || '');
      setStatusId(editingInteraction.status_id || '');
      // Convert duration from total minutes to hours and minutes
      if (editingInteraction.duration) {
        const totalMinutes = editingInteraction.duration;
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        setDurationHours(hours > 0 ? hours.toString() : '');
        setDurationMinutes(minutes > 0 ? minutes.toString() : '');
      } else {
        setDurationHours('');
        setDurationMinutes('');
      }
      setStartTime(editingInteraction.start_time ? new Date(editingInteraction.start_time) : undefined);
      setEndTime(editingInteraction.end_time ? new Date(editingInteraction.end_time) : undefined);
      setSelectedUserId(editingInteraction.user_id || '');
      setSelectedContactId(editingInteraction.contact_name_id || '');
      setSelectedClientId(editingInteraction.client_id || '');
      
      // Contacts are now fetched in the main fetchData function above
      
      // Parse notes content with better error handling
      try {
        if (editingInteraction.notes && editingInteraction.notes.trim() !== '') {
          const parsedNotes = JSON.parse(editingInteraction.notes);
          if (Array.isArray(parsedNotes) && parsedNotes.length > 0) {
            // Validate that the parsed content has proper structure
            const validNotes = parsedNotes.every(block => 
              block && typeof block === 'object' && block.type
            );
            if (validNotes) {
              setNotesContent(parsedNotes);
            } else {
              console.warn('Invalid notes structure, using default');
              setNotesContent([]);
            }
          } else {
            setNotesContent([]);
          }
        } else {
          setNotesContent([]);
        }
      } catch (e) {
        console.error('Error parsing notes content:', e);
        // Create a default paragraph with the text content if JSON parsing fails
        if (editingInteraction.notes && editingInteraction.notes.trim() !== '') {
          setNotesContent([{
            type: "paragraph",
            props: {
              textAlignment: "left",
              backgroundColor: "default",
              textColor: "default"
            },
            content: [{
              type: "text",
              text: editingInteraction.notes,
              styles: {}
            }]
          }]);
        } else {
          setNotesContent([]);
        }
      }
      
      // Mark notes content as ready after processing
      setIsNotesContentReady(true);
    } else if (isOpen && !startTime && !isEditMode) {
      // Set start time to current time when dialog opens for new interactions
      setStartTime(new Date());
      setSelectedUserId(session?.user?.id || '');
      setIsNotesContentReady(true); // Mark as ready for new interactions
    }
  }, [isOpen, isEditMode, editingInteraction]);

  // Note: ContactPicker handles client filtering internally, 
  // so we don't need to refetch contacts when client changes

  // Helper to get total duration in minutes from hours and minutes state (max 24h 59m = 1499 minutes)
  const getTotalDurationMinutes = (): number => {
    return clampDuration(durationHours, durationMinutes).totalMinutes;
  };

  // Handle start time change
  const handleStartTimeChange = (date: Date) => {
    setStartTime(date);

    // If we have a duration, update end time accordingly
    const totalMinutes = getTotalDurationMinutes();
    if (totalMinutes > 0) {
      const newEndTime = new Date(date.getTime() + totalMinutes * 60000);
      setEndTime(newEndTime);
      setEndTimeError('');
      return;
    }

    if (endTime) {
      const diffMilliseconds = endTime.getTime() - date.getTime();
      if (diffMilliseconds < 0) {
        // Auto-correct: set end time to match start time
        setEndTime(date);
        setEndTimeError(''); // Clear error since we auto-corrected
        setDurationHours('');
        setDurationMinutes('');
      } else {
        const totalMinutesFromEnd = Math.round(diffMilliseconds / 60000);
        const hours = Math.floor(totalMinutesFromEnd / 60);
        const minutes = totalMinutesFromEnd % 60;
        setDurationHours(hours > 0 ? hours.toString() : '');
        setDurationMinutes(minutes > 0 ? minutes.toString() : '');
        setEndTimeError('');
      }
    }
  };

  // Handle end time change
  const handleEndTimeChange = (date: Date) => {
    // Validate: end time must be after or equal to start time
    if (startTime && date.getTime() < startTime.getTime()) {
      // Don't allow setting end time before start time
      setEndTimeError('End time must be on or after the start time.');
      return;
    }

    setEndTime(date);
    setEndTimeError('');

    // If we have a start time, calculate and update duration (hours and minutes)
    if (startTime) {
      const diffMilliseconds = date.getTime() - startTime.getTime();
      const totalMinutes = Math.round(diffMilliseconds / 60000);

      // Only update duration if the difference is positive
      if (totalMinutes >= 0) {
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        setDurationHours(hours > 0 ? hours.toString() : '');
        setDurationMinutes(minutes > 0 ? minutes.toString() : '');
      }
    }
  };

  // Handle duration hours change (max 24 hours to prevent unreasonable durations)
  const handleDurationHoursChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newHours = e.target.value;
    const parsedHours = parseInt(newHours);
    let nextHours = newHours;
    if (!isNaN(parsedHours)) {
      nextHours = Math.min(Math.max(parsedHours, 0), 24).toString();
    }
    setDurationHours(nextHours);
    setEndTimeError(''); // Clear any previous error

    // If we have a start time, update end time
    if (startTime) {
      const { totalMinutes } = clampDuration(nextHours, durationMinutes);
      const newEndTime = new Date(startTime.getTime() + totalMinutes * 60000);
      setEndTime(newEndTime);
    }
  };

  // Handle duration minutes change (0-59 range)
  const handleDurationMinutesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newMinutes = e.target.value;
    const parsedMinutes = parseInt(newMinutes);
    const clampedMinutes = !isNaN(parsedMinutes)
      ? Math.min(Math.max(parsedMinutes, 0), 59).toString()
      : newMinutes;
    setDurationMinutes(clampedMinutes);
    setEndTimeError(''); // Clear any previous error

    // If we have a start time, update end time
    if (startTime) {
      const { totalMinutes } = clampDuration(durationHours, clampedMinutes);
      const newEndTime = new Date(startTime.getTime() + totalMinutes * 60000);
      setEndTime(newEndTime);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);
    
    const errors: string[] = [];
    
    if (!session?.user?.id) {
      console.error('User not authenticated');
      return;
    }

    if (!typeId) {
      errors.push('Please select an interaction type');
    }
    if (!title.trim()) {
      errors.push('Title is required');
    }
    if (startTime && endTime && endTime.getTime() < startTime.getTime()) {
      errors.push('End time must be on or after the start time');
      setEndTimeError('End time must be on or after the start time.');
    }
    
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }
    
    setValidationErrors([]);
  
    try {
      const interactionData: Partial<IInteraction> = {
        title,
        notes: JSON.stringify(notesContent),
        type_id: typeId,
        duration: getTotalDurationMinutes() > 0 ? getTotalDurationMinutes() : null,
        start_time: startTime,
        end_time: endTime,
        status_id: statusId,
        user_id: isEditMode ? selectedUserId : session.user.id,
        tenant: tenant
      };
  
      if (isEditMode) {
        // In edit mode, use the selected values from pickers
        interactionData.contact_name_id = selectedContactId === '' ? null : selectedContactId;
        interactionData.client_id = selectedClientId === '' ? null : selectedClientId;
      } else {
        // In add mode, use the original logic
        if (entityType === 'contact') {
          interactionData.contact_name_id = entityId;
          interactionData.client_id = clientId;
        } else {
          interactionData.client_id = entityId;
        }
      }
  
      console.log('Interaction data being sent:', interactionData);
  
      let resultInteraction: IInteraction;
      
      if (isEditMode && editingInteraction && editingInteraction.interaction_id) {
        // Update existing interaction
        console.log('Updating interaction with ID:', editingInteraction.interaction_id);
        console.log('Update data:', interactionData);
        resultInteraction = await updateInteraction(editingInteraction.interaction_id!, interactionData);
        console.log('Updated interaction received:', resultInteraction);
      } else {
        // Create new interaction
        console.log('Creating new interaction');
        console.log('Create data:', interactionData);
        const newInteraction = await addInteraction(interactionData as Omit<IInteraction, 'interaction_date'>);
        console.log('New interaction received:', newInteraction);
        resultInteraction = newInteraction;
      }
      
      // Fetch the complete interaction data
      const fullInteraction = await getInteractionById(resultInteraction.interaction_id!);
      
      onInteractionAdded(fullInteraction);
      onClose();
      
      // Clear form fields only if not editing
      if (!isEditMode) {
        setTitle('');
        setNotesContent([]);
        setTypeId('');
        setStatusId('');
        setDurationHours('');
        setDurationMinutes('');
        setStartTime(undefined);
        setEndTime(undefined);
        setSelectedUserId('');
        setSelectedContactId('');
        setSelectedClientId('');
        setIsNotesContentReady(false);
        setHasAttemptedSubmit(false);
        setValidationErrors([]);
        setEndTimeError('');
      }
    } catch (error) {
      console.error(`Error ${isEditMode ? 'updating' : 'adding'} interaction:`, error);
      // Handle error (e.g., show error message to user)  
    }
  };

  const getTypeLabel = (type: IInteractionType) => {
    return (
      <div className="flex items-center gap-2">
        <InteractionIcon icon={type.icon} typeName={type.type_name} />
        <span>{type.type_name}</span>
      </div>
    );
  };

  return (
    <ReflectionContainer id={id} label="Quick Add Interaction">
      <Dialog
        isOpen={isOpen}
        onClose={() => {
          setHasAttemptedSubmit(false);
          setValidationErrors([]);
          setEndTimeError('');
          onClose();
        }}
        title={isEditMode ? 'Edit Interaction' : 'Add New Interaction'}
        className="max-w-2xl"
        hideCloseButton={false}
        contentClassName="max-h-[calc(90vh-6rem)]"
      >
        <DialogContent>
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              {hasAttemptedSubmit && validationErrors.length > 0 && (
                <Alert variant="destructive">
                  <AlertDescription>
                    Please fix the following errors:
                    <ul className="list-disc pl-5 mt-1 text-sm">
                      {validationErrors.map((err, index) => (
                        <li key={index}>{err}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
              <CustomSelect
                  {...typeSelectProps}
                  options={interactionTypes.map((type) => ({ 
                    value: type.type_id, 
                    label: getTypeLabel(type)
                  }))}
                  value={typeId}
                  onValueChange={setTypeId}
                  placeholder="Select Interaction Type"
                  className={`w-fit ${hasAttemptedSubmit && !typeId ? 'ring-1 ring-red-500' : ''}`}
                  required
                />
                <Input
                  {...titleInputProps}
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Title"
                  required
                  className={hasAttemptedSubmit && !title.trim() ? 'border-red-500' : ''}
                />
              
                {/* Notes right under title */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Notes</label>
                  <div>
                    {/* Only render TextEditor when content is ready */}
                    {isNotesContentReady ? (
                      <Suspense fallback={<RichTextEditorSkeleton height="150px" title="Interaction Notes" />}>
                        <TextEditor
                          key={isEditMode ? `edit-${editingInteraction?.interaction_id}` : 'add'}
                          {...notesEditorProps}
                          initialContent={notesContent}
                          onContentChange={setNotesContent}
                        />
                      </Suspense>
                    ) : (
                      <div className="w-full h-[100px] bg-gray-100 border border-gray-200 rounded-lg flex items-center justify-center">
                        <span className="text-gray-500">Loading editor...</span>
                      </div>
                    )}
                  </div>
                </div>

              {/* Edit mode fields in 2-column layout */}
              {isEditMode && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-4">
                    {/* Status - fit content */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Status</label>
                      <CustomSelect
                        options={statuses.map((status) => ({ 
                          value: status.status_id, 
                          label: status.name 
                        }))}
                        value={statusId}
                        onValueChange={setStatusId}
                        placeholder="Select Status"
                        className="w-fit"
                      />
                    </div>
                    
                    {/* User under status */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">User</label>
                      <UserPicker
                        users={users}
                        value={selectedUserId}
                        onValueChange={setSelectedUserId}
                        placeholder="Select User"
                        buttonWidth="fit"
                      />
                    </div>
                  </div>
                  
                  <div className="space-y-4">
                    {/* Client in right column */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Client</label>
                      <ClientPicker
                        id={`${id}-client-picker`}
                        clients={clients}
                        onSelect={(clientId) => setSelectedClientId(clientId || '')}
                        selectedClientId={selectedClientId}
                        filterState={clientFilterState}
                        onFilterStateChange={setClientFilterState}
                        clientTypeFilter={clientTypeFilter}
                        onClientTypeFilterChange={setClientTypeFilter}
                        fitContent={true}
                      />
                    </div>
                    
                    {/* Contact in right column */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Contact</label>
                      <ContactPicker
                        id={`${id}-contact-picker`}
                        contacts={contacts}
                        value={selectedContactId || ''}
                        onValueChange={(value) => setSelectedContactId(value || '')}
                        clientId={selectedClientId}
                        placeholder={!selectedClientId ? "Select client first" : "Select Contact"}
                        disabled={!selectedClientId}
                        buttonWidth="fit"
                      />
                    </div>
                  </div>
                </div>
              )}
              
              {/* Status for non-edit mode - shown for create mode */}
              {!isEditMode && (
                <CustomSelect
                  options={statuses.map((status) => ({ 
                    value: status.status_id, 
                    label: status.name 
                  }))}
                  value={statusId}
                  onValueChange={setStatusId}
                  placeholder="Select Status"
                  className="w-fit"
                />
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Start Time</label>
                  <DateTimePicker
                    id={`${id}-start-time`}
                    value={startTime}
                    onChange={(date) => {
                      if (date) {
                        handleStartTimeChange(date);
                      } else {
                        setStartTime(undefined);
                        setDurationHours('');
                        setDurationMinutes('');
                      }
                    }}
                    placeholder="Select start time"
                    label="Start Time"
                    clearable
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">End Time</label>
                  <DateTimePicker
                    id={`${id}-end-time`}
                    value={endTime}
                    onChange={(date) => {
                      if (date) {
                        handleEndTimeChange(date);
                      } else {
                        setEndTime(undefined);
                        setEndTimeError('');
                        setDurationHours('');
                        setDurationMinutes('');
                      }
                    }}
                    placeholder="Select end time"
                    label="End Time"
                    minDate={startTime}
                    clearable
                  />
                  {endTimeError && (
                    <p className="text-xs text-red-600">{endTimeError}</p>
                  )}
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Duration</label>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Input
                      {...durationHoursProps}
                      type="number"
                      value={durationHours}
                      onChange={handleDurationHoursChange}
                      placeholder="0"
                      min="0"
                      max="24"
                      className="w-20"
                    />
                    <span className="text-sm text-muted-foreground">hours</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      {...durationMinutesProps}
                      type="number"
                      value={durationMinutes}
                      onChange={handleDurationMinutesChange}
                      placeholder="0"
                      min="0"
                      max="59"
                      className="w-20"
                    />
                    <span className="text-sm text-muted-foreground">minutes</span>
                  </div>
                </div>
              </div>
              <div className="flex gap-2 pt-4 border-t border-gray-100">
                <Button 
                  id="cancel-interaction-button"
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setHasAttemptedSubmit(false);
                    setValidationErrors([]);
                    setEndTimeError('');
                    onClose();
                  }}
                >
                  Cancel
                </Button>
                <Button 
                  id="save-interaction-button"
                  type="submit" 
                  className={`flex-1 ${!typeId || !title.trim() ? 'opacity-50' : ''}`}
                  disabled={!typeId || !title.trim() || !!endTimeError}
                >
                  {isEditMode ? 'Update Interaction' : 'Save Interaction'}
                </Button>
              </div>
            </form>
        </DialogContent>
      </Dialog>
    </ReflectionContainer>
  );
}
