'use client'

import React from 'react';
import { IExtendedWorkItem, IInteraction, IScheduleEntry } from '@alga-psa/types';
import { getWorkItemById } from '@alga-psa/scheduling/actions';
import { getCurrentUser, getAllUsersBasic } from '@alga-psa/user-composition/actions';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import EntryPopup from '../../../schedule/EntryPopup';
import Spinner from '@alga-psa/ui/components/Spinner';
import { useSchedulingCrossFeature } from '../../../../context/SchedulingCrossFeatureContext';

interface WorkItemDrawerProps {
    workItem: IExtendedWorkItem;
    onClose: () => void;
    onTaskUpdate: (updated: unknown) => Promise<void>;
    onScheduleUpdate: (updated: ScheduleUpdateData) => Promise<void>;
}

type ScheduleUpdateData = Omit<IScheduleEntry, 'tenant'> & { updateType?: string };

function LoadingState(): React.JSX.Element {
    return (
        <div className="flex items-center justify-center h-full">
            <Spinner size="sm" />
        </div>
    );
}

function EmptyState({ message }: { message: string }): React.JSX.Element {
    return (
        <div className="min-w-auto h-full bg-white p-6">
            <p className="text-gray-500">{message}</p>
        </div>
    );
}

function ErrorState(): React.JSX.Element {
    return (
        <div className="min-w-auto h-full bg-white p-4">
            <div className="flex flex-col items-center justify-center h-full text-red-500">
                <div className="text-lg mb-2">Error loading content</div>
                <div className="text-sm">Please try again</div>
            </div>
        </div>
    );
}

function InteractionDrawerContent({ workItemId }: { workItemId: string }) {
    const { getInteractionById, renderInteractionDetails } = useSchedulingCrossFeature();
    const [interaction, setInteraction] = React.useState<IInteraction | null>(null);
    const [loading, setLoading] = React.useState(true);

    React.useEffect(() => {
        let isMounted = true;

        const fetchInteraction = async () => {
            try {
                const interactionData = await getInteractionById(workItemId);
                if (isMounted) {
                    setInteraction(interactionData);
                }
            } catch (error) {
                handleError(error, 'Failed to load interaction details');
            } finally {
                if (isMounted) {
                    setLoading(false);
                }
            }
        };

        fetchInteraction();
        return () => {
            isMounted = false;
        };
    }, [workItemId, getInteractionById]);

    if (loading) {
        return <LoadingState />;
    }

    if (!interaction) {
        return <EmptyState message="Interaction not found" />;
    }

    return <>{renderInteractionDetails({ interaction, isInDrawer: true })}</>;
}

export function WorkItemDrawer({
    workItem,
    onClose,
    onTaskUpdate,
    onScheduleUpdate
}: WorkItemDrawerProps): React.JSX.Element {
    const {
        getConsolidatedTicketData,
        getTaskById,
        getProjectPhase,
        getProjectMetadata,
        getProjectTreeData,
        renderTicketDetails,
        renderTaskEdit,
    } = useSchedulingCrossFeature();

    const [content, setContent] = React.useState<React.JSX.Element | null>(null);
    const [isLoading, setIsLoading] = React.useState(true);

    const loadContent = React.useCallback(async () => {
        try {
            switch (workItem.type) {
                case 'ticket': {
                    const [currentUser, ticketData] = await Promise.all([
                        getCurrentUser(),
                        getConsolidatedTicketData(workItem.work_item_id)
                    ]);

                    if (!currentUser) {
                        toast.error('No user session found');
                        return null;
                    }

                    if (!ticketData) {
                        toast.error('Failed to load ticket');
                        return null;
                    }

                    return (
                        <div className="min-w-auto h-full bg-white">
                            {renderTicketDetails({
                                isInDrawer: true,
                                consolidatedData: ticketData,
                                currentUser,
                            })}
                        </div>
                    );
                }

                case 'project_task': {
                    const taskData = await getTaskById(workItem.work_item_id);
                    if (!taskData) {
                        toast.error('Failed to load task');
                        return null;
                    }

                    const phase = await getProjectPhase(taskData.phase_id);
                    if (!phase) {
                        toast.error('Failed to load task phase');
                        return null;
                    }

                    const [projectMetadata, projectTreeData] = await Promise.all([
                        getProjectMetadata(phase.project_id),
                        getProjectTreeData(phase.project_id)
                    ]);

                    if (!projectMetadata || !('phases' in projectMetadata) || !('users' in projectMetadata)) {
                        toast.error('Failed to load task project metadata');
                        return null;
                    }

                    return (
                        <div className="min-w-auto h-full bg-white">
                            {renderTaskEdit({
                                task: taskData,
                                phase,
                                phases: projectMetadata.phases,
                                users: projectMetadata.users,
                                inDrawer: true,
                                onClose,
                                onTaskUpdated: onTaskUpdate,
                                projectTreeData: Array.isArray(projectTreeData) ? projectTreeData : [],
                            })}
                        </div>
                    );
                }

                case 'ad_hoc': {
                    const [currentUser, users, adHocData] = await Promise.all([
                        getCurrentUser(),
                        getAllUsersBasic(),
                        getWorkItemById(workItem.work_item_id, 'ad_hoc')
                    ]);

                    if (!currentUser) {
                        toast.error('No user session found');
                        return null;
                    }

                    if (!adHocData) {
                        toast.error('Failed to load ad-hoc entry data');
                        return null;
                    }

                    return (
                        <div className="min-w-auto h-full bg-white">
                            <EntryPopup
                                canAssignMultipleAgents={false}
                                users={users || []}
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
                                        : [currentUser.user_id],
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
                    return (
                        <div className="min-w-auto h-full bg-white">
                            <InteractionDrawerContent workItemId={workItem.work_item_id} />
                        </div>
                    );

                default:
                    return (
                        <div className="min-w-auto h-full bg-white p-4">
                            <div>Unsupported work item type</div>
                        </div>
                    );
            }
        } catch (error) {
            console.error('Error loading content:', error);
            return <ErrorState />;
        }
    }, [
        workItem, onClose, onTaskUpdate, onScheduleUpdate,
        getConsolidatedTicketData, getTaskById, getProjectPhase,
        getProjectMetadata, getProjectTreeData, renderTicketDetails, renderTaskEdit
    ]);

    React.useEffect(() => {
        let isMounted = true;

        const init = async () => {
            setIsLoading(true);
            const loadedContent = await loadContent();
            if (isMounted) {
                setContent(loadedContent);
                setIsLoading(false);
            }
        };

        init();
        return () => {
            isMounted = false;
        };
    }, [loadContent]);

    return (
        <div className="min-w-auto h-full bg-white">
            {isLoading ? <LoadingState /> : content}
        </div>
    );
}
