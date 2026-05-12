'use client';

import { useState, useEffect, Suspense, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { IProjectPhase, IProjectTask, ProjectStatus, IProjectTicketLinkWithDetails } from '@alga-psa/types';
import { IUser } from '@shared/interfaces/user.interfaces';
import { getProjectTaskStatuses } from '../actions/projectActions';
import TaskFormSkeleton from '@alga-psa/ui/components/skeletons/TaskFormSkeleton';
import { PrintButton } from '@alga-psa/ui/components/PrintButton';
import { PrintableDetailHeader, type PrintableDetailField } from '@alga-psa/ui/components/PrintableDetailHeader';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { extractTaskDescriptionText } from '../lib/taskRichText';

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
  const { t } = useTranslation('projects');
  const [selectedPhaseStatuses, setSelectedPhaseStatuses] = useState<ProjectStatus[]>(initialStatuses || []);

  // If caller didn't provide statuses (e.g., opened from user activities drawer),
  // load them from the task's phase/project so the status dropdown is populated.
  useEffect(() => {
    if (initialStatuses && initialStatuses.length > 0) return;
    if (!phase?.project_id) return;
    let cancelled = false;
    getProjectTaskStatuses(phase.project_id, phase.phase_id)
      .then((statuses) => {
        if (!cancelled) setSelectedPhaseStatuses(statuses);
      })
      .catch((error) => {
        console.error('Error loading project task statuses:', error);
      });
    return () => {
      cancelled = true;
    };
  }, [initialStatuses, phase?.project_id, phase?.phase_id]);

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

  const assignedToName = useMemo(() => {
    if (!task.assigned_to) return undefined;
    const user = users.find((u) => u.user_id === task.assigned_to);
    if (!user) return undefined;
    return [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email;
  }, [task.assigned_to, users]);

  const status = useMemo(() => {
    return selectedPhaseStatuses.find((s) => s.project_status_mapping_id === task.project_status_mapping_id);
  }, [selectedPhaseStatuses, task.project_status_mapping_id]);

  const descriptionText = useMemo(() => {
    return extractTaskDescriptionText(task.description_rich_text ?? task.description);
  }, [task.description, task.description_rich_text]);

  const printableHeader = (
    <PrintableDetailHeader
      title={task.task_name}
      subtitle={[phase?.phase_name, status?.custom_name || status?.name].filter(Boolean).join(' — ')}
      fields={[
        { label: t('projectPrint.tasks.fields.phase', { defaultValue: 'Phase' }), value: phase?.phase_name },
        { label: t('projectPrint.tasks.fields.status', { defaultValue: 'Status' }), value: status?.custom_name || status?.name },
        { label: t('projectPrint.tasks.fields.assignee', { defaultValue: 'Assignee' }), value: assignedToName },
        { label: t('projectPrint.tasks.fields.dueDate', { defaultValue: 'Due Date' }), value: task.due_date ? new Date(task.due_date).toLocaleDateString() : undefined },
        { label: t('projectPrint.tasks.fields.estimatedHours', { defaultValue: 'Estimated Hours' }), value: task.estimated_hours ? `${task.estimated_hours}h` : undefined },
        { label: t('projectPrint.tasks.fields.wbsCode', { defaultValue: 'WBS Code' }), value: task.wbs_code },
        { label: t('projectPrint.tasks.fields.description', { defaultValue: 'Description' }), value: descriptionText },
      ] satisfies PrintableDetailField[]}
    />
  );

  const printButton = (
    <PrintButton
      id={`project-task-${task.task_id}-print-button`}
      variant="outline"
      size="sm"
    />
  );

  return (
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
        printButton={printButton}
        printableHeader={printableHeader}
        printTitle={task.task_name}
      />
    </Suspense>
  );
}
