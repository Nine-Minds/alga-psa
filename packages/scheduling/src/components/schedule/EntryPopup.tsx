'use client';

import React, { useState, useEffect } from 'react';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Switch } from '@alga-psa/ui/components/Switch';
import { ExternalLink, Check, X } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useDrawer, DeleteEntityDialog } from "@alga-psa/ui";
import { WorkItemDrawer } from '@alga-psa/scheduling/components/time-management/time-entry/time-sheet/WorkItemDrawer';
import { IScheduleEntry, IRecurrencePattern, IEditScope, DeletionValidationResult } from '@alga-psa/types';
import { AddWorkItemDialog } from '@alga-psa/scheduling/components/time-management/time-entry/time-sheet/AddWorkItemDialog';
import { IWorkItem, IExtendedWorkItem } from '@alga-psa/types';
import { getWorkItemById } from '@alga-psa/scheduling/actions';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import { getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import SelectedWorkItem from '@alga-psa/scheduling/components/time-management/time-entry/time-sheet/SelectedWorkItem';
import { DateTimePicker } from '@alga-psa/ui/components/DateTimePicker';
import { IUser } from '@shared/interfaces/user.interfaces';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { preCheckDeletion } from '@alga-psa/auth/lib/preCheckDeletion';
import {
  approveAppointmentRequest as approveRequest,
  declineAppointmentRequest as declineRequest,
  getTeamsMeetingCapability,
  getAppointmentRequestById,
  IAppointmentRequest
} from '@alga-psa/scheduling/actions';
import toast from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { Label } from '@alga-psa/ui/components/Label';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';

const EntryPopupContext = React.createContext<EntryPopupProps | null>(null);

interface EntryPopupProps {
  event: IScheduleEntry | null;
  slot?: {
    start: Date | string;
    end: Date | string;
    assigned_user_ids?: string[];
    defaultAssigneeId?: string;
  };
  onClose: () => void;
  onSave: (entryData: Omit<IScheduleEntry, 'tenant'> & { updateType?: string }) => void;
  onDelete?: (entryId: string, deleteType?: IEditScope) => Promise<DeletionValidationResult & { success: boolean; deleted?: boolean; error?: string; isPrivateError?: boolean }>;
  canAssignMultipleAgents: boolean;
  users: IUser[];
  currentUserId: string;
  loading?: boolean;
  isInDrawer?: boolean;
  error?: string | null;
  // New props for multi-user schedule logic
  canModifySchedule: boolean;
  focusedTechnicianId: string | null;
  canAssignOthers: boolean; // Derived from user_schedule:update permission in parent
  viewOnly?: boolean;
}

const EntryPopup: React.FC<EntryPopupProps> = ({
  event,
  slot,
  onClose,
  onSave,
  onDelete,
  canAssignMultipleAgents,
  users,
  currentUserId,
  loading = false,
  isInDrawer = false,
  error = null,
  // Destructure new props
  canModifySchedule,
  focusedTechnicianId,
  canAssignOthers,
  viewOnly = false
}) => {
  const [entryData, setEntryData] = useState<Omit<IScheduleEntry, 'tenant'>>(() => {
    if (event) {
      return {
        ...event,
        scheduled_start: new Date(event.scheduled_start),
        scheduled_end: new Date(event.scheduled_end),
        assigned_user_ids: event.assigned_user_ids,
        is_private: event.is_private || false,
      };
    } else if (slot) {
      return {
        entry_id: '',
        title: '',
        scheduled_start: new Date(slot.start),
        scheduled_end: new Date(slot.end),
        notes: '',
        created_at: new Date(),
        updated_at: new Date(),
        work_item_id: null,
        status: 'scheduled',
        work_item_type: 'ad_hoc',
        // Use assigned_user_ids from slot if provided, otherwise default to focused technician or current user
        assigned_user_ids: slot.assigned_user_ids || (focusedTechnicianId ? [focusedTechnicianId] : [currentUserId]),
        is_private: false,
      };
    } else {
      return {
        entry_id: '',
        title: '',
        scheduled_start: new Date(),
        scheduled_end: new Date(),
        notes: '',
        created_at: new Date(),
        updated_at: new Date(),
        work_item_id: null,
        status: 'scheduled',
        work_item_type: 'ad_hoc',
        // Default to focused technician if available, otherwise current user
        assigned_user_ids: focusedTechnicianId ? [focusedTechnicianId] : [currentUserId],
        is_private: false,
      };
    }
  });
  const [selectedWorkItem, setSelectedWorkItem] = useState<Omit<IWorkItem, 'tenant'> | null>(null);
  const [recurrencePattern, setRecurrencePattern] = useState<IRecurrencePattern | null>(null);
  const [isEditingWorkItem, setIsEditingWorkItem] = useState(false);
  const [availableWorkItems, setAvailableWorkItems] = useState<IWorkItem[]>([]);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Appointment request specific state
  const [isAppointmentRequest, setIsAppointmentRequest] = useState(false);
  const [appointmentRequestData, setAppointmentRequestData] = useState<IAppointmentRequest | null>(null);
  const [showDeclineForm, setShowDeclineForm] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [assignedTechnicianId, setAssignedTechnicianId] = useState<string>('');
  const [generateTeamsMeeting, setGenerateTeamsMeeting] = useState(true);
  const [teamsMeetingCapability, setTeamsMeetingCapability] = useState<{ available: boolean; reason?: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const { t } = useTranslation('msp/schedule');
  const { formatDate } = useFormatters();

    // Determine mode and permissions
    const isEditing = !!event;
    const isCurrentUserSoleAssignee = isEditing && event.assigned_user_ids?.length === 1 && event.assigned_user_ids[0] === currentUserId;
    const isPrivateEvent = isEditing && event.is_private;
    
    const canEditFields = viewOnly ? false : (
      !isEditing ||
      (canModifySchedule && (!isPrivateEvent || isCurrentUserSoleAssignee)) ||
      isCurrentUserSoleAssignee
    );
    
    // User can modify assignment if they have the specific permission (passed as canAssignOthers)
    // AND the entry is not private OR they are the creator
    const canModifyAssignment = viewOnly ? false : (
      canAssignOthers && (!isPrivateEvent || isCurrentUserSoleAssignee)
    );
    
    // Add a message to display when a user can't edit a private event
    const privateEventMessage = isPrivateEvent && !isCurrentUserSoleAssignee
      ? t('entryPopup.alerts.privateEntryOnlyCreator', {
          defaultValue: 'This is a private entry. Only the creator can view or edit details.',
        })
      : null;

    // Detect if this is an appointment request and fetch its data
    useEffect(() => {
    const fetchAppointmentRequest = async () => {
      if (event && event.work_item_type === 'appointment_request' && event.work_item_id) {
        setIsAppointmentRequest(true);

        // Fetch the appointment request data to check its status
        const result = await getAppointmentRequestById(event.work_item_id);
        try {
          const capability = await getTeamsMeetingCapability();
          setTeamsMeetingCapability(capability);
        } catch (error) {
          console.error('Failed to load Teams meeting capability:', error);
          setTeamsMeetingCapability({ available: false, reason: 'not_configured' });
        }
        if (result.success && result.data) {
          setAppointmentRequestData(result.data);
          setGenerateTeamsMeeting(true);

            // Pre-fill assigned technician if one exists
            if (event.assigned_user_ids && event.assigned_user_ids.length > 0) {
              setAssignedTechnicianId(event.assigned_user_ids[0]);
            }

            // Fix title for approved appointment requests if it still has [Pending Request] prefix
            if (result.data.status === 'approved' && event.title.includes('[Pending Request]')) {
              const serviceName = (result.data as any).service_name;
              if (serviceName) {
                const correctedTitle = `Appointment: ${serviceName}`;
                console.log('[EntryPopup] Correcting title for approved appointment request:', {
                  oldTitle: event.title,
                  newTitle: correctedTitle
                });
                setEntryData(prev => ({
                  ...prev,
                  title: correctedTitle
                }));
              }
            }
        } else {
          console.error('Failed to fetch appointment request:', result.error);
          setAppointmentRequestData(null);
        }
      } else {
        setIsAppointmentRequest(false);
        setAppointmentRequestData(null);
        setTeamsMeetingCapability(null);
      }
    };

      fetchAppointmentRequest();
    }, [event]);

    // Fetch available work items when dialog opens
  useEffect(() => {
    if (isEditingWorkItem) {
      const fetchWorkItems = async () => {
        try {
          // For existing work items, fetch them
          if (selectedWorkItem && selectedWorkItem.work_item_id && selectedWorkItem.type && selectedWorkItem.type !== 'ad_hoc') {
            const items = await getWorkItemById(selectedWorkItem.work_item_id, selectedWorkItem.type);
            if (items) {
              setAvailableWorkItems([items]);
            } else {
              setAvailableWorkItems([]);
            }
          } else if (entryData.work_item_id && entryData.work_item_type && entryData.work_item_type !== 'ad_hoc') {
            const items = await getWorkItemById(entryData.work_item_id, entryData.work_item_type);
            if (items) {
              setAvailableWorkItems([items]);
            } else {
              setAvailableWorkItems([]);
            }
          } else {
            // For ad-hoc or no work item, clear the list
            setAvailableWorkItems([]);
          }
        } catch (error) {
          console.error('Error fetching work items:', error);
          setAvailableWorkItems([]);
          // Don't set validation errors here as it interrupts the user flow
        }
      };

      fetchWorkItems();
    } else {
      // Clear available work items when not editing to prevent stale data
      setAvailableWorkItems([]);
    }
  }, [isEditingWorkItem, selectedWorkItem, entryData.work_item_id, entryData.work_item_type]);

  useEffect(() => {
    const initializeData = () => {
      if (event) {
        setEntryData({
          ...event,
          scheduled_start: new Date(event.scheduled_start),
          scheduled_end: new Date(event.scheduled_end),
          assigned_user_ids: event.assigned_user_ids,
          work_item_id: event.work_item_id,
        });

        // Load recurrence pattern if it exists
        if (event.recurrence_pattern) {
          setRecurrencePattern({
            ...event.recurrence_pattern,
            startDate: new Date(event.recurrence_pattern.startDate),
            endDate: event.recurrence_pattern.endDate ? new Date(event.recurrence_pattern.endDate) : undefined,
          });
        }

        // Fetch work item information if editing an existing entry
        if (event.work_item_id && event.work_item_type !== 'ad_hoc') {
          getWorkItemById(event.work_item_id, event.work_item_type).then((workItem) => {
            if (workItem) {
              setSelectedWorkItem(workItem);
            }
          });
        }
      } else if (slot) {
        setEntryData({
          entry_id: '',
          title: '',
          scheduled_start: new Date(slot.start),
          scheduled_end: new Date(slot.end),
          notes: '',
          created_at: new Date(),
          updated_at: new Date(),
          work_item_id: null,
          status: 'scheduled',
          work_item_type: 'ad_hoc',
          assigned_user_ids: slot.assigned_user_ids || (focusedTechnicianId ? [focusedTechnicianId] : [currentUserId]),
        });
      }
    };

    initializeData();
  }, [event, slot]);

  const recurrenceOptions = [
    { value: 'none', label: t('entryPopup.recurrence.options.none', { defaultValue: 'None' }) },
    { value: 'daily', label: t('entryPopup.recurrence.options.daily', { defaultValue: 'Daily' }) },
    { value: 'weekly', label: t('entryPopup.recurrence.options.weekly', { defaultValue: 'Weekly' }) },
    { value: 'monthly', label: t('entryPopup.recurrence.options.monthly', { defaultValue: 'Monthly' }) },
    { value: 'yearly', label: t('entryPopup.recurrence.options.yearly', { defaultValue: 'Yearly' }) }
  ];

  const endTypeOptions = [
    { value: 'never', label: t('entryPopup.recurrence.endOptions.never', { defaultValue: 'Never' }) },
    { value: 'date', label: t('entryPopup.recurrence.endOptions.date', { defaultValue: 'On Date' }) },
    { value: 'count', label: t('entryPopup.recurrence.endOptions.count', { defaultValue: 'After' }) }
  ];

  // Note: Holidays are now automatically filtered at the backend from the unified
  // holidays table (shared with SLA system). Tenants configure their own holidays
  // in Settings > SLA > Business Hours. No hardcoded holiday list needed here.

  const handleRecurrenceChange = (value: string) => {
    if (value === 'none') {
      setRecurrencePattern(null);
    } else {
      const isDaily = value === 'daily';
      setRecurrencePattern(prev => ({
        frequency: value as IRecurrencePattern['frequency'],
        interval: 1,
        startDate: entryData.scheduled_start,
        endDate: undefined,
        count: undefined,
        workdaysOnly: isDaily ? true : undefined,
        // Holidays are automatically excluded at the backend from the tenant's holidays table
        exceptions: undefined,
        // For daily workday events, set daysOfWeek to Mon-Fri (0-4 since RRule uses 0-based index for weekdays)
        daysOfWeek: isDaily ? [0, 1, 2, 3, 4] : undefined
      }));
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    clearErrorIfSubmitted();
    setEntryData((prev) => ({
      ...prev,
      [name]: name === 'scheduled_start' || name === 'scheduled_end' ? new Date(value) : value,
    }));
  };

  const handleWorkItemSelect = (workItem: IWorkItem | null) => {
    clearErrorIfSubmitted();
    setSelectedWorkItem(workItem);
    setEntryData(prev => {
      // Only update title if:
      // 1. No title exists yet (empty or undefined), OR
      // 2. Current title matches the previous work item name (user hasn't customized it)
      // Note: selectedWorkItem here refers to the *previous* selection (stale closure) -
      // this is intentional for comparing against the last auto-generated title
      const shouldUpdateTitle = !prev.title?.trim() ||
        (selectedWorkItem && prev.title === selectedWorkItem.name);

      return {
        ...prev,
        work_item_id: workItem ? workItem.work_item_id : null,
        title: workItem && shouldUpdateTitle ? workItem.name : prev.title,
        work_item_type: workItem?.type || 'ad_hoc'
      };
    });
    // Clear available work items to prevent stale data
    setAvailableWorkItems([]);
    setIsEditingWorkItem(false);
  };

  const handleEndTypeChange = (value: string) => {
    setRecurrencePattern(prev => {
      if (prev === null) return null;
      return {
        ...prev,
        endDate: value === 'date' ? new Date() : undefined,
        count: value === 'count' ? 1 : undefined
      };
    });
  };

  const handleAssignedUsersChange = (userIds: string[]) => {
    clearErrorIfSubmitted();
    setEntryData(prev => {
      // If the selected user is not the current user, set is_private to false
      const isPrivate = userIds.length === 1 && userIds[0] === currentUserId ? prev.is_private : false;
      
      return {
        ...prev,
        assigned_user_ids: userIds,
        is_private: isPrivate
      };
    });
  };

  const [showRecurrenceDialog, setShowRecurrenceDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteValidation, setDeleteValidation] = useState<DeletionValidationResult | null>(null);
  const [isDeleteValidating, setIsDeleteValidating] = useState(false);
  const [isDeleteProcessing, setIsDeleteProcessing] = useState(false);
  const [pendingDeleteScope, setPendingDeleteScope] = useState<IEditScope | undefined>(undefined);
  const [pendingUpdateData, setPendingUpdateData] = useState<Omit<IScheduleEntry, 'tenant'>>();
  const deleteConfirmationMessage = appointmentRequestData?.online_meeting_url
    ? t('entryPopup.delete.confirmWithTeamsWarning', {
        defaultValue: 'Are you sure you want to delete this schedule entry? This action cannot be undone. This will also delete the Microsoft Teams meeting.',
      })
    : t('entryPopup.delete.confirm', {
        defaultValue: 'Are you sure you want to delete this schedule entry? This action cannot be undone.',
      });

  useEffect(() => {
    if (!isDeleteDialogOpen || !event) {
      return;
    }

    const runValidation = async () => {
      setIsDeleteValidating(true);
      try {
        const result = await preCheckDeletion('schedule_entry', event.entry_id);
        setDeleteValidation(result);
      } catch (error) {
        console.error('Failed to validate schedule entry deletion:', error);
        setDeleteValidation({
          canDelete: false,
          code: 'VALIDATION_FAILED',
          message: t('entryPopup.delete.validationFailed', {
            defaultValue: 'Failed to validate deletion. Please try again.',
          }),
          dependencies: [],
          alternatives: []
        });
      } finally {
        setIsDeleteValidating(false);
      }
    };

    void runValidation();
  }, [event, isDeleteDialogOpen]);

  const resetDeleteState = () => {
    setShowDeleteDialog(false);
    setIsDeleteDialogOpen(false);
    setDeleteValidation(null);
    setIsDeleteValidating(false);
    setIsDeleteProcessing(false);
    setPendingDeleteScope(undefined);
  };

  const handleDeleteConfirm = (selected?: string) => {
    if (event) {
      setPendingDeleteScope(event.is_recurring ? (selected as IEditScope) : undefined);
      setShowDeleteDialog(false);
      setIsDeleteDialogOpen(true);
    }
  };

  const handleDeleteDialogConfirm = async () => {
    if (!event || !onDelete) {
      resetDeleteState();
      onClose();
      return;
    }
    setIsDeleteProcessing(true);
    try {
      const result = await onDelete(event.entry_id, pendingDeleteScope);
      if (result.success) {
        resetDeleteState();
        onClose();
      } else {
        setDeleteValidation(result);
      }
    } finally {
      setIsDeleteProcessing(false);
    }
  };

  const clearErrorIfSubmitted = () => {
    if (hasAttemptedSubmit) {
      setValidationErrors([]);
    }
  };

  // Handle appointment request approval
  const handleApproveRequest = async () => {
    if (!event || !event.work_item_id) return;

    if (!assignedTechnicianId) {
      toast.error(t('entryPopup.appointmentRequest.toasts.assignTechnicianRequired', {
        defaultValue: 'Please assign a technician',
      }));
      return;
    }

    setIsProcessing(true);
    try {
      const startDate = new Date(event.scheduled_start);
      const endDate = new Date(event.scheduled_end);

      const result = await approveRequest({
        appointment_request_id: event.work_item_id,
        assigned_user_id: assignedTechnicianId,
        final_date: startDate.toISOString().split('T')[0],
        final_time: startDate.toTimeString().slice(0, 5),
        generate_teams_meeting: Boolean(teamsMeetingCapability?.available && generateTeamsMeeting),
      });

      if (result.success) {
        toast.success(t('entryPopup.appointmentRequest.toasts.approved', {
          defaultValue: 'Appointment request approved',
        }));
        onClose();
        // Trigger calendar refresh by calling onSave with the updated entry
        // Update the title to remove [Pending Request] prefix
        if (onSave) {
          const serviceName = appointmentRequestData ? (appointmentRequestData as any).service_name : null;
          const correctedTitle = serviceName ? `Appointment: ${serviceName}` : entryData.title;

          onSave({
            ...entryData,
            title: correctedTitle,
            assigned_user_ids: [assignedTechnicianId]
          });
        }
      } else {
        toast.error(result.error || t('entryPopup.appointmentRequest.toasts.approveFailed', {
          defaultValue: 'Failed to approve request',
        }));
      }
    } catch (error) {
      handleError(error, t('entryPopup.appointmentRequest.toasts.approveFailed', {
        defaultValue: 'Failed to approve request',
      }));
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle appointment request decline
  const handleDeclineRequest = async () => {
    if (!event || !event.work_item_id) return;

    if (!declineReason.trim()) {
      toast.error(t('entryPopup.appointmentRequest.toasts.declineReasonRequired', {
        defaultValue: 'Please provide a reason for declining',
      }));
      return;
    }

    setIsProcessing(true);
    try {
      const result = await declineRequest({
        appointment_request_id: event.work_item_id,
        decline_reason: declineReason
      });

      if (result.success) {
        toast.success(t('entryPopup.appointmentRequest.toasts.declined', {
          defaultValue: 'Appointment request declined',
        }));
        onClose();
        // Don't call onSave - the schedule entry was deleted by the decline action
        // Just refresh the calendar by calling onDelete if available
        if (onDelete && event.entry_id) {
          onDelete(event.entry_id);
        }
      } else {
        toast.error(result.error || t('entryPopup.appointmentRequest.toasts.declineFailed', {
          defaultValue: 'Failed to decline request',
        }));
      }
    } catch (error) {
      handleError(error, t('entryPopup.appointmentRequest.toasts.declineFailed', {
        defaultValue: 'Failed to decline request',
      }));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSave = () => {
    if (!canEditFields && isEditing) return;
    
    setHasAttemptedSubmit(true);
    const errors: string[] = [];
    
    // Validate required fields
    if (!entryData.title?.trim() && entryData.work_item_type === 'ad_hoc') {
      errors.push(t('entryPopup.validation.titleRequiredForAdHoc', {
        defaultValue: 'Title is required for ad-hoc entries',
      }));
    }
    if (!entryData.scheduled_start) {
      errors.push(t('entryPopup.validation.startRequired', { defaultValue: 'Start date/time' }));
    }
    if (!entryData.scheduled_end) {
      errors.push(t('entryPopup.validation.endRequired', { defaultValue: 'End date/time' }));
    }
    if (!entryData.assigned_user_ids || entryData.assigned_user_ids.length === 0) {
      errors.push(t('entryPopup.validation.assigneeRequired', {
        defaultValue: 'At least one assigned user',
      }));
    }
    
    // Validate dates
    const startDate = new Date(entryData.scheduled_start);
    const endDate = new Date(entryData.scheduled_end);

    if (isNaN(startDate.getTime())) {
      errors.push(t('entryPopup.validation.startInvalid', { defaultValue: 'Start date is invalid' }));
    }

    if (isNaN(endDate.getTime())) {
      errors.push(t('entryPopup.validation.endInvalid', { defaultValue: 'End date is invalid' }));
    }

    if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime()) && endDate <= startDate) {
      errors.push(t('entryPopup.validation.endAfterStart', {
        defaultValue: 'End date must be after start date',
      }));
    }
    
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }
    
    setValidationErrors([]);

    // Validate recurrence pattern dates if present
    if (recurrencePattern) {
      // Validate interval
      if (!Number.isInteger(recurrencePattern.interval) || recurrencePattern.interval < 1) {
        errors.push(t('entryPopup.validation.recurrenceIntervalPositive', {
          defaultValue: 'Recurrence interval must be a positive whole number',
        }));
      }

      // Validate count if specified
      if (recurrencePattern.count !== undefined) {
        if (!Number.isInteger(recurrencePattern.count) || recurrencePattern.count < 1) {
          errors.push(t('entryPopup.validation.recurrenceCountPositive', {
            defaultValue: 'Number of occurrences must be a positive whole number',
          }));
        }
      }

      // Validate end date if specified
      if (recurrencePattern.endDate) {
        const patternEndDate = new Date(recurrencePattern.endDate);
        if (isNaN(patternEndDate.getTime())) {
          errors.push(t('entryPopup.validation.recurrenceEndInvalid', {
            defaultValue: 'Recurrence end date is invalid',
          }));
        } else if (patternEndDate <= startDate) {
          errors.push(t('entryPopup.validation.recurrenceEndAfterStart', {
            defaultValue: 'Recurrence end date must be after start date',
          }));
        }
      }
    }
    
    // Check if we have any recurrence errors
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    // Prepare entry data
    const savedEntryData = {
      ...entryData,
      recurrence_pattern: recurrencePattern || null,
      work_item_id: entryData.work_item_type === 'ad_hoc' ? null : entryData.work_item_id,
      status: entryData.status || 'scheduled',
      assigned_user_ids: Array.isArray(entryData.assigned_user_ids) ? entryData.assigned_user_ids : []
    };

    // Show recurrence options only for existing recurring events
    if (event?.is_recurring) {
      setPendingUpdateData(savedEntryData);
      setShowRecurrenceDialog(true);
    } else {
      onSave(savedEntryData);
    }
  };

  // Create the content of the form
  const content = (
    <form onSubmit={(e) => { e.preventDefault(); handleSave(); }} className={`bg-white p-4 rounded-lg h-auto flex flex-col transition-all duration-300 z-10
    ${isInDrawer ? 
      'w-fit max-w-[90vw] shadow-none' : 
      'max-w-[95vw] w-auto min-w-[300px] max-h-[90vh] shadow-none'
      }`} noValidate
    >
      <div className="shrink-0 pb-4 border-b flex justify-between items-center">
        {isInDrawer && (
          <h2 className="text-xl font-bold">
            {isAppointmentRequest && appointmentRequestData && appointmentRequestData.status === 'pending'
              ? t('entryPopup.title.appointmentRequest', { defaultValue: 'Appointment Request' })
              : viewOnly
                ? t('entryPopup.title.view', { defaultValue: 'View Entry' })
                : event
                  ? t('entryPopup.title.edit', { defaultValue: 'Edit Entry' })
                  : t('entryPopup.title.new', { defaultValue: 'New Entry' })}
          </h2>
        )}
        <div className={`flex gap-2 ${!isInDrawer ? 'ml-auto' : ''}`}>
          {event && event.work_item_type && (event.work_item_type === 'ticket' || event.work_item_type === 'project_task' || event.work_item_type === 'interaction') && event.work_item_id && (
            <OpenDrawerButton event={event} />
          )}
          {/* Only show delete button if not a private event or user is creator */}
          {event && onDelete && !viewOnly && (!event.is_private || isCurrentUserSoleAssignee) && (
            <Button
              id="delete-entry-btn"
              onClick={() => {
                setDeleteValidation(null);
                setPendingDeleteScope(undefined);
                if (event.is_recurring) {
                  setShowDeleteDialog(true);
                  return;
                }
                setIsDeleteDialogOpen(true);
              }}
              type="button"
              variant="destructive"
              size="sm"
            >
              {t('entryPopup.actions.delete', { defaultValue: 'Delete Entry' })}
            </Button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto space-y-4 p-1">
        {hasAttemptedSubmit && validationErrors.length > 0 && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>
              <p className="font-medium mb-2">
                {t('entryPopup.validation.summaryTitle', {
                  defaultValue: 'Please fill in the required fields:',
                })}
              </p>
              <ul className="list-disc list-inside space-y-1">
                {validationErrors.map((err, index) => (
                  <li key={index}>{err}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
      </div>  
        {/* Display message for private events */}
        {privateEventMessage && (
          <Alert variant="warning" className="mb-4">
            <AlertDescription>{privateEventMessage}</AlertDescription>
          </Alert>
        )}

        {/* Info badge for approved appointment requests */}
        {isAppointmentRequest && event && appointmentRequestData && appointmentRequestData.status === 'approved' && (
          <Alert variant="success" className="mb-4">
            <AlertDescription>
              <p className="font-medium">
                {t('entryPopup.appointmentRequest.approved.title', {
                  defaultValue: 'Approved Appointment',
                })}
              </p>
              <p className="text-sm mt-1">
                {appointmentRequestData.approved_at
                  ? t('entryPopup.appointmentRequest.approved.descriptionWithDate', {
                      defaultValue: 'This appointment originated from a client request and was approved on {{date}}.',
                      date: formatDate(new Date(appointmentRequestData.approved_at), { dateStyle: 'medium' }),
                    })
                  : t('entryPopup.appointmentRequest.approved.description', {
                    defaultValue: 'This appointment originated from a client request.',
                  })}
              </p>
              {appointmentRequestData.online_meeting_url && (
                <div className="mt-3">
                  <Button
                    id="join-teams-meeting-entry-popup"
                    type="button"
                    variant="outline"
                    onClick={() => window.open(appointmentRequestData.online_meeting_url!, '_blank', 'noopener,noreferrer')}
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    {t('entryPopup.appointmentRequest.approved.joinTeamsMeeting', {
                      defaultValue: 'Join Teams Meeting',
                    })}
                  </Button>
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* Requester info — shown for any appointment-request entry when useful fields are populated */}
        {isAppointmentRequest && appointmentRequestData && (() => {
          const ar = appointmentRequestData as any;
          const companyLabel = ar.is_authenticated ? ar.client_company_name : ar.company_name;
          const contactName = ar.contact_name || (!ar.is_authenticated ? ar.requester_name : null);
          const contactEmail = ar.contact_email || (!ar.is_authenticated ? ar.requester_email : null);
          const contactPhone = !ar.is_authenticated ? ar.requester_phone : null;
          if (!companyLabel && !contactName && !contactEmail && !contactPhone) return null;
          return (
            <div className="mb-4 rounded border border-gray-200 bg-gray-50 p-3">
              <p className="text-sm font-semibold text-gray-700 mb-2">
                {t('entryPopup.appointmentRequest.requesterInfo.title', { defaultValue: 'Requester Info' })}
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                {companyLabel && (
                  <div>
                    <div className="text-xs text-gray-500">
                      {t('entryPopup.appointmentRequest.requesterInfo.company', { defaultValue: 'Company' })}
                    </div>
                    <div>{companyLabel}</div>
                  </div>
                )}
                {contactName && (
                  <div>
                    <div className="text-xs text-gray-500">
                      {t('entryPopup.appointmentRequest.requesterInfo.name', { defaultValue: 'Name' })}
                    </div>
                    <div>{contactName}</div>
                  </div>
                )}
                {contactEmail && (
                  <div>
                    <div className="text-xs text-gray-500">
                      {t('entryPopup.appointmentRequest.requesterInfo.email', { defaultValue: 'Email' })}
                    </div>
                    <div>
                      <a href={`mailto:${contactEmail}`} className="text-blue-600 hover:underline break-all">
                        {contactEmail}
                      </a>
                    </div>
                  </div>
                )}
                {contactPhone && (
                  <div>
                    <div className="text-xs text-gray-500">
                      {t('entryPopup.appointmentRequest.requesterInfo.phone', { defaultValue: 'Phone' })}
                    </div>
                    <div>
                      <a href={`tel:${contactPhone}`} className="text-blue-600 hover:underline">
                        {contactPhone}
                      </a>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* Status display for declined/cancelled appointment requests */}
        {isAppointmentRequest && event && appointmentRequestData && (appointmentRequestData.status === 'declined' || appointmentRequestData.status === 'cancelled') && (
          <div className="space-y-4">
            <Alert variant={appointmentRequestData.status === 'declined' ? 'destructive' : 'default'}>
              <AlertDescription>
                <p className="font-medium">
                  {appointmentRequestData.status === 'declined'
                    ? t('entryPopup.appointmentRequest.declined.title', {
                        defaultValue: 'Declined Appointment Request',
                      })
                    : t('entryPopup.appointmentRequest.cancelled.title', {
                        defaultValue: 'Cancelled Appointment Request',
                      })}
                </p>
                <p className="text-sm mt-1">
                  {appointmentRequestData.status === 'declined' && appointmentRequestData.declined_reason
                    ? t('entryPopup.appointmentRequest.declined.descriptionWithReason', {
                        defaultValue: 'This appointment request was declined: {{reason}}',
                        reason: appointmentRequestData.declined_reason,
                      })
                    : appointmentRequestData.status === 'declined'
                      ? t('entryPopup.appointmentRequest.declined.description', {
                          defaultValue: 'This appointment request was declined.',
                        })
                      : null}
                  {appointmentRequestData.status === 'cancelled' &&
                    t('entryPopup.appointmentRequest.cancelled.description', {
                      defaultValue: 'This appointment request was cancelled by the client.',
                    })}
                </p>
              </AlertDescription>
            </Alert>

            <div>
              <Label>
                {t('entryPopup.appointmentRequest.requestedDateTimeLabel', {
                  defaultValue: 'Requested Date & Time',
                })}
              </Label>
              <div className="text-sm bg-gray-50 p-3 rounded border">
                {formatDate(new Date(event.scheduled_start), { dateStyle: 'medium', timeStyle: 'short' })} - {formatDate(new Date(event.scheduled_end), { timeStyle: 'short' })}
              </div>
            </div>

            {event.notes && (
              <div>
                <Label>{t('entryPopup.fields.notes', { defaultValue: 'Notes' })}</Label>
                <div className="text-sm bg-gray-50 p-3 rounded border whitespace-pre-wrap">
                  {event.notes}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Appointment Request Approval UI - Only for PENDING requests */}
        {isAppointmentRequest && event && appointmentRequestData && appointmentRequestData.status === 'pending' && (
          <div className="space-y-4">
                <Alert className="border-rose-200 bg-rose-50">
                  <AlertDescription>
                    <p className="font-medium text-rose-900">
                      {t('entryPopup.appointmentRequest.pending.title', {
                        defaultValue: 'Pending Appointment Request',
                      })}
                    </p>
                    <p className="text-sm text-rose-700 mt-1">
                      {t('entryPopup.appointmentRequest.pending.description', {
                        defaultValue: 'This is an appointment request from a client. You can approve or decline it below.',
                      })}
                    </p>
                  </AlertDescription>
                </Alert>

                <div>
                  <UserPicker
                    id="assign-technician-request"
                    label={t('entryPopup.appointmentRequest.assignTechnicianLabel', {
                      defaultValue: 'Assign Technician *',
                    })}
                    users={users}
                    value={assignedTechnicianId}
                    onValueChange={setAssignedTechnicianId}
                    getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
                    placeholder={t('entryPopup.appointmentRequest.assignTechnicianPlaceholder', {
                      defaultValue: 'Select technician',
                    })}
                    userTypeFilter="internal"
                    buttonWidth="full"
                  />
                </div>

                {teamsMeetingCapability?.available && (
                  <div>
                    <Switch
                      id="generate-teams-meeting-entry-popup"
                      checked={generateTeamsMeeting}
                      onCheckedChange={setGenerateTeamsMeeting}
                      label={t('entryPopup.appointmentRequest.generateTeamsMeeting', {
                        defaultValue: 'Generate Microsoft Teams meeting link',
                      })}
                    />
                  </div>
                )}

                <div>
                  <Label>
                    {t('entryPopup.appointmentRequest.scheduledDateTimeLabel', {
                      defaultValue: 'Scheduled Date & Time',
                    })}
                  </Label>
                  <div className="text-sm bg-gray-50 p-3 rounded border">
                    {formatDate(new Date(event.scheduled_start), { dateStyle: 'medium', timeStyle: 'short' })} - {formatDate(new Date(event.scheduled_end), { timeStyle: 'short' })}
                  </div>
                </div>

                <div>
                  <Label>{t('entryPopup.fields.notes', { defaultValue: 'Notes' })}</Label>
                  <div className="text-sm bg-gray-50 p-3 rounded border whitespace-pre-wrap">
                    {event.notes || t('entryPopup.appointmentRequest.noNotes', {
                      defaultValue: 'No notes provided',
                    })}
                  </div>
                </div>

                {!showDeclineForm ? (
                  <div className="flex gap-2 pt-4">
                    <Button
                      id="approve-appointment-request"
                      onClick={handleApproveRequest}
                      disabled={isProcessing || !assignedTechnicianId}
                      className="flex-1"
                      type="button"
                    >
                      <Check className="h-4 w-4 mr-2" />
                      {t('entryPopup.appointmentRequest.actions.approve', { defaultValue: 'Approve' })}
                    </Button>
                    <Button
                      id="decline-appointment-request-show"
                      variant="outline"
                      onClick={() => setShowDeclineForm(true)}
                      disabled={isProcessing}
                      className="flex-1"
                      type="button"
                    >
                      <X className="h-4 w-4 mr-2" />
                      {t('entryPopup.appointmentRequest.actions.decline', { defaultValue: 'Decline' })}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4 pt-4 border-t">
                    <div>
                      <Label htmlFor="decline-reason">
                        {t('entryPopup.appointmentRequest.declineReasonLabel', {
                          defaultValue: 'Reason for Declining *',
                        })}
                      </Label>
                      <TextArea
                        id="decline-reason"
                        value={declineReason}
                        onChange={(e) => setDeclineReason(e.target.value)}
                        placeholder={t('entryPopup.appointmentRequest.declineReasonPlaceholder', {
                          defaultValue: 'Please provide a reason for declining this request...',
                        })}
                        rows={4}
                      />
                    </div>

                    <div className="flex gap-2">
                      <Button
                        id="confirm-decline-request"
                        variant="destructive"
                        onClick={handleDeclineRequest}
                        disabled={isProcessing || !declineReason.trim()}
                        className="flex-1"
                        type="button"
                      >
                        <X className="h-4 w-4 mr-2" />
                        {t('entryPopup.appointmentRequest.actions.confirmDecline', {
                          defaultValue: 'Confirm Decline',
                        })}
                      </Button>
                      <Button
                        id="cancel-decline-request"
                        variant="outline"
                        onClick={() => {
                          setShowDeclineForm(false);
                          setDeclineReason('');
                        }}
                        disabled={isProcessing}
                        className="flex-1"
                        type="button"
                      >
                        {t('entryPopup.actions.cancel', { defaultValue: 'Cancel' })}
                      </Button>
                    </div>
                  </div>
                )}
          </div>
        )}

        {/* Regular Edit Form - show if NOT an appointment request OR if it's an approved appointment request */}
        {(!isAppointmentRequest || (appointmentRequestData && appointmentRequestData.status === 'approved')) && (
        <div className="min-w-0">
          <div className="relative">
            {viewOnly ? (
              <div className="flex justify-between items-center p-2">
                {selectedWorkItem ? (
                  <div>
                    <div className="font-medium">{selectedWorkItem.name}</div>
                    <div className="text-sm text-gray-500 capitalize">{selectedWorkItem.type.replace('_', ' ')}</div>
                  </div>
                ) : (
                  <span className="font-bold text-[rgb(var(--color-text-900))]">
                    {t('entryPopup.workItem.adHocFallback', {
                      defaultValue: 'Ad-hoc entry (no work item)',
                    })}
                  </span>
                )}
              </div>
            ) : (
              <SelectedWorkItem
                workItem={selectedWorkItem}
                onEdit={(e?: React.MouseEvent) => {
                  if (e) {
                    e.preventDefault();
                    e.stopPropagation();
                  }
                  setIsEditingWorkItem(true);
                }}
              />
            )}
            {isEditingWorkItem && (
              <AddWorkItemDialog
                isOpen={isEditingWorkItem}
                onClose={() => {
                  setIsEditingWorkItem(false);
                  setAvailableWorkItems([]);
                }}
                onAdd={(workItem) => {
                  handleWorkItemSelect(workItem);
                }}
                availableWorkItems={availableWorkItems}
              />
            )}
          </div>

          <div className="space-y-4">
          <div>
            <label htmlFor="title" className="block text-sm font-medium text-gray-700">
              {t('entryPopup.fields.title', { defaultValue: 'Title' })}
            </label>
            <Input
              id="title"
              name="title"
              value={entryData.title}
              onChange={handleInputChange}
              className=""
              disabled={!canEditFields} // Disable based on permissions
            />
          </div>
          <div className="flex gap-4 items-start">
            {canAssignMultipleAgents && (
              <div className="flex-1">
                <label htmlFor="assigned_users" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('entryPopup.fields.assignedUsers', { defaultValue: 'Assigned Users *' })}
                </label>
                <UserPicker
                  value={entryData.assigned_user_ids?.[0] || currentUserId}
                  onValueChange={(userId) => handleAssignedUsersChange([userId])}
                  users={users}
                  getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
                  // Disable if loading OR if user lacks permission to assign others
                  disabled={loading || !canModifyAssignment}
                />
              </div>
            )}
            {/* Only show private switch if the selected user is the current user */}
            {entryData.assigned_user_ids?.length === 1 && entryData.assigned_user_ids[0] === currentUserId && (
              <div className="flex-1 flex items-end">
                  <Switch
                    id="is-private"
                    checked={entryData.is_private || false}
                    onCheckedChange={(checked) => {
                      setEntryData(prev => ({
                        ...prev,
                        is_private: checked
                      }));
                    }}
                  label={t('entryPopup.fields.privateEntry', {
                    defaultValue: 'Private entry (not visible to other users)',
                  })}
                  disabled={!canEditFields}
                />
              </div>
            )}
          </div>
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700">
                {t('entryPopup.fields.start', { defaultValue: 'Start *' })}
              </label>
              <DateTimePicker
                id="scheduled_start"
                value={entryData.scheduled_start}
                onChange={(date) => {
                  setEntryData(prev => ({
                    ...prev,
                    scheduled_start: date
                  }));
                }}
                className="mt-1"
                disabled={!canEditFields} // Disable based on permissions
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700">
                {t('entryPopup.fields.end', { defaultValue: 'End *' })}
              </label>
              <DateTimePicker
                id="scheduled_end"
                value={entryData.scheduled_end}
                onChange={(date) => {
                  setEntryData(prev => ({
                    ...prev,
                    scheduled_end: date
                  }));
                }}
                className="mt-1"
                minDate={entryData.scheduled_start}
                disabled={!canEditFields} // Disable based on permissions
              />
            </div>
          </div>
          <div>
            <label htmlFor="notes" className="block text-sm font-medium text-gray-700">
              {t('entryPopup.fields.notes', { defaultValue: 'Notes' })}
            </label>
            <TextArea
              id="notes"
              name="notes"
              value={entryData.notes}
              onChange={handleInputChange}
              rows={3}
              className=""
              disabled={!canEditFields} // Disable based on permissions
            />
          </div>
        </div>
        <div className="space-y-4">
          <div className="relative z-10">
            <CustomSelect
              label={t('entryPopup.recurrence.label', { defaultValue: 'Recurrence' })}
              value={recurrencePattern?.frequency || 'none'}
              onValueChange={handleRecurrenceChange}
              options={recurrenceOptions}
              disabled={!canEditFields} // Disable based on permissions
            />
          </div>
        </div>
        {recurrencePattern && (
          <div className="space-y-4">
            <div className="flex gap-4">
              <div className="flex-1">
                <label htmlFor="interval" className="block text-sm font-medium text-gray-700">
                  {t('entryPopup.recurrence.intervalLabel', { defaultValue: 'Interval' })}
                </label>
                <Input
                  id="interval"
                  type="number"
                  value={recurrencePattern.interval}
                  onChange={(e) => {
                    const value = parseInt(e.target.value);
                    if (value < 1 || value > 100) {
                      // Don't update if out of range
                      return;
                    }
                    setRecurrencePattern(prev => {
                      if (prev === null) return null;
                      return { ...prev, interval: value };
                    });
                  }}
                  min={1}
                  max={100}
                  className=""
                  disabled={!canEditFields} // Disable based on permissions
                />
              </div>
              <div className="flex-1">
                <CustomSelect
                  label={t('entryPopup.recurrence.endLabel', { defaultValue: 'End' })}
                  value={recurrencePattern.endDate ? 'date' : recurrencePattern.count ? 'count' : 'never'}
                  onValueChange={handleEndTypeChange}
                  options={endTypeOptions}
                  disabled={!canEditFields} // Disable based on permissions
                />
              </div>
            </div>
            {recurrencePattern.endDate && (
              <div>
                <label htmlFor="endDate" className="block text-sm font-medium text-gray-700">
                  {t('entryPopup.recurrence.endDateLabel', { defaultValue: 'End Date' })}
                </label>
                <DatePicker
                  id="endDate"
                  value={recurrencePattern.endDate instanceof Date ? recurrencePattern.endDate : new Date(recurrencePattern.endDate)}
                  onChange={(date: Date) => setRecurrencePattern(prev => {
                    if (prev === null) return null;
                    return { ...prev, endDate: date };
                  })}
                  disabled={!canEditFields}
                />
              </div>
            )}
            {recurrencePattern.count && (
              <div>
                <label htmlFor="count" className="block text-sm font-medium text-gray-700">
                  {t('entryPopup.recurrence.occurrencesLabel', { defaultValue: 'Occurrences' })}
                </label>
                <Input
                  id="count"
                  type="number"
                  value={recurrencePattern.count}
                  onChange={(e) => {
                    const value = parseInt(e.target.value);
                    if (value < 1 || value > 100) {
                      // Don't update if out of range
                      return;
                    }
                    setRecurrencePattern(prev => {
                      if (prev === null) return null;
                      return { ...prev, count: value };
                    });
                  }}
                  min={1}
                  max={100}
                  className=""
                  disabled={!canEditFields} // Disable based on permissions
                />
              </div>
            )}
            {recurrencePattern.frequency === 'daily' && (
              <div className="flex items-center gap-2">
                <Switch
                  id="workdays-only"
                  checked={recurrencePattern.workdaysOnly ?? true}
                  onCheckedChange={(checked) => setRecurrencePattern(prev => {
                    if (prev === null) return null;
                    return {
                      ...prev,
                      workdaysOnly: checked,
                      // Update daysOfWeek based on the switch
                      // Holidays are automatically excluded at the backend from the tenant's holidays table
                      daysOfWeek: checked ? [0, 1, 2, 3, 4] : undefined
                    };
                  })}
                  label={t('entryPopup.recurrence.workdaysOnly', {
                    defaultValue: 'Workdays only (Mon-Fri, excluding holidays)',
                  })}
                  disabled={!canEditFields} // Disable based on permissions
                />
              </div>
            )}
          </div>
        )}
        </div>
        )}

      <div className="mt-6 flex justify-end space-x-3">
        {/* Only show Cancel/Close button if not in a drawer, since the drawer will have its own close button */}
        {!isInDrawer && (
          <Button id="cancel-entry-btn" onClick={onClose} variant="outline">
            {t('entryPopup.actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
        )}

        {/* Buttons section - different for appointment requests vs regular entries */}
        {viewOnly || (isAppointmentRequest && appointmentRequestData && appointmentRequestData.status !== 'approved') ? (
          <Button
            id="close-entry-btn"
            onClick={onClose}
          >
            {t('entryPopup.actions.close', { defaultValue: 'Close' })}
          </Button>
        ) : (
          <Button
            id="save-entry-btn"
            type="submit"
            className={`${
              (entryData.work_item_type === 'ad_hoc' && !entryData.title?.trim()) ||
              !entryData.scheduled_start ||
              !entryData.scheduled_end ||
              entryData.assigned_user_ids.length === 0
                ? 'opacity-50' : ''
            }`}
            // Disable save only if editing AND user lacks permission to edit these fields
            disabled={isEditing && !canEditFields}
          >
            {t('entryPopup.actions.save', { defaultValue: 'Save' })}
          </Button>
        )}
      </div>
    </form>
  );

  // Provide the context value to child components
  const contextValue: EntryPopupProps = {
    event,
    slot,
    onClose,
    onSave,
    onDelete,
    canAssignMultipleAgents,
    users,
    currentUserId,
    loading,
    isInDrawer,
    error,
    canModifySchedule,
    focusedTechnicianId,
    canAssignOthers,
    viewOnly
  };

  // When already in a drawer or dialog context, don't wrap in another Dialog
  const shouldWrapInDialog = !isInDrawer;

  if (!shouldWrapInDialog) {
    return (
      <EntryPopupContext value={contextValue}>
        {content}
      </EntryPopupContext>
    );
  }

  return (
    <Dialog
      isOpen={true}
      onClose={onClose}
      hideCloseButton={false}
      title={isAppointmentRequest && appointmentRequestData && appointmentRequestData.status === 'pending'
        ? t('entryPopup.title.appointmentRequest', { defaultValue: 'Appointment Request' })
        : viewOnly
          ? t('entryPopup.title.view', { defaultValue: 'View Entry' })
          : event
            ? t('entryPopup.title.edit', { defaultValue: 'Edit Entry' })
            : t('entryPopup.title.new', { defaultValue: 'New Entry' })}
    >
      <EntryPopupContext value={contextValue}>
        {content}
      </EntryPopupContext>
      
      <ConfirmationDialog
        className="max-w-[450px]"
        isOpen={showDeleteDialog}
        onConfirm={handleDeleteConfirm}
        onClose={() => setShowDeleteDialog(false)}
        title={t('entryPopup.delete.scopeDialog.title', { defaultValue: 'Delete Schedule Entry' })}
        message={t('entryPopup.delete.scopeDialog.message', { defaultValue: 'Select which events to delete:' })}
        options={[
          { value: IEditScope.SINGLE, label: t('entryPopup.scopeOptions.single', { defaultValue: 'Only this event' }) },
          { value: IEditScope.FUTURE, label: t('entryPopup.scopeOptions.future', { defaultValue: 'This and future events' }) },
          { value: IEditScope.ALL, label: t('entryPopup.scopeOptions.all', { defaultValue: 'All events' }) }
        ]}
        confirmLabel={t('entryPopup.delete.scopeDialog.confirm', { defaultValue: 'Continue' })}
      />

      <DeleteEntityDialog
        id={event ? `delete-entry-${event.entry_id}` : 'delete-entry-dialog'}
        isOpen={isDeleteDialogOpen}
        onClose={resetDeleteState}
        onConfirmDelete={handleDeleteDialogConfirm}
        entityName={event?.title || t('entryPopup.delete.entityFallback', { defaultValue: 'this schedule entry' })}
        confirmationMessage={deleteConfirmationMessage}
        validationResult={deleteValidation}
        isValidating={isDeleteValidating}
        isDeleting={isDeleteProcessing}
      />

      <ConfirmationDialog
        className="max-w-[450px]"
        isOpen={showRecurrenceDialog}
        onClose={() => setShowRecurrenceDialog(false)}
        onConfirm={async (updateType) => {
          if (pendingUpdateData) {
            onSave({...pendingUpdateData, updateType: updateType as IEditScope});
            setShowRecurrenceDialog(false);
          }
        }}
        title={t('entryPopup.recurrence.applyDialog.title', { defaultValue: 'Apply Changes To' })}
        message={t('entryPopup.recurrence.applyDialog.message', { defaultValue: 'Select which events to update:' })}
        options={[
          { value: IEditScope.SINGLE, label: t('entryPopup.scopeOptions.single', { defaultValue: 'Only this event' }) },
          { value: IEditScope.FUTURE, label: t('entryPopup.scopeOptions.future', { defaultValue: 'This and future events' }) },
          { value: IEditScope.ALL, label: t('entryPopup.scopeOptions.all', { defaultValue: 'All events' }) }
        ]}
        id="recurrence-edit-dialog"
      />
    </Dialog>
  );
};

// Component for the Open Drawer button
const OpenDrawerButton = ({ event }: { event: IScheduleEntry }) => {
  const { openDrawer, closeDrawer } = useDrawer();
  const { t } = useTranslation('msp/schedule');
  // Get access to the parent component's props
  const parentProps = React.useContext(EntryPopupContext);

  const handleOpenDrawer = () => {
    const workItem = {
      work_item_id: event.work_item_id || '',
      type: event.work_item_type,
      name: event.title,
      title: event.title,
      description: event.notes || '',
      startTime: new Date(event.scheduled_start),
      endTime: new Date(event.scheduled_end),
      scheduled_start: new Date(event.scheduled_start).toISOString(),
      scheduled_end: new Date(event.scheduled_end).toISOString(),
      users: event.assigned_user_ids.map(id => ({ user_id: id })),
      tenant: event.tenant,
      is_billable: true
    } as IExtendedWorkItem;

    // Close the current popup first if not in a drawer
    if (parentProps && !parentProps.isInDrawer) {
      parentProps.onClose();
    }
    
    openDrawer(
      <div className="h-full">
        <WorkItemDrawer
          workItem={workItem}
          onClose={closeDrawer}
          onTaskUpdate={async () => {}}
          onScheduleUpdate={async () => {}}
        />
      </div>
    );
  };

  return (
    <Button
      id="open-drawer-btn"
      onClick={handleOpenDrawer}
      variant="outline"
      size="sm"
      className="flex items-center gap-1"
    >
      <ExternalLink className="w-4 h-4" />
      <span>{t('entryPopup.workItem.openDetails', { defaultValue: 'Details' })}</span>
    </Button>
  );
};

export default EntryPopup;
