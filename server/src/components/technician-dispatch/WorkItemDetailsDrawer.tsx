'use client'

import React from 'react';
import { IExtendedWorkItem } from 'server/src/interfaces/workItem.interfaces';
import { IProjectTask } from 'server/src/interfaces/project.interfaces';
import { IScheduleEntry } from 'server/src/interfaces/schedule.interfaces';
import { getConsolidatedTicketData } from 'server/src/lib/actions/ticket-actions/optimizedTicketActions';
import { getTaskWithDetails } from 'server/src/lib/actions/project-actions/projectTaskActions';
import { getWorkItemById } from 'server/src/lib/actions/workItemActions';
import { getCurrentUser, getAllUsersBasic } from 'server/src/lib/actions/user-actions/userActions';
import { getScheduleEntries } from 'server/src/lib/actions/scheduleActions';
import { getInteractionById } from 'server/src/lib/actions/interactionActions';
import { toast } from 'react-hot-toast';
import TicketDetails from 'server/src/components/tickets/ticket/TicketDetails';
import TaskEdit from 'server/src/components/projects/TaskEdit';
import EntryPopup from 'server/src/components/schedule/EntryPopup';
import InteractionDetails from 'server/src/components/interactions/InteractionDetails';
import { useTenant } from 'server/src/components/TenantProvider';

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
                    toast.error('No users available in the system');
                }
                setUsers(allUsers || []);
            } catch (error) {
                console.error('Error loading users:', error);
                toast.error('Failed to load users. Please try refreshing the page.');
                setUsers([]);
            } finally {
                console.log('Finished loading users, setting isUsersLoading to false');
                setIsUsersLoading(false);
            }
        };
        loadUsers();
    }, []);

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
                toast.error('No user session found');
                return null;
            }

            switch(workItem.type) {
                case 'ticket': {
                    const ticketData = await getConsolidatedTicketData(workItem.work_item_id, currentUser);
                    return (
                        <div className="h-full">
                            <TicketDetails
                                isInDrawer={true}
                                initialTicket={ticketData.ticket}
                                initialComments={ticketData.comments}
                                initialBoard={ticketData.board}
                                initialClient={ticketData.client}
                                initialContacts={ticketData.contacts}
                                initialContactInfo={ticketData.contactInfo}
                                initialCreatedByUser={ticketData.createdByUser}
                                initialAdditionalAgents={ticketData.additionalAgents}
                                statusOptions={ticketData.options.status}
                                agentOptions={ticketData.options.agent}
                                boardOptions={ticketData.options.board}
                                priorityOptions={ticketData.options.priority}
                                initialCategories={ticketData.categories}
                                initialClients={ticketData.clients}
                                initialLocations={ticketData.locations}
                                initialAgentSchedules={ticketData.agentSchedules}
                                initialUserMap={ticketData.userMap}
                                initialAvailableAgents={ticketData.availableAgents}
                                onClose={onClose}
                            />
                        </div>
                    );
                }

                case 'project_task': {
                    console.log('Loading project task with details:', {
                        workItemId: workItem.work_item_id,
                        isUsersLoading,
                        usersCount: users.length
                    });
                    const taskData = await getTaskWithDetails(workItem.work_item_id, currentUser);
                    console.log('Task data loaded:', taskData);
                    return (
                        <div className="h-full">
                            {users.length === 0 ? (
                                <div className="flex items-center justify-center h-full text-gray-500">
                                    No users available
                                </div>
                            ) : (
                                <TaskEdit
                                    inDrawer={true}
                                    phase={{
                                        phase_id: taskData.phase_id,
                                        project_id: taskData.project_id || '',
                                        phase_name: taskData.phase_name || '',
                                        description: null,
                                        start_date: null,
                                        end_date: null,
                                        status: taskData.status_id || '',
                                        order_number: 0,
                                        created_at: new Date(),
                                        updated_at: new Date(),
                                        wbs_code: taskData.wbs_code,
                                        tenant: tenant
                                    }}
                                    task={{
                                        ...taskData,
                                        tenant: tenant
                                    }}
                                    users={users}
                                    onClose={onClose}
                                    onTaskUpdated={onTaskUpdate}
                                />
                            )}
                        </div>
                    );
                }

                case 'ad_hoc': {
                    const adHocData = await getWorkItemById(workItem.work_item_id, 'ad_hoc');
                    if (!adHocData) {
                        toast.error('Failed to load ad-hoc entry data');
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
                    const interactionData = await getInteractionById(workItem.work_item_id);
                    if (!interactionData) {
                        toast.error('Failed to load interaction data');
                        return null;
                    }

                    return (
                        <div className="h-full">
                            <InteractionDetails
                                interaction={interactionData}
                                isInDrawer={true}
                                onInteractionDeleted={onClose}
                                onInteractionUpdated={async () => {
                                    // Optionally refresh the data in the parent
                                    await onTaskUpdate(null);
                                }}
                            />
                        </div>
                    );
                }

                case 'appointment_request': {
                    console.log('Loading appointment request with ID:', workItem.work_item_id);
                    const { getAppointmentRequestById } = await import('server/src/lib/actions/appointmentRequestManagementActions');
                    const result = await getAppointmentRequestById(workItem.work_item_id);
                    if (!result.success || !result.data) {
                        toast.error('Failed to load appointment request data');
                        return null;
                    }

                    const appointmentRequest = result.data as any;

                    // Format date and time safely
                    const formatDate = (date: any) => {
                        if (!date) return 'N/A';
                        if (date instanceof Date) return date.toLocaleDateString();
                        if (typeof date === 'string') return new Date(date).toLocaleDateString();
                        return String(date);
                    };

                    const formatTime = (time: any) => {
                        if (!time) return 'N/A';
                        if (typeof time === 'string') return time;
                        return String(time);
                    };

                    const formatDateTime = (dateTime: any) => {
                        if (!dateTime) return 'N/A';
                        if (dateTime instanceof Date) return dateTime.toLocaleString();
                        if (typeof dateTime === 'string') return new Date(dateTime).toLocaleString();
                        return String(dateTime);
                    };

                    return (
                        <div className="h-full p-4">
                            <h2 className="text-2xl font-bold mb-4">Appointment Request Details</h2>
                            <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div>
                                        <div className="font-semibold text-gray-700">Service</div>
                                        <div>{appointmentRequest.service_name || 'N/A'}</div>
                                    </div>
                                    <div>
                                        <div className="font-semibold text-gray-700">Status</div>
                                        <div className="capitalize">{String(appointmentRequest.status || 'N/A')}</div>
                                    </div>
                                    {appointmentRequest.is_authenticated ? (
                                        <>
                                            <div>
                                                <div className="font-semibold text-gray-700">Client</div>
                                                <div>{appointmentRequest.client_company_name || 'N/A'}</div>
                                            </div>
                                            <div>
                                                <div className="font-semibold text-gray-700">Contact</div>
                                                <div>{appointmentRequest.contact_name || 'N/A'}</div>
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <div>
                                                <div className="font-semibold text-gray-700">Company</div>
                                                <div>{appointmentRequest.company_name || 'N/A'}</div>
                                            </div>
                                            <div>
                                                <div className="font-semibold text-gray-700">Requester</div>
                                                <div>{appointmentRequest.requester_name || 'N/A'}</div>
                                            </div>
                                        </>
                                    )}
                                    <div>
                                        <div className="font-semibold text-gray-700">Email</div>
                                        <div>{appointmentRequest.contact_email || appointmentRequest.requester_email || 'N/A'}</div>
                                    </div>
                                    {appointmentRequest.requester_phone && (
                                        <div>
                                            <div className="font-semibold text-gray-700">Phone</div>
                                            <div>{String(appointmentRequest.requester_phone)}</div>
                                        </div>
                                    )}
                                    <div>
                                        <div className="font-semibold text-gray-700">Requested Date</div>
                                        <div>{formatDate(appointmentRequest.requested_date)}</div>
                                    </div>
                                    <div>
                                        <div className="font-semibold text-gray-700">Requested Time</div>
                                        <div>{formatTime(appointmentRequest.requested_time)}</div>
                                    </div>
                                    <div>
                                        <div className="font-semibold text-gray-700">Duration</div>
                                        <div>{String(appointmentRequest.requested_duration)} minutes</div>
                                    </div>
                                    {appointmentRequest.preferred_technician_first_name && (
                                        <div>
                                            <div className="font-semibold text-gray-700">Preferred Technician</div>
                                            <div>{appointmentRequest.preferred_technician_first_name} {appointmentRequest.preferred_technician_last_name}</div>
                                        </div>
                                    )}
                                </div>
                                {appointmentRequest.description && (
                                    <div>
                                        <div className="font-semibold text-gray-700 mb-1">Description</div>
                                        <div className="text-sm bg-gray-50 p-3 rounded border">{String(appointmentRequest.description)}</div>
                                    </div>
                                )}
                                {appointmentRequest.declined_reason && (
                                    <div>
                                        <div className="font-semibold text-gray-700 mb-1">Decline Reason</div>
                                        <div className="text-sm bg-red-50 p-3 rounded border border-red-200">{String(appointmentRequest.declined_reason)}</div>
                                    </div>
                                )}
                                {appointmentRequest.approved_by_user_id && (
                                    <div className="border-t pt-4">
                                        <div className="font-semibold text-gray-700 mb-2">Approval Information</div>
                                        <div className="text-sm space-y-1">
                                            <div>
                                                <span className="text-gray-600">Approved by:</span>{' '}
                                                {appointmentRequest.approver_first_name} {appointmentRequest.approver_last_name}
                                            </div>
                                            {appointmentRequest.approved_at && (
                                                <div>
                                                    <span className="text-gray-600">Approved at:</span>{' '}
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
                            <div>Unsupported work item type</div>
                        </div>
                    );
            }
        } catch (error) {
            console.error('Error loading content:', error);
            return (
                <div className="h-full">
                    <div className="flex flex-col items-center justify-center h-full text-red-500">
                        <div className="text-lg mb-2">Error loading content</div>
                        <div className="text-sm">Please try again</div>
                    </div>
                </div>
            );
        }
    }, [workItem, tenant, onClose, onTaskUpdate, onScheduleUpdate, isUsersLoading, users]);

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
