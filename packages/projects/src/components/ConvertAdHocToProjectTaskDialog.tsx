'use client';

import { useEffect, useMemo, useState } from 'react';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { SearchableSelect } from '@alga-psa/ui/components/SearchableSelect';
import type { IProject, ProjectStatus, IProjectPhase, IUserWithRoles } from '@alga-psa/types';
import { getProjects, getProjectDetails } from '../actions/projectActions';
import { mapTicketToTaskFields, TaskPrefillFields } from '../lib/taskTicketMapping';
import { useDrawer } from '@alga-psa/ui';
import TaskQuickAdd from './TaskQuickAdd';
import { useTicketIntegration, TicketIntegrationProvider } from '../context/TicketIntegrationContext';
import { handleError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from 'react-i18next';

interface ConvertAdHocToProjectTaskDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Ad-hoc fields used to prefill the new task. */
  title: string;
  description?: string;
  assignedTo?: string | null;
  /** Called after the task is successfully created. */
  onConverted: () => void | Promise<void>;
}

/**
 * Convert an ad-hoc item into a project task. Mirrors CreateTaskFromTicketDialog's
 * project → phase → status selection, but is controlled (no trigger button) and is
 * seeded from arbitrary title/description rather than a ticket (no ticket linking).
 */
export default function ConvertAdHocToProjectTaskDialog({
  isOpen,
  onClose,
  title,
  description,
  assignedTo,
  onConverted,
}: ConvertAdHocToProjectTaskDialogProps): React.JSX.Element {
  const { t } = useTranslation(['features/projects', 'common']);
  const [projects, setProjects] = useState<IProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [phases, setPhases] = useState<IProjectPhase[]>([]);
  const [statuses, setStatuses] = useState<ProjectStatus[]>([]);
  const [selectedPhaseId, setSelectedPhaseId] = useState('');
  const [selectedStatusId, setSelectedStatusId] = useState('');
  const [users, setUsers] = useState<IUserWithRoles[]>([]);
  const { openDrawer, closeDrawer } = useDrawer();
  const ticketIntegration = useTicketIntegration();

  useEffect(() => {
    if (!isOpen) return;
    setSelectedProjectId('');
    setSelectedPhaseId('');
    setSelectedStatusId('');
    const fetchProjects = async () => {
      try {
        const projectList = await getProjects();
        if (isActionPermissionError(projectList)) {
          handleError(projectList.permissionError);
          return;
        }
        setProjects(projectList);
      } catch (error) {
        console.error('Error fetching projects:', error);
        setProjects([]);
      }
    };
    fetchProjects();
  }, [isOpen]);

  useEffect(() => {
    if (!selectedProjectId) return;
    const fetchProjectDetails = async () => {
      try {
        setPhases([]);
        setStatuses([]);
        const projectDetails = await getProjectDetails(selectedProjectId);
        if (isActionPermissionError(projectDetails)) {
          handleError(projectDetails.permissionError);
          return;
        }
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
          : project.project_name,
      })),
    [projects]
  );

  const phaseOptions = useMemo(
    () => phases.map((phase) => ({ value: phase.phase_id, label: phase.phase_name })),
    [phases]
  );

  const statusOptions = useMemo(
    () =>
      statuses.map((status) => ({
        value: status.project_status_mapping_id,
        label: status.custom_name || status.name,
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

    const prefillData: TaskPrefillFields = mapTicketToTaskFields({
      title,
      description: description ?? '',
      assigned_to: assignedTo ?? null,
      due_date: undefined,
      additional_agents: undefined,
    });

    onClose();
    openDrawer(
      <TicketIntegrationProvider value={ticketIntegration}>
        <TaskQuickAdd
          inDrawer
          phase={selectedPhase}
          onClose={closeDrawer}
          onTaskAdded={(task) => {
            if (task) {
              void onConverted();
            }
            closeDrawer();
          }}
          onTaskUpdated={async () => undefined}
          projectStatuses={statuses}
          defaultStatus={defaultStatus}
          onCancel={() => undefined}
          users={users}
          projectTreeData={undefined}
          prefillData={prefillData}
        />
      </TicketIntegrationProvider>
    );
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t('dialogs.convertAdHocToTask.title', 'Convert to Project Task')}
      className="max-w-lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button id="convert-adhoc-task-cancel" variant="ghost" onClick={onClose}>
            {t('common:actions.cancel', 'Cancel')}
          </Button>
          <Button
            id="convert-adhoc-task-confirm"
            onClick={handleCreate}
            disabled={!selectedProjectId || !selectedPhaseId || !selectedStatusId}
          >
            {t('common:actions.continue', 'Continue')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('dialogs.createTaskFromTicket.projectLabel', 'Project')}
          </label>
          <SearchableSelect
            id="convert-adhoc-task-project"
            value={selectedProjectId}
            onChange={(value) => {
              setSelectedProjectId(value);
              setSelectedPhaseId('');
              setSelectedStatusId('');
            }}
            options={projectOptions}
            placeholder={t('dialogs.createTaskFromTicket.projectPlaceholder', 'Select a project')}
            dropdownMode="overlay"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('dialogs.createTaskFromTicket.phaseLabel', 'Phase')}
          </label>
          <SearchableSelect
            id="convert-adhoc-task-phase"
            value={selectedPhaseId}
            onChange={setSelectedPhaseId}
            options={phaseOptions}
            placeholder={t('dialogs.createTaskFromTicket.phasePlaceholder', 'Select a phase')}
            disabled={!selectedProjectId || phaseOptions.length === 0}
            dropdownMode="overlay"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('dialogs.createTaskFromTicket.statusLabel', 'Status')}
          </label>
          <SearchableSelect
            id="convert-adhoc-task-status"
            value={selectedStatusId}
            onChange={setSelectedStatusId}
            options={statusOptions}
            placeholder={t('dialogs.createTaskFromTicket.statusPlaceholder', 'Select a status')}
            disabled={!selectedProjectId || statusOptions.length === 0}
            dropdownMode="overlay"
          />
        </div>
      </div>
    </Dialog>
  );
}
