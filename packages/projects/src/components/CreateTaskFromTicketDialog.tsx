'use client';

import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { ListTodo } from 'lucide-react';
import type { IProject, ProjectStatus } from '@alga-psa/types';
import { getProjects, getProjectTreeData, getProjectTaskStatuses } from '../actions/projectActions';
import type { IProjectPhase } from '@alga-psa/types';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { mapTicketToTaskFields, TaskPrefillFields } from '../lib/taskTicketMapping';
import { useDrawer } from '@alga-psa/ui';
import TaskQuickAdd from './TaskQuickAdd';

interface CreateTaskFromTicketDialogProps {
  ticket: {
    ticket_id: string;
    ticket_number: string;
    title: string;
    description?: string | null;
    assigned_to?: string | null;
    due_date?: string | null;
    estimated_hours?: number | null;
    client_id?: string | null;
  };
}

export default function CreateTaskFromTicketDialog({
  ticket
}: CreateTaskFromTicketDialogProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<IProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [phases, setPhases] = useState<IProjectPhase[]>([]);
  const [statuses, setStatuses] = useState<ProjectStatus[]>([]);
  const [selectedPhaseId, setSelectedPhaseId] = useState('');
  const [selectedStatusId, setSelectedStatusId] = useState('');
  const [shouldLink, setShouldLink] = useState(true);
  const { openDrawer } = useDrawer();

  useEffect(() => {
    if (!open) return;
    const fetchProjects = async () => {
      try {
        const projectList = await getProjects();
        setProjects(projectList);
      } catch (error) {
        console.error('Error fetching projects:', error);
        setProjects([]);
      }
    };
    fetchProjects();
  }, [open]);

  useEffect(() => {
    if (!selectedProjectId) return;
    const fetchProjectDetails = async () => {
      try {
        const [treeData, projectStatuses] = await Promise.all([
          getProjectTreeData(selectedProjectId),
          getProjectTaskStatuses(selectedProjectId)
        ]);
        const projectNode = treeData?.[0];
        const phaseNodes = projectNode?.children ?? [];
        setPhases(
          phaseNodes.map((phase) => ({
            phase_id: phase.value,
            phase_name: phase.label,
            project_id: selectedProjectId,
            tenant: ''
          }))
        );
        setStatuses(projectStatuses || []);
      } catch (error) {
        console.error('Error fetching project phases/statuses:', error);
        setPhases([]);
        setStatuses([]);
      }
    };
    fetchProjectDetails();
  }, [selectedProjectId]);

  const projectOptions = useMemo(
    () =>
      projects.map((project) => ({
        value: project.project_id,
        label: project.project_name
      })),
    [projects]
  );

  const phaseOptions = useMemo(
    () =>
      phases.map((phase) => ({
        value: phase.phase_id,
        label: phase.phase_name
      })),
    [phases]
  );

  const statusOptions = useMemo(
    () =>
      statuses.map((status) => ({
        value: status.project_status_mapping_id,
        label: status.custom_name || status.name
      })),
    [statuses]
  );

  const handleCreate = () => {
    if (!selectedProjectId || !selectedPhaseId || !selectedStatusId) return;

    const prefillData: TaskPrefillFields = mapTicketToTaskFields({
      title: ticket.title,
      description: ticket.description ?? '',
      assigned_to: ticket.assigned_to ?? null,
      due_date: ticket.due_date ?? undefined,
      estimated_hours: ticket.estimated_hours ?? 0
    });

    openDrawer({
      title: 'Create Task',
      content: (
        <TaskQuickAdd
          projectId={selectedProjectId}
          phaseId={selectedPhaseId}
          statusId={selectedStatusId}
          prefillData={{
            ...prefillData,
            pendingTicketLink: shouldLink
              ? {
                  link_id: `temp-${Date.now()}`,
                  task_id: 'temp',
                  ticket_id: ticket.ticket_id,
                  ticket_number: ticket.ticket_number,
                  title: ticket.title,
                  created_at: new Date(),
                  project_id: selectedProjectId,
                  phase_id: selectedPhaseId,
                  status_name: 'New',
                  is_closed: false
                }
              : undefined
          }}
          onClose={() => setOpen(false)}
        />
      )
    });
    setOpen(false);
  };

  return (
    <>
      <Button
        id="create-task-from-ticket-button"
        type="button"
        variant="soft"
        onClick={() => setOpen(true)}
        className="flex items-center"
      >
        <ListTodo className="h-4 w-4 mr-1" />
        Create Task
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Project
              </label>
              <CustomSelect
                id="create-task-project"
                value={selectedProjectId}
                onValueChange={(value) => {
                  setSelectedProjectId(value);
                  setSelectedPhaseId('');
                  setSelectedStatusId('');
                }}
                options={projectOptions}
                placeholder="Select a project"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Phase
              </label>
              <CustomSelect
                id="create-task-phase"
                value={selectedPhaseId}
                onValueChange={setSelectedPhaseId}
                options={phaseOptions}
                placeholder="Select a phase"
                disabled={!selectedProjectId}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Status
              </label>
              <CustomSelect
                id="create-task-status"
                value={selectedStatusId}
                onValueChange={setSelectedStatusId}
                options={statusOptions}
                placeholder="Select a status"
                disabled={!selectedProjectId}
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <Checkbox
                id="create-task-link-ticket"
                checked={shouldLink}
                onCheckedChange={(value) => setShouldLink(Boolean(value))}
              />
              Link ticket to the created task
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <Button id="create-task-cancel" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                id="create-task-confirm"
                onClick={handleCreate}
                disabled={!selectedProjectId || !selectedPhaseId || !selectedStatusId}
              >
                Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
