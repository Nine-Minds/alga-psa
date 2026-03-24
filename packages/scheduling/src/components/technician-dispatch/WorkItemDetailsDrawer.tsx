'use client'

import React from 'react';
import { IExtendedWorkItem } from '@alga-psa/types';
import { IProjectTask } from '@alga-psa/types';
import { IScheduleEntry } from '@alga-psa/types';
import { getWorkItemById } from '@alga-psa/scheduling/actions';
import { getCurrentUser, getAllUsersBasic } from '@alga-psa/user-composition/actions';
import { getScheduleEntries } from '@alga-psa/scheduling/actions';
import { getSchedulingInteractionById } from '../../actions/clientInteractionLookupActions';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import EntryPopup from '@alga-psa/scheduling/components/schedule/EntryPopup';
import { SchedulingInteractionDetails } from '../shared/SchedulingInteractionDetails';
import { SchedulingTicketDetails } from '../shared/SchedulingTicketDetails';
import { useTenant } from '@alga-psa/ui/components/providers/TenantProvider';
import { getSchedulingTicketById } from '../../actions/ticketLookupActions';
import { getSchedulingProjectTaskById } from '../../actions/projectTaskLookupActions';
import { SchedulingProjectTaskDetails } from '../shared/SchedulingProjectTaskDetails';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface WorkItemDetailsDrawerProps {
    workItem: IExtendedWorkItem;
    onClose: () => void;
    onTaskUpdate: (updatedTask: IProjectTask | null) => Promise<void>;
    onScheduleUpdate: (entryData: Omit<IScheduleEntry, "tenant">) => Promise<void>;
}

export function WorkItemDetailsDrawer({
    workItem,
    onClose,
    onTaskUpdate,
    onScheduleUpdate
}: WorkItemDetailsDrawerProps): React.JSX.Element {
    const tenant = useTenant();
    const { t } = useTranslation('msp/dispatch');
    const { formatDate: formatLocaleDate } = useFormatters();
    if (!tenant) {
        throw new Error('tenant is not defined');
    }

    const [content, setContent] = React.useState<React.JSX.Element | null>(null);
    const [isLoading, setIsLoading] = React.useState(true);
    const [users, setUsers] = React.useState<any[]>([]);
    const [isUsersLoading, setIsUsersLoading] = React.useState(true);

    React.useEffect(() => {
        const loadUsers = async () => {
            console.log('Starting to load users...');
            try {
                setIsUsersLoading(true);
                const allUsers = await getAllUsersBasic();
                console.log('Users loaded:', allUsers?.length ?? 0);
                if (!allUsers || allUsers.length === 0) {
                    console.warn('No users returned from getAllUsersBasic');
                    toast.error(t('details.toasts.noUsersAvailable', { defaultValue: 'No users available in the system' }));
                }
                setUsers(allUsers || []);
            } catch (error) {
                handleError(error, t('details.errors.loadUsers', { defaultValue: 'Failed to load users. Please try refreshing the page.' }));
                setUsers([]);
            } finally {
                console.log('Finished loading users, setting isUsersLoading to false');
                setIsUsersLoading(false);
            }
        };
        loadUsers();
    }, [t]);

    // Debug effect to track state changes
    React.useEffect(() => {
        console.log('State updated:', {
            isLoading,
            isUsersLoading,
            usersCount: users.length,
            hasContent: content !== null
        });
    }, [isLoading, isUsersLoading, users, content]);

    const loadContent = React.useCallback(async () => {
        try {
            const currentUser = await getCurrentUser();
            if (!currentUser) {
                toast.error(t('details.toasts.noUserSession', { defaultValue: 'No user session found' }));
                return null;
            }

            switch(workItem.type) {
                case 'ticket': {
                    const ticketData = await getSchedulingTicketById(workItem.work_item_id);
                    if (!ticketData) {
                        toast.error(t('details.toasts.failedToLoadTicketData', { defaultValue: 'Failed to load ticket data' }));
                        return null;
                    }
                    return (
                        <div className="h-full">
                            <SchedulingTicketDetails ticket={ticketData} />
                        </div>
                    );
                }

                case 'project_task': {
                    const taskData = await getSchedulingProjectTaskById(workItem.work_item_id);
                    if (!taskData) {
                        toast.error(t('details.toasts.failedToLoadProjectTaskData', { defaultValue: 'Failed to load project task data' }));
                        return null;
                    }
                    return (
                        <div className="h-full">
                            <SchedulingProjectTaskDetails task={taskData} />
                        </div>
                    );
                }

                case 'ad_hoc': {
                    const adHocData = await getWorkItemById(workItem.work_item_id, 'ad_hoc');
                    if (!adHocData) {
                        toast.error(t('details.toasts.failedToLoadAdHocEntryData', { defaultValue: 'Failed to load ad-hoc entry data' }));
                        return null;
                    }

                    // Get schedule entry data to get assigned users
                    const start = new Date(adHocData.scheduled_start || new Date());
                    const end = new Date(adHocData.scheduled_end || new Date());
                    const scheduleResult = await getScheduleEntries(start, end);
                    const scheduleEntry = scheduleResult.success ? 
                        scheduleResult.entries.find((e: IScheduleEntry) => e.entry_id === adHocData.work_item_id) : null;

                    console.log('Schedule entry:', scheduleEntry);
                    
                    return (
                        <div className="h-full">
                            {currentUser && (
                            <EntryPopup
                                canAssignMultipleAgents={true}
                                users={users}
                                currentUserId={currentUser.user_id}
                                event={{
                                    entry_id: adHocData.work_item_id,
                                    work_item_id: adHocData.work_item_id,
                                    work_item_type: adHocData.type,
                                    title: adHocData.name,
                                    notes: adHocData.description,
                                    scheduled_start: new Date(adHocData.scheduled_start || new Date()),
                                    scheduled_end: new Date(adHocData.scheduled_end || new Date()),
                                    status: 'SCHEDULED',
                                    assigned_user_ids: scheduleEntry?.assigned_user_ids || [],
                                    created_at: new Date(),
                                    updated_at: new Date()
                                }}
                                onClose={onClose}
                                onSave={onScheduleUpdate}
                                isInDrawer={true}
                                canModifySchedule={true}
                                focusedTechnicianId={currentUser.user_id}
                                canAssignOthers={true}
                            />
                            )}
                        </div>
                    );
                }

                case 'interaction': {
                    console.log('Loading interaction with ID:', workItem.work_item_id);
                    const interactionData = await getSchedulingInteractionById(workItem.work_item_id);
                    if (!interactionData) {
                        toast.error(t('details.toasts.failedToLoadInteractionData', { defaultValue: 'Failed to load interaction data' }));
                        return null;
                    }

                    return (
                        <div className="h-full">
                            <SchedulingInteractionDetails interaction={interactionData} />
                        </div>
                    );
                }

                case 'appointment_request': {
                    console.log('Loading appointment request with ID:', workItem.work_item_id);
                    const { getAppointmentRequestById } = await import('@alga-psa/scheduling/actions');
                    const result = await getAppointmentRequestById(workItem.work_item_id);
                    if (!result.success || !result.data) {
                        toast.error(t('details.toasts.failedToLoadAppointmentRequestData', { defaultValue: 'Failed to load appointment request data' }));
                        return null;
                    }

                    const appointmentRequest = result.data as any;

                    // Format date and time safely
                    const formatDateValue = (date: any) => {
                        if (!date) {
                            return t('details.messages.notAvailable', { defaultValue: 'N/A' });
                        }
                        if (date instanceof Date) {
                            return formatLocaleDate(date);
                        }
                        if (typeof date === 'string') {
                            return formatLocaleDate(new Date(date));
                        }
                        return String(date);
                    };

                    const formatTime = (time: any) => {
                        if (!time) {
                            return t('details.messages.notAvailable', { defaultValue: 'N/A' });
                        }
                        if (typeof time === 'string') return time;
                        return String(time);
                    };

                    const formatDateTime = (dateTime: any) => {
                        if (!dateTime) {
                            return t('details.messages.notAvailable', { defaultValue: 'N/A' });
                        }
                        if (dateTime instanceof Date) {
                            return formatLocaleDate(dateTime, {
                                year: 'numeric',
                                month: 'numeric',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                            });
                        }
                        if (typeof dateTime === 'string') {
                            return formatLocaleDate(new Date(dateTime), {
                                year: 'numeric',
                                month: 'numeric',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                            });
                        }
                        return String(dateTime);
                    };

                    return (
                        <div className="h-full p-4">
                            <h2 className="text-2xl font-bold mb-4">
                                {t('details.appointmentRequest.title', { defaultValue: 'Appointment Request Details' })}
                            </h2>
                            <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div>
                                        <div className="font-semibold text-gray-700">
                                            {t('details.fields.service', { defaultValue: 'Service' })}
                                        </div>
                                        <div>{appointmentRequest.service_name || t('details.messages.notAvailable', { defaultValue: 'N/A' })}</div>
                                    </div>
                                    <div>
                                        <div className="font-semibold text-gray-700">
                                            {t('details.fields.status', { defaultValue: 'Status' })}
                                        </div>
                                        <div className="capitalize">{String(appointmentRequest.status || t('details.messages.notAvailable', { defaultValue: 'N/A' }))}</div>
                                    </div>
                                    {appointmentRequest.is_authenticated ? (
                                        <>
                                            <div>
                                                <div className="font-semibold text-gray-700">
                                                    {t('details.fields.client', { defaultValue: 'Client' })}
                                                </div>
                                                <div>{appointmentRequest.client_company_name || t('details.messages.notAvailable', { defaultValue: 'N/A' })}</div>
                                            </div>
                                            <div>
                                                <div className="font-semibold text-gray-700">
                                                    {t('details.fields.contact', { defaultValue: 'Contact' })}
                                                </div>
                                                <div>{appointmentRequest.contact_name || t('details.messages.notAvailable', { defaultValue: 'N/A' })}</div>
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <div>
                                                <div className="font-semibold text-gray-700">
                                                    {t('details.fields.company', { defaultValue: 'Company' })}
                                                </div>
                                                <div>{appointmentRequest.company_name || t('details.messages.notAvailable', { defaultValue: 'N/A' })}</div>
                                            </div>
                                            <div>
                                                <div className="font-semibold text-gray-700">
                                                    {t('details.fields.requester', { defaultValue: 'Requester' })}
                                                </div>
                                                <div>{appointmentRequest.requester_name || t('details.messages.notAvailable', { defaultValue: 'N/A' })}</div>
                                            </div>
                                        </>
                                    )}
                                    <div>
                                        <div className="font-semibold text-gray-700">
                                            {t('details.fields.email', { defaultValue: 'Email' })}
                                        </div>
                                        <div>{appointmentRequest.contact_email || appointmentRequest.requester_email || t('details.messages.notAvailable', { defaultValue: 'N/A' })}</div>
                                    </div>
                                    {appointmentRequest.requester_phone && (
                                        <div>
                                            <div className="font-semibold text-gray-700">
                                                {t('details.fields.phone', { defaultValue: 'Phone' })}
                                            </div>
                                            <div>{String(appointmentRequest.requester_phone)}</div>
                                        </div>
                                    )}
                                    <div>
                                        <div className="font-semibold text-gray-700">
                                            {t('details.fields.requestedDate', { defaultValue: 'Requested Date' })}
                                        </div>
                                        <div>{formatDateValue(appointmentRequest.requested_date)}</div>
                                    </div>
                                    <div>
                                        <div className="font-semibold text-gray-700">
                                            {t('details.fields.requestedTime', { defaultValue: 'Requested Time' })}
                                        </div>
                                        <div>{formatTime(appointmentRequest.requested_time)}</div>
                                    </div>
                                    <div>
                                        <div className="font-semibold text-gray-700">
                                            {t('details.fields.duration', { defaultValue: 'Duration' })}
                                        </div>
                                        <div>
                                            {String(appointmentRequest.requested_duration)}{' '}
                                            {t('details.units.minutes', { defaultValue: 'minutes' })}
                                        </div>
                                    </div>
                                    {appointmentRequest.preferred_technician_first_name && (
                                        <div>
                                            <div className="font-semibold text-gray-700">
                                                {t('details.fields.preferredTechnician', { defaultValue: 'Preferred Technician' })}
                                            </div>
                                            <div>{appointmentRequest.preferred_technician_first_name} {appointmentRequest.preferred_technician_last_name}</div>
                                        </div>
                                    )}
                                </div>
                                {appointmentRequest.description && (
                                    <div>
                                        <div className="font-semibold text-gray-700 mb-1">
                                            {t('details.fields.description', { defaultValue: 'Description' })}
                                        </div>
                                        <div className="text-sm bg-gray-50 p-3 rounded border">{String(appointmentRequest.description)}</div>
                                    </div>
                                )}
                                {appointmentRequest.declined_reason && (
                                    <div>
                                        <div className="font-semibold text-gray-700 mb-1">
                                            {t('details.fields.declineReason', { defaultValue: 'Decline Reason' })}
                                        </div>
                                        <div className="text-sm bg-red-50 dark:bg-red-900/20 p-3 rounded border border-red-200 dark:border-red-800 text-red-900 dark:text-red-300">{String(appointmentRequest.declined_reason)}</div>
                                    </div>
                                )}
                                {appointmentRequest.approved_by_user_id && (
                                    <div className="border-t pt-4">
                                        <div className="font-semibold text-gray-700 mb-2">
                                            {t('details.sections.approvalInformation', { defaultValue: 'Approval Information' })}
                                        </div>
                                        <div className="text-sm space-y-1">
                                            <div>
                                                <span className="text-gray-600">
                                                    {t('details.fields.approvedBy', { defaultValue: 'Approved by:' })}
                                                </span>{' '}
                                                {appointmentRequest.approver_first_name} {appointmentRequest.approver_last_name}
                                            </div>
                                            {appointmentRequest.approved_at && (
                                                <div>
                                                    <span className="text-gray-600">
                                                        {t('details.fields.approvedAt', { defaultValue: 'Approved at:' })}
                                                    </span>{' '}
                                                    {formatDateTime(appointmentRequest.approved_at)}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                }

                default:
                    return (
                        <div className="h-full">
                            <div>{t('details.messages.unsupportedWorkItemType', { defaultValue: 'Unsupported work item type' })}</div>
                        </div>
                    );
            }
        } catch (error) {
            console.error('Error loading content:', error);
            return (
                <div className="h-full">
                    <div className="flex flex-col items-center justify-center h-full text-red-500">
                        <div className="text-lg mb-2">
                            {t('details.errors.loadingContent', { defaultValue: 'Error loading content' })}
                        </div>
                        <div className="text-sm">
                            {t('details.errors.tryAgain', { defaultValue: 'Please try again' })}
                        </div>
                    </div>
                </div>
            );
        }
    }, [workItem, tenant, onClose, onTaskUpdate, onScheduleUpdate, isUsersLoading, users, t, formatLocaleDate]);

    React.useEffect(() => {
        const init = async () => {
            setIsLoading(true);
            const loadedContent = await loadContent();
            setContent(loadedContent);
            setIsLoading(false);
        };
        init();
    }, [loadContent]); 

    return (
        <div className="min-w-auto h-full bg-white">
            {isLoading ? (
                <div className="flex items-center justify-center h-full">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
                </div>
            ) : content}
        </div>
    );
}
