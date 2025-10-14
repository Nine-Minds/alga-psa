// server/src/components/interactions/QuickAddInteraction.tsx
'use client'

import React, { useState, useEffect, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { Dialog, DialogContent } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Input } from 'server/src/components/ui/Input';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import RichTextEditorSkeleton from 'server/src/components/ui/skeletons/RichTextEditorSkeleton';

// Dynamic import for TextEditor
const TextEditor = dynamic(() => import('../editor/TextEditor'), {
  loading: () => <RichTextEditorSkeleton height="150px" title="Interaction Notes" />,
  ssr: false
});
import { DateTimePicker } from 'server/src/components/ui/DateTimePicker';
import { PartialBlock } from '@blocknote/core';
import InteractionIcon from 'server/src/components/ui/InteractionIcon';
import { addInteraction, updateInteraction, getInteractionById, getInteractionStatuses } from 'server/src/lib/actions/interactionActions';
import { getAllInteractionTypes } from 'server/src/lib/actions/interactionTypeActions';
import { IInteraction, IInteractionType } from 'server/src/interfaces/interaction.interfaces';
import { useTenant } from 'server/src/components/TenantProvider';
import { useSession } from 'next-auth/react';
import UserPicker from '../ui/UserPicker';
// ClientPicker replaced with CustomSelect
import { ContactPicker } from '../ui/ContactPicker';
import { getAllUsers } from 'server/src/lib/actions/user-actions/userActions';
import { getAllClients } from 'server/src/lib/actions/client-actions/clientActions';
import { getAllContacts } from 'server/src/lib/actions/contact-actions/contactActions';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { IContact } from 'server/src/interfaces/contact.interfaces';
import { IClient } from 'server/src/interfaces/client.interfaces';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { ButtonComponent, FormFieldComponent, DialogComponent, ContainerComponent } from 'server/src/types/ui-reflection/types';
import { X } from 'lucide-react';

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
  const [duration, setDuration] = useState('');
  const [startTime, setStartTime] = useState<Date | undefined>(undefined);
  const [endTime, setEndTime] = useState<Date | undefined>(undefined);
  const [statusId, setStatusId] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [selectedContactId, setSelectedContactId] = useState<string>('');
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [interactionTypes, setInteractionTypes] = useState<IInteractionType[]>([]);
  const [statuses, setStatuses] = useState<any[]>([]);
  const [users, setUsers] = useState<IUserWithRoles[]>([]);
  const [clients, setClients] = useState<IClient[]>([]);
  const [clientFilterState, setClientFilterState] = useState<'all' | 'active' | 'inactive'>('all');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [contacts, setContacts] = useState<IContact[]>([]);
  const tenant = useTenant()!;
  const { data: session } = useSession();
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  
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

  const { automationIdProps: durationProps } = useAutomationIdAndRegister<FormFieldComponent>({
    id: `${id}-duration`,
    type: 'formField',
    fieldType: 'textField',
    label: 'Duration',
    helperText: 'Duration of the interaction in minutes'
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
          const usersList = await getAllUsers();
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
      setDuration(editingInteraction.duration?.toString() || '');
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

  // Handle start time change
  const handleStartTimeChange = (date: Date) => {
    setStartTime(date);
    
    // If we have a duration, update end time accordingly
    if (duration && !isNaN(parseInt(duration))) {
      const durationMinutes = parseInt(duration);
      const newEndTime = new Date(date.getTime() + durationMinutes * 60000);
      setEndTime(newEndTime);
    }
  };

  // Handle end time change
  const handleEndTimeChange = (date: Date) => {
    setEndTime(date);
    
    // If we have a start time, calculate and update duration
    if (startTime) {
      const diffMilliseconds = date.getTime() - startTime.getTime();
      const diffMinutes = Math.round(diffMilliseconds / 60000);
      
      // Only update duration if the difference is positive
      if (diffMinutes >= 0) {
        setDuration(diffMinutes.toString());
      }
    }
  };

  // Handle duration change
  const handleDurationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newDuration = e.target.value;
    setDuration(newDuration);
    
    // If we have a start time and valid duration, update end time
    if (startTime && newDuration && !isNaN(parseInt(newDuration))) {
      const durationMinutes = parseInt(newDuration);
      const newEndTime = new Date(startTime.getTime() + durationMinutes * 60000);
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
        duration: duration ? parseInt(duration, 10) : null,
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
        setDuration('');
        setStartTime(undefined);
        setEndTime(undefined);
        setSelectedUserId('');
        setSelectedContactId('');
        setSelectedClientId('');
        setIsNotesContentReady(false);
        setHasAttemptedSubmit(false);
        setValidationErrors([]);
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
          onClose();
        }}
        title={isEditMode ? 'Edit Interaction' : 'Add New Interaction'}
        className="max-w-2xl"
        hideCloseButton={false}
      >
        <DialogContent className="max-h-[80vh]">
            {hasAttemptedSubmit && validationErrors.length > 0 && (
              <Alert variant="destructive" className="mb-4">
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
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
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
                      <CustomSelect
                        id={`${id}-client-picker`}
                        options={clients.map((client) => ({
                          value: client.client_id,
                          label: client.client_name
                        }))}
                        value={selectedClientId || null}
                        onValueChange={(clientId) => setSelectedClientId(clientId || '')}
                        placeholder="Select a client"
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
                    id="interaction-start-time"
                    value={startTime}
                    onChange={handleStartTimeChange}
                    placeholder="Select start time"
                    label="Start Time"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">End Time</label>
                  <DateTimePicker
                    id="interaction-end-time"
                    value={endTime}
                    onChange={handleEndTimeChange}
                    placeholder="Select end time"
                    label="End Time"
                    minDate={startTime}
                  />
                </div>
              </div>
              <Input
                type="number"
                value={duration}
                onChange={handleDurationChange}
                placeholder="Duration (minutes)"
                min="0"
              />
              <div className="flex gap-2">
                <Button 
                  id="cancel-interaction-button"
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setHasAttemptedSubmit(false);
                    setValidationErrors([]);
                    onClose();
                  }}
                >
                  Cancel
                </Button>
                <Button 
                  id="save-interaction-button"
                  type="submit" 
                  className={`flex-1 ${!typeId || !title.trim() ? 'opacity-50' : ''}`}
                  disabled={false}
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
