'use client';

import { IProjectPhase, IProjectTask, ProjectStatus } from 'server/src/interfaces/project.interfaces';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import TaskForm from './TaskForm';

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
  onPhaseChange
}: TaskQuickAddProps): JSX.Element {
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
    />
  );
}
