'use client'

import React from 'react';
import { IExtendedWorkItem } from 'server/src/interfaces/workItem.interfaces';
import { getConsolidatedTicketData } from 'server/src/lib/actions/ticket-actions/optimizedTicketActions';
import { getTaskWithDetails } from 'server/src/lib/actions/project-actions/projectTaskActions';
import { getWorkItemById } from 'server/src/lib/actions/workItemActions';
import { getCurrentUser, getAllUsersBasic } from 'server/src/lib/actions/user-actions/userActions';
import { toast } from 'react-hot-toast';
import TicketDetails from 'server/src/components/tickets/ticket/TicketDetails';
import TaskEdit from 'server/src/components/projects/TaskEdit';
import EntryPopup from 'server/src/components/schedule/EntryPopup';
import { useTenant } from 'server/src/components/TenantProvider';
import Spinner from 'server/src/components/ui/Spinner';
import InteractionDetails from 'server/src/components/interactions/InteractionDetails';
import { getInteractionById } from 'server/src/lib/actions/interactionActions';

interface WorkItemDrawerProps {
    workItem: IExtendedWorkItem;
    onClose: () => void;
    onTaskUpdate: (updated: any) => Promise<void>;
    onScheduleUpdate: (updated: any) => Promise<void>;
}

interface ScheduleUpdateData {
    entry_id: string;
    title: string;
    notes: string;
    scheduled_start: Date;
    scheduled_end: Date;
    assigned_user_ids: string[];
    status: string;
}

// Separate component for Interaction drawer content
function InteractionDrawerContent({ workItemId }: { workItemId: string }) {
    const [interaction, setInteraction] = React.useState<any>(null);
    const [loading, setLoading] = React.useState(true);

    React.useEffect(() => {
        const fetchInteraction = async () => {
            try {
                const interactionData = await getInteractionById(workItemId);
                setInteraction(interactionData);
            } catch (error) {
                console.error('Error fetching interaction:', error);
                toast.error('Failed to load interaction details');
            } finally {
                setLoading(false);
            }
        };
        fetchInteraction();
    }, [workItemId]);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Spinner />
            </div>
        );
    }

    if (!interaction) {
        return (
            <div className="min-w-auto h-full bg-white p-6">
                <p className="text-gray-500">Interaction not found</p>
            </div>
        );
    }

    return (
        <InteractionDetails 
            interaction={interaction} 
            isInDrawer={true}
            onInteractionUpdated={async (updated) => {
                setInteraction(updated);
            }}
        />
    );
}

export function WorkItemDrawer({
    workItem,
    onClose,
    onTaskUpdate,
    onScheduleUpdate
}: WorkItemDrawerProps): JSX.Element {
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
                        <div className="min-w-auto h-full bg-white">
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
                        <div className="min-w-auto h-full bg-white">
                            {users.length === 0 ? (
                                <div className="flex items-center justify-center h-full text-gray-500">
                                    No users available
                                </div>
                            ) : (
                                <TaskEdit
                                    task={taskData}
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

                    return (
                        <div className="min-w-auto h-full bg-white">
                            <EntryPopup
                                canAssignMultipleAgents={false}
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
                                    assigned_user_ids: workItem.users && workItem.users.length > 0
                                        ? workItem.users.map(u => u.user_id)
                                        : [currentUser?.user_id].filter(Boolean),
                                    created_at: new Date(),
                                    updated_at: new Date()
                                }}
                                onClose={onClose}
                                onSave={onScheduleUpdate}
                                isInDrawer={true}
                                canModifySchedule={true}
                                focusedTechnicianId={currentUser.user_id}
                                canAssignOthers={false}
                            />
                        </div>
                    );
                }

                case 'interaction':
                    return <InteractionDrawerContent workItemId={workItem.work_item_id} />;

                default:
                    return (
                        <div className="min-w-auto h-full bg-white p-4">
                            <div>Unsupported work item type</div>
                        </div>
                    );
            }
        } catch (error) {
            console.error('Error loading content:', error);
            return (
                <div className="min-w-auto h-full bg-white p-4">
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
            // For project tasks, wait for users to load before loading content
            if (workItem.type === 'project_task' && isUsersLoading) {
                return;
            }
            const loadedContent = await loadContent();
            setContent(loadedContent);
            setIsLoading(false);
        };
        init();
    }, [loadContent, workItem.type, isUsersLoading]); 

    return (
        <div className="min-w-auto h-full bg-white">
            {isLoading ? (
                <div className="flex items-center justify-center h-full">
                    <Spinner size="sm" />
                </div>
            ) : content}
        </div>
    );
}
