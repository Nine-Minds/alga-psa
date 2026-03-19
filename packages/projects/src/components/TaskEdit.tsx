'use client';

import { useState, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { IProjectPhase, IProjectTask, ProjectStatus, IProjectTicketLinkWithDetails } from '@alga-psa/types';
import { IUser } from '@shared/interfaces/user.interfaces';
import { getProjectTaskStatuses } from '../actions/projectActions';
import TaskFormSkeleton from '@alga-psa/ui/components/skeletons/TaskFormSkeleton';

// Dynamic import for TaskForm
const TaskForm = dynamic(() => import('./TaskForm'), {
  loading: () => <TaskFormSkeleton isEdit={true} />,
  ssr: false
});

interface TaskEditProps {
  task: IProjectTask;
  phase: IProjectPhase;
  phases?: IProjectPhase[];
  onClose: () => void;
  onTaskUpdated: (updatedTask: IProjectTask | null) => void;
  projectStatuses?: ProjectStatus[];
  users: IUser[];
  inDrawer?: boolean;
  projectTreeData?: any[]; // Add projectTreeData prop
  onCommentCountChange?: (taskId: string, count: number) => void;
}

export default function TaskEdit({
  task,
  phase,
  onClose,
  onTaskUpdated,
  phases,
  projectStatuses: initialStatuses,
  users,
  inDrawer = false,
  projectTreeData = [],
  onCommentCountChange
}: TaskEditProps): React.JSX.Element {
  const [selectedPhaseStatuses, setSelectedPhaseStatuses] = useState<ProjectStatus[]>(initialStatuses || []);

  const handlePhaseChange = async (newPhaseId: string) => {
    if (!phases) return;
    
    const newPhase = phases.find(p => p.phase_id === newPhaseId);
    if (newPhase) {
      try {
        const newProjectStatuses = await getProjectTaskStatuses(newPhase.project_id, newPhase.phase_id);
        setSelectedPhaseStatuses(newProjectStatuses);
      } catch (error) {
        console.error('Error fetching new project statuses:', error);
      }
    }
  };

  return (
    <div className="h-full">
      <Suspense fallback={<TaskFormSkeleton isEdit={true} />}>
        <TaskForm
          task={task}
          phase={phase}
          phases={phases}
          onClose={onClose}
          onSubmit={onTaskUpdated}
          projectStatuses={selectedPhaseStatuses}
          defaultStatus={selectedPhaseStatuses.find(s => s.project_status_mapping_id === task.project_status_mapping_id)}
          users={users}
          mode="edit"
          onPhaseChange={handlePhaseChange}
          inDrawer={inDrawer}
          projectTreeData={projectTreeData}
          onCommentCountChange={onCommentCountChange}
        />
      </Suspense>
    </div>
  );
}
