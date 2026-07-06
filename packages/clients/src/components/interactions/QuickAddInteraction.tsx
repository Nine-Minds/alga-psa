// server/src/components/interactions/QuickAddInteraction.tsx
'use client'

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Input } from '@alga-psa/ui/components/Input';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Switch } from '@alga-psa/ui/components/Switch';
import RichTextEditorSkeleton from '@alga-psa/ui/components/skeletons/RichTextEditorSkeleton';

// Dynamic import for TextEditor
const TextEditor = dynamic<any>(() => import('@alga-psa/ui/editor').then((mod) => mod.TextEditor), {
  loading: () => <RichTextEditorSkeleton height="150px" title="Interaction Notes" />,
  ssr: false
});
import { DateTimePicker } from '@alga-psa/ui/components/DateTimePicker';
import { PartialBlock } from '@blocknote/core';
import InteractionIcon from '@alga-psa/ui/components/InteractionIcon';
import { getInteractionById, getAllClients, getAllContacts, getClientById } from '@alga-psa/clients/actions';
import { addInteraction, updateInteraction, getInteractionStatuses } from '@alga-psa/clients/actions';
import { getAllInteractionTypes } from '@alga-psa/clients/actions';
import { IInteraction, IInteractionType } from '@alga-psa/types';
import { useTenant } from '@alga-psa/ui/components/providers/TenantProvider';
import { useSession } from 'next-auth/react';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import { getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { ContactPicker } from '@alga-psa/ui/components/ContactPicker';
import { getAllUsersBasicAsync } from '../../lib/usersHelpers';
import { clampDuration } from '../../lib/durationHelpers';
import { IUser } from '@shared/interfaces/user.interfaces';
import { IContact } from '@alga-psa/types';
import { IClient } from '@alga-psa/types';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { useAutomationIdAndRegister } from '@alga-psa/ui/ui-reflection/useAutomationIdAndRegister';
import { ButtonComponent, FormFieldComponent } from '@alga-psa/ui/ui-reflection/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useOptionalClientCrossFeature } from '../../context/ClientCrossFeatureContext';
import QuickAddContact from '../contacts/QuickAddContact';
import MeetingAttendeesPicker, { type MeetingAttendee, type DefaultMeetingAttendee } from './MeetingAttendeesPicker';

interface QuickAddInteractionProps {
  id?: string; // Made optional to maintain backward compatibility
  entityId: string;
  entityType: 'contact' | 'client';
  clientId?: string;
  ticketId?: string; // Links the new interaction to a ticket (create mode only)
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
  ticketId,
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
  const [isQuickAddContactOpen, setIsQuickAddContactOpen] = useState(false);
  const tenant = useTenant()!;
  const { data: session } = useSession();
  const { t } = useTranslation('msp/clients');
  const clientCrossFeature = useOptionalClientCrossFeature();
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [endTimeError, setEndTimeError] = useState('');
  const [teamsMeetingCapability, setTeamsMeetingCapability] = useState<{ available: boolean; reason?: string } | null>(null);
  const [createTeamsMeeting, setCreateTeamsMeeting] = useState(false);
  const [isTeamsCapabilityLoading, setIsTeamsCapabilityLoading] = useState(false);
  const [meetingAttendees, setMeetingAttendees] = useState<MeetingAttendee[]>([]);
  const [clientDefaultEmail, setClientDefaultEmail] = useState<string | null>(null);
  const [clientDefaultName, setClientDefaultName] = useState<string | null>(null);
  const [hasLoadedAttendeeOptions, setHasLoadedAttendeeOptions] = useState(false);

  const isEditMode = !!editingInteraction;

  // Resolve the client/contact this new interaction is attached to (create mode only).
  const meetingClientId = !isEditMode
    ? (entityType === 'client' ? entityId : (clientId ?? null))
    : null;
  const meetingContactId = !isEditMode && entityType === 'contact' ? entityId : null;
  const selectedInteractionType = useMemo(
    () => interactionTypes.find((type) => type.type_id === typeId) ?? null,
    [interactionTypes, typeId]
  );
  const isOnlineMeetingType = selectedInteractionType?.type_name === 'Online Meeting';
  const canCreateTeamsMeeting = !isEditMode
    && isOnlineMeetingType
    && !!clientCrossFeature?.scheduleTeamsMeeting
    && teamsMeetingCapability?.available === true;

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
      
      // Parse notes content – detect plain text vs JSON to avoid throwing
      const rawNotes = editingInteraction.notes?.trim() ?? '';
      if (rawNotes === '') {
        setNotesContent([]);
      } else if (rawNotes.startsWith('[') || rawNotes.startsWith('{')) {
        // Looks like JSON – attempt to parse
        try {
          const parsedNotes = JSON.parse(rawNotes);
          if (Array.isArray(parsedNotes) && parsedNotes.length > 0 &&
              parsedNotes.every((block: any) => block && typeof block === 'object' && block.type)) {
            setNotesContent(parsedNotes);
          } else {
            setNotesContent([]);
          }
        } catch {
          // Malformed JSON that starts with [ or { – wrap as plain text
          setNotesContent([{
            type: "paragraph",
            props: { textAlignment: "left", backgroundColor: "default", textColor: "default" },
            content: [{ type: "text", text: rawNotes, styles: {} }]
          }]);
        }
      } else {
        // Plain text notes – wrap in a paragraph block
        setNotesContent([{
          type: "paragraph",
          props: { textAlignment: "left", backgroundColor: "default", textColor: "default" },
          content: [{ type: "text", text: rawNotes, styles: {} }]
        }]);
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

  useEffect(() => {
    if (!isOpen || !isOnlineMeetingType || isEditMode || !clientCrossFeature?.getTeamsMeetingCapability) {
      setTeamsMeetingCapability(null);
      setCreateTeamsMeeting(false);
      return;
    }

    let cancelled = false;
    setIsTeamsCapabilityLoading(true);
    clientCrossFeature.getTeamsMeetingCapability()
      .then((capability) => {
        if (cancelled) return;
        setTeamsMeetingCapability(capability);
        setCreateTeamsMeeting(capability.available);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Failed to load Teams meeting capability:', error);
        setTeamsMeetingCapability({ available: false, reason: 'not_configured' });
        setCreateTeamsMeeting(false);
      })
      .finally(() => {
        if (!cancelled) {
          setIsTeamsCapabilityLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, isOnlineMeetingType, isEditMode, clientCrossFeature]);

  // Load attendee options (internal users + contacts) only once the Teams meeting toggle is
  // on (i.e. the attendee picker is actually shown) — avoids running the heavy getAllContacts()
  // query every time the "Online Meeting" type is merely selected. The `hasLoadedAttendeeOptions`
  // guard keeps it to a single fetch per dialog session.
  useEffect(() => {
    if (!isOpen || isEditMode || !isOnlineMeetingType || !createTeamsMeeting || hasLoadedAttendeeOptions) {
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const [usersList, contactsList] = await Promise.all([
          getAllUsersBasicAsync(false, 'internal'),
          getAllContacts(),
        ]);
        if (cancelled) return;
        setUsers(usersList);
        setContacts(contactsList);
        setHasLoadedAttendeeOptions(true);
      } catch (error) {
        console.error('Failed to load meeting attendee options:', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, isEditMode, isOnlineMeetingType, createTeamsMeeting, hasLoadedAttendeeOptions]);

  // Resolve the attached client's default (location) email to prefill as an attendee.
  useEffect(() => {
    if (!isOpen || isEditMode || !isOnlineMeetingType || !createTeamsMeeting || !meetingClientId) {
      setClientDefaultEmail(null);
      setClientDefaultName(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const client = await getClientById(meetingClientId);
        if (cancelled) return;
        setClientDefaultEmail(client?.location_email ?? client?.email ?? null);
        setClientDefaultName(client?.client_name ?? null);
      } catch (error) {
        console.error('Failed to load client default email:', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, isEditMode, isOnlineMeetingType, createTeamsMeeting, meetingClientId]);

  // Prefill: the attached contact's email (as a contact chip) or the client location email.
  const defaultAttendees = useMemo<DefaultMeetingAttendee[]>(() => {
    if (meetingContactId) {
      const contact = contacts.find((candidate) => candidate.contact_name_id === meetingContactId);
      const email = contact?.email?.trim();
      if (contact && email) {
        return [{
          emailAddress: email,
          name: contact.full_name,
          contactId: meetingContactId,
          avatarUrl: contact.avatarUrl ?? null,
        }];
      }
      return [];
    }
    if (clientDefaultEmail) {
      return [{ emailAddress: clientDefaultEmail, name: clientDefaultName ?? undefined }];
    }
    return [];
  }, [meetingContactId, contacts, clientDefaultEmail, clientDefaultName]);

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
    if (createTeamsMeeting && canCreateTeamsMeeting) {
      if (!startTime) {
        errors.push(t('interactions.quickAdd.teams.startRequired', {
          defaultValue: 'Start time is required to create a Teams meeting',
        }));
      }
      if (!endTime) {
        errors.push(t('interactions.quickAdd.teams.endRequired', {
          defaultValue: 'End time is required to create a Teams meeting',
        }));
      }
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
        if (ticketId) {
          interactionData.ticket_id = ticketId;
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
      } else if (createTeamsMeeting && canCreateTeamsMeeting && startTime && endTime) {
        const scheduleResult = await clientCrossFeature.scheduleTeamsMeeting!({
          subject: title,
          startDateTime: startTime,
          endDateTime: endTime,
          client_id: interactionData.client_id ?? null,
          contact_name_id: interactionData.contact_name_id ?? null,
          attendees: meetingAttendees,
        });
        if (!scheduleResult.success || !scheduleResult.data?.interaction_id) {
          throw new Error(scheduleResult.error || t('interactions.quickAdd.teams.createFailed', {
            defaultValue: 'Failed to create Teams meeting',
          }));
        }
        resultInteraction = { interaction_id: scheduleResult.data.interaction_id } as IInteraction;
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
      setIsQuickAddContactOpen(false);
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
        setTeamsMeetingCapability(null);
        setCreateTeamsMeeting(false);
        setMeetingAttendees([]);
        setClientDefaultEmail(null);
        setClientDefaultName(null);
        setHasLoadedAttendeeOptions(false);
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

  const typeOptions = useMemo(
    () => interactionTypes.map((type) => ({
      value: type.type_id,
      label: getTypeLabel(type),
      textValue: type.type_name
    })),
    [interactionTypes]
  );

  const footer = (
    <div className="flex gap-2 w-full">
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
        type="button"
        onClick={() => (document.getElementById('quick-add-interaction-form') as HTMLFormElement | null)?.requestSubmit()}
        className={`flex-1 ${!typeId || !title.trim() ? 'opacity-50' : ''}`}
        disabled={!typeId || !title.trim() || !!endTimeError}
      >
        {isEditMode ? 'Update Interaction' : 'Save Interaction'}
      </Button>
    </div>
  );

  return (
    <ReflectionContainer id={id} label="Quick Add Interaction">
      <Dialog
        isOpen={isOpen}
        onClose={() => {
        setHasAttemptedSubmit(false);
        setValidationErrors([]);
        setEndTimeError('');
        setIsQuickAddContactOpen(false);
        onClose();
      }}
        title={isEditMode ? 'Edit Interaction' : 'Add New Interaction'}
        className="max-w-2xl"
        hideCloseButton={false}
        footer={footer}
      >
        <DialogContent>
            <form id="quick-add-interaction-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
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
                  options={typeOptions}
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

                {isOnlineMeetingType && !isEditMode && (
                  <div className="space-y-3">
                    {canCreateTeamsMeeting ? (
                      <>
                        <Switch
                          id={`${id}-create-teams-meeting-toggle`}
                          checked={createTeamsMeeting}
                          onCheckedChange={setCreateTeamsMeeting}
                          label={t('interactions.quickAdd.teams.createToggle', {
                            defaultValue: 'Create Teams meeting',
                          })}
                        />
                        {createTeamsMeeting && (
                          <MeetingAttendeesPicker
                            id={`${id}-attendees`}
                            users={users}
                            contacts={contacts}
                            clientId={meetingClientId}
                            defaultAttendees={defaultAttendees}
                            getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
                            onAttendeesChange={setMeetingAttendees}
                          />
                        )}
                      </>
                    ) : (
                      <p className="text-sm text-gray-600">
                        {isTeamsCapabilityLoading
                          ? t('interactions.quickAdd.teams.checkingCapability', {
                              defaultValue: 'Checking Teams meeting availability...',
                            })
                          : t('interactions.quickAdd.teams.unavailable', {
                              defaultValue: 'Teams meeting creation is not available for this tenant.',
                            })}
                      </p>
                    )}
                  </div>
                )}
              
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
                      <div className="w-full h-[100px] bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg flex items-center justify-center">
                        <span className="text-gray-500 dark:text-gray-400">Loading editor...</span>
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
                        getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
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
                        onAddNew={selectedClientId ? () => setIsQuickAddContactOpen(true) : undefined}
                      />
                    </div>
                  </div>
                </div>
              )}
              <QuickAddContact
                isOpen={isQuickAddContactOpen}
                onClose={() => setIsQuickAddContactOpen(false)}
                onContactAdded={(newContact) => {
                  setContacts((prevContacts) => {
                    const existingIndex = prevContacts.findIndex((contact) => contact.contact_name_id === newContact.contact_name_id);
                    if (existingIndex >= 0) {
                      const nextContacts = [...prevContacts];
                      nextContacts[existingIndex] = newContact;
                      return nextContacts;
                    }
                    return [...prevContacts, newContact];
                  });
                  setSelectedContactId(newContact.contact_name_id);
                  setIsQuickAddContactOpen(false);
                }}
                clients={clients}
                selectedClientId={selectedClientId}
              />
              
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
            </form>
        </DialogContent>
      </Dialog>
    </ReflectionContainer>
  );
}
