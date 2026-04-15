'use client';

import { useState, useEffect, useCallback } from 'react';
import { ClipboardList, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Popover, PopoverTrigger, PopoverContent } from '@alga-psa/ui/components/Popover';
import { useDrawer } from '@alga-psa/ui';
import { toast } from 'react-hot-toast';
import { handleError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from 'react-i18next';
import type { ITicketLinkedTask } from '@alga-psa/types';
import { getLinkedTasksForTicketAction, getTaskWithDetails } from '../actions/projectTaskActions';
import { getProjectDetails } from '../actions/projectActions';
import TaskEdit from './TaskEdit';

interface TicketLinkedTasksBadgeProps {
  ticketId: string;
}

export default function TicketLinkedTasksBadge({
  ticketId,
}: TicketLinkedTasksBadgeProps): React.JSX.Element | null {
  const { t } = useTranslation(['features/projects', 'common']);
  const [linkedTasks, setLinkedTasks] = useState<ITicketLinkedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [openingTaskId, setOpeningTaskId] = useState<string | null>(null);
  const { openDrawer, closeDrawer } = useDrawer();

  useEffect(() => {
    let mounted = true;
    const fetchLinkedTasks = async () => {
      try {
        const tasks = await getLinkedTasksForTicketAction(ticketId);
        if (mounted) {
          setLinkedTasks(tasks || []);
        }
      } catch (error) {
        console.error('Error fetching linked tasks:', error);
        if (mounted) {
          setLinkedTasks([]);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };
    fetchLinkedTasks();
    return () => { mounted = false; };
  }, [ticketId]);

  const handleOpenTask = useCallback(async (task: ITicketLinkedTask) => {
    setOpeningTaskId(task.task_id);
    try {
      const [taskDetails, projectDetailsResult] = await Promise.all([
        getTaskWithDetails(task.task_id),
        getProjectDetails(task.project_id),
      ]);

      if (!taskDetails) {
        toast.error(t('dialogs.ticketLinkedTasks.loadFailed', 'Failed to load task'));
        return;
      }

      if (isActionPermissionError(projectDetailsResult)) {
        handleError(projectDetailsResult.permissionError);
        return;
      }

      const projectDetails = projectDetailsResult;

      const phase = projectDetails.phases?.find(
        (p: { phase_id: string }) => p.phase_id === task.phase_id
      );
      if (!phase) {
        toast.error(t('dialogs.ticketLinkedTasks.phaseNotFound', 'Task phase not found'));
        return;
      }

      const statuses = projectDetails.statuses || [];
      const users = projectDetails.users || [];

      openDrawer(
        <TaskEdit
          task={taskDetails}
          phase={phase}
          phases={projectDetails.phases}
          onClose={closeDrawer}
          onTaskUpdated={() => {
            closeDrawer();
          }}
          projectStatuses={statuses}
          users={users}
          inDrawer
        />
      );
    } catch (error) {
      handleError(error, t('dialogs.ticketLinkedTasks.openFailed', 'Failed to open task'));
    } finally {
      setOpeningTaskId(null);
    }
  }, [openDrawer, closeDrawer]);

  if (loading) {
    return null;
  }

  if (linkedTasks.length === 0) {
    return null;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          id="ticket-linked-tasks-badge"
          type="button"
          variant="soft"
          className="flex items-center"
        >
          <ClipboardList className="h-4 w-4 mr-1" />
          {linkedTasks.length} {linkedTasks.length === 1 ? t('dialogs.ticketLinkedTasks.task', 'Task') : t('dialogs.ticketLinkedTasks.tasks', 'Tasks')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="px-3 py-2 border-b border-[rgb(var(--color-border-200))]">
          <h4 className="text-sm font-medium">{t('dialogs.ticketLinkedTasks.title', 'Linked Project Tasks')}</h4>
        </div>
        <div className="max-h-60 overflow-y-auto">
          {linkedTasks.map((task) => (
            <button
              key={task.link_id}
              type="button"
              className="w-full text-left px-3 py-2 hover:bg-[rgb(var(--color-border-100))] flex items-center justify-between gap-2 border-b border-[rgb(var(--color-border-100))] last:border-b-0"
              onClick={() => handleOpenTask(task)}
              disabled={openingTaskId === task.task_id}
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{task.task_name}</div>
                <div className="text-xs text-[rgb(var(--color-text-400))] truncate">
                  {task.project_name} &middot; {task.phase_name}
                </div>
                {task.status_name && (
                  <span className="text-xs text-[rgb(var(--color-text-400))]">
                    {task.status_name}
                  </span>
                )}
              </div>
              <div className="flex-shrink-0">
                {openingTaskId === task.task_id ? (
                  <Loader2 className="h-4 w-4 animate-spin text-[rgb(var(--color-text-400))]" />
                ) : (
                  <ExternalLink className="h-4 w-4 text-[rgb(var(--color-text-400))]" />
                )}
              </div>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
