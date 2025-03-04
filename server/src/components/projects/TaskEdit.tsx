'use client';

import { useEffect, useState } from 'react';
import { IProjectPhase, IProjectTask, ProjectStatus, IProjectTicketLinkWithDetails } from 'server/src/interfaces/project.interfaces';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { getProjectTaskStatuses } from 'server/src/lib/actions/project-actions/projectActions';
import TaskForm from './TaskForm';

interface TaskEditProps {
  task: IProjectTask;
  phase: IProjectPhase;
  phases?: IProjectPhase[];
  onClose: () => void;
  onTaskUpdated: (updatedTask: IProjectTask | null) => void;
  projectStatuses?: ProjectStatus[];
  users: IUserWithRoles[];
  inDrawer?: boolean;
}

export default function TaskEdit({ 
  task, 
  phase,
  onClose, 
  onTaskUpdated,
  phases,
  projectStatuses: initialStatuses,
  users,
  inDrawer = false
}: TaskEditProps): JSX.Element {
  const [statuses, setStatuses] = useState<ProjectStatus[]>(initialStatuses || []);
  const [selectedPhaseStatuses, setSelectedPhaseStatuses] = useState<ProjectStatus[]>(initialStatuses || []);

  useEffect(() => {
    const fetchData = async () => {
      try {
        if (!initialStatuses) {
          const projectStatuses = await getProjectTaskStatuses(phase.project_id);
          setStatuses(projectStatuses);
          setSelectedPhaseStatuses(projectStatuses);
        }
      } catch (error) {
        console.error('Error fetching task details:', error);
      }
    };
    fetchData();
  }, [phase.project_id, initialStatuses]);

  const handlePhaseChange = async (newPhaseId: string) => {
    if (!phases) return;
    
    const newPhase = phases.find(p => p.phase_id === newPhaseId);
    if (newPhase && newPhase.project_id !== phase.project_id) {
      // If moving to a different project, fetch its statuses
      try {
        const newProjectStatuses = await getProjectTaskStatuses(newPhase.project_id);
        setSelectedPhaseStatuses(newProjectStatuses);
      } catch (error) {
        console.error('Error fetching new project statuses:', error);
      }
    } else {
      // If moving within the same project, use current statuses
      setSelectedPhaseStatuses(statuses);
    }
  };

  return (
    <div className="h-full">
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
      />
    </div>
  );
}
