'use client';

import { Suspense, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { IProjectPhase, IProjectTask, ProjectStatus } from '@alga-psa/types';
import { IUserWithRoles } from '@alga-psa/types';
import TaskFormSkeleton from '@alga-psa/ui/components/skeletons/TaskFormSkeleton';
import { getProjectTaskStatuses } from '../actions/projectActions';
import type { TaskFormPrefillData } from './TaskForm';

// Dynamic import for TaskForm
const TaskForm = dynamic(() => import('./TaskForm'), {
  loading: () => <TaskFormSkeleton isEdit={false} />,
  ssr: false
});

interface TaskQuickAddProps {
  phase: IProjectPhase;
  onClose: () => void;
  onTaskAdded: (newTask: IProjectTask | null) => void;
  onTaskUpdated: (updatedTask: IProjectTask | null) => Promise<void>;
  projectStatuses: ProjectStatus[];
  defaultStatus?: ProjectStatus;
  onCancel: () => void;
  users: IUserWithRoles[];
  task?: IProjectTask;
  onPhaseChange?: (phaseId: string) => void;
  projectTreeData?: any[]; // Add projectTreeData prop
  prefillData?: TaskFormPrefillData;
  inDrawer?: boolean;
}

export default function TaskQuickAdd({
  phase,
  onClose,
  onTaskAdded,
  onTaskUpdated,
  projectStatuses,
  defaultStatus,
  onCancel,
  users,
  task,
  onPhaseChange,
  projectTreeData,
  prefillData,
  inDrawer
}: TaskQuickAddProps): React.JSX.Element {
  const [selectedPhaseStatuses, setSelectedPhaseStatuses] = useState<ProjectStatus[]>(projectStatuses);

  useEffect(() => {
    let stale = false;

    const fetchPhaseStatuses = async () => {
      try {
        const statuses = await getProjectTaskStatuses(phase.project_id, phase.phase_id);
        if (!stale) {
          setSelectedPhaseStatuses(statuses);
        }
      } catch (error) {
        if (!stale) {
          console.error('Error fetching quick add statuses:', error);
          setSelectedPhaseStatuses(projectStatuses);
        }
      }
    };

    fetchPhaseStatuses();
    return () => { stale = true; };
  }, [phase.phase_id, phase.project_id, projectStatuses]);

  const handleSubmit = async (resultTask: IProjectTask | null) => {
    // Ensure assigned_to is null if empty string or undefined
    if (resultTask) {
      resultTask.assigned_to = resultTask.assigned_to || null;
    }
    if (task) {
      // Edit mode
      await onTaskUpdated(resultTask);
    } else {
      // Create mode
      onTaskAdded(resultTask);
    }
  };

  const handlePhaseChange = (phaseId: string) => {
    // If parent component provided onPhaseChange handler, call it
    onPhaseChange?.(phaseId);
  };

  return (
    <Suspense fallback={<TaskFormSkeleton isEdit={!!task} />}>
      <TaskForm
        task={task}
        phase={phase}
        onClose={() => {
          onClose();
          if (!task) onCancel();
        }}
        onSubmit={handleSubmit}
        projectStatuses={selectedPhaseStatuses}
        defaultStatus={defaultStatus}
        users={users}
        mode={task ? 'edit' : 'create'}
        onPhaseChange={handlePhaseChange}
        projectTreeData={projectTreeData}
        prefillData={prefillData}
        inDrawer={inDrawer}
      />
    </Suspense>
  );
}
