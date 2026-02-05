'use client';

import { useEffect, useMemo, useState } from 'react';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { SearchableSelect } from '@alga-psa/ui/components/SearchableSelect';
import { ListTodo } from 'lucide-react';
import type { IProject, ProjectStatus } from '@alga-psa/types';
import { getProjects, getProjectDetails } from '../actions/projectActions';
import type { IProjectPhase } from '@alga-psa/types';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { mapTicketToTaskFields, TaskPrefillFields } from '../lib/taskTicketMapping';
import { useDrawer } from '@alga-psa/ui';
import TaskQuickAdd from './TaskQuickAdd';
import { IUserWithRoles } from '@alga-psa/types';
import { useTicketIntegration, TicketIntegrationProvider } from '../context/TicketIntegrationContext';

interface CreateTaskFromTicketDialogProps {
  ticket: {
    ticket_id: string;
    ticket_number: string;
    title: string;
    description?: string | null;
    attributes?: Record<string, unknown> | null;
    assigned_to?: string | null;
    due_date?: string | null;
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
  const [users, setUsers] = useState<IUserWithRoles[]>([]);
  const { openDrawer, closeDrawer } = useDrawer();
  const ticketIntegration = useTicketIntegration();

  useEffect(() => {
    if (!open) return;
    setShouldLink(true);
    const fetchProjects = async () => {
      try {
        const projectList = await getProjects();
        if (ticket.client_id) {
          // Sort client-matching projects first
          const sorted = [...projectList].sort((a, b) => {
            const aMatch = a.client_id === ticket.client_id ? 0 : 1;
            const bMatch = b.client_id === ticket.client_id ? 0 : 1;
            return aMatch - bMatch;
          });
          setProjects(sorted);
        } else {
          setProjects(projectList);
        }
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
        setPhases([]);
        setStatuses([]);
        const projectDetails = await getProjectDetails(selectedProjectId);
        setPhases(projectDetails.phases || []);
        setStatuses(projectDetails.statuses || []);
        setUsers(projectDetails.users || []);
      } catch (error) {
        console.error('Error fetching project phases/statuses:', error);
        setPhases([]);
        setStatuses([]);
        setUsers([]);
      }
    };
    fetchProjectDetails();
  }, [selectedProjectId]);

  const projectOptions = useMemo(
    () =>
      projects.map((project) => ({
        value: project.project_id,
        label: project.client_name
          ? `${project.project_name} (${project.client_name})`
          : project.project_name
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

    const selectedPhase = phases.find((phase) => phase.phase_id === selectedPhaseId);
    if (!selectedPhase) return;

    const defaultStatus = statuses.find(
      (status) => status.project_status_mapping_id === selectedStatusId
    );

    const resolvedDescription =
      ticket.description ??
      (typeof ticket.attributes?.description === 'string' ? ticket.attributes.description : '');

    const prefillData: TaskPrefillFields = mapTicketToTaskFields({
      title: ticket.title,
      description: resolvedDescription,
      assigned_to: ticket.assigned_to ?? null,
      due_date: ticket.due_date ?? undefined
    });

    openDrawer(
      <TicketIntegrationProvider value={ticketIntegration}>
        <TaskQuickAdd
          inDrawer
          phase={selectedPhase}
          onClose={closeDrawer}
          onTaskAdded={() => null}
          onTaskUpdated={async () => undefined}
          projectStatuses={statuses}
          defaultStatus={defaultStatus}
          onCancel={() => undefined}
          users={users}
          projectTreeData={undefined}
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
                  status_name: defaultStatus?.custom_name || defaultStatus?.name || 'New',
                  is_closed: false
                }
              : undefined
          }}
        />
      </TicketIntegrationProvider>
    );
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

      <Dialog isOpen={open} onClose={() => setOpen(false)} title="Create Task from Ticket" className="max-w-lg">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Project
            </label>
            <SearchableSelect
              id="create-task-project"
              value={selectedProjectId}
              onChange={(value) => {
                setSelectedProjectId(value);
                setSelectedPhaseId('');
                setSelectedStatusId('');
              }}
              options={projectOptions}
              placeholder="Select a project"
              dropdownMode="overlay"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Phase
            </label>
            <SearchableSelect
              id="create-task-phase"
              value={selectedPhaseId}
              onChange={setSelectedPhaseId}
              options={phaseOptions}
              placeholder="Select a phase"
              disabled={!selectedProjectId || phaseOptions.length === 0}
              dropdownMode="overlay"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Status
            </label>
            <SearchableSelect
              id="create-task-status"
              value={selectedStatusId}
              onChange={setSelectedStatusId}
              options={statusOptions}
              placeholder="Select a status"
              disabled={!selectedProjectId || statusOptions.length === 0}
              dropdownMode="overlay"
            />
          </div>

          <Checkbox
            id="create-task-link-ticket"
            checked={shouldLink}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setShouldLink(e.target.checked)}
            label="Link ticket to the created task"
            containerClassName="mb-0"
          />
        </div>
        <div className="mt-6 flex justify-end gap-2">
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
      </Dialog>
    </>
  );
}
