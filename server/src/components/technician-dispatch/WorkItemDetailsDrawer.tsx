'use client'

import React from 'react';
import { IExtendedWorkItem } from '@/interfaces/workItem.interfaces';
import { IProjectTask } from '@/interfaces/project.interfaces';
import { IScheduleEntry } from '@/interfaces/schedule.interfaces';
import { getTicketById } from '@/lib/actions/ticket-actions/ticketActions';
import { getTaskWithDetails } from '@/lib/actions/project-actions/projectTaskActions';
import { getWorkItemById } from '@/lib/actions/workItemActions';
import { getCurrentUser, getAllUsers } from '@/lib/actions/user-actions/userActions';
import { getScheduleEntries } from '@/lib/actions/scheduleActions';
import { toast } from 'react-hot-toast';
import TicketDetails from '@/components/tickets/TicketDetails';
import TaskEdit from '@/components/projects/TaskEdit';
import EntryPopup from '@/components/schedule/EntryPopup';
import { useTenant } from '@/components/TenantProvider';

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
}: WorkItemDetailsDrawerProps): JSX.Element {
    const tenant = useTenant();
    if (!tenant) {
        throw new Error('tenant is not defined');
    }

    const [content, setContent] = React.useState<JSX.Element | null>(null);
    const [isLoading, setIsLoading] = React.useState(true);
    const [users, setUsers] = React.useState<any[]>([]);
    const [isUsersLoading, setIsUsersLoading] = React.useState(true);

    React.useEffect(() => {
        const loadUsers = async () => {
            console.log('Starting to load users...');
            try {
                setIsUsersLoading(true);
                const allUsers = await getAllUsers();
                console.log('Users loaded:', allUsers?.length ?? 0);
                if (!allUsers || allUsers.length === 0) {
                    console.warn('No users returned from getAllUsers');
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
                    const ticketData = await getTicketById(workItem.work_item_id, currentUser);
                    return (
                        <div className="h-full">
                            <TicketDetails 
                                initialTicket={ticketData}
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
                            />
                            )}
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
