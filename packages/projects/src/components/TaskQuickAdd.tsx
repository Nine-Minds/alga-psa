'use client';

import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { IProjectPhase, IProjectTask, ProjectStatus } from 'server/src/interfaces/project.interfaces';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import TaskFormSkeleton from '@alga-psa/ui/components/skeletons/TaskFormSkeleton';

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
  projectTreeData
}: TaskQuickAddProps): React.JSX.Element {
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
        projectStatuses={projectStatuses}
        defaultStatus={defaultStatus}
        users={users}
        mode={task ? 'edit' : 'create'}
        onPhaseChange={handlePhaseChange}
        projectTreeData={projectTreeData}
      />
    </Suspense>
  );
}
