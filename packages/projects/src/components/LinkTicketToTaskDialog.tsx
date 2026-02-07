'use client';

import { useEffect, useMemo, useState } from 'react';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { SearchableSelect } from '@alga-psa/ui/components/SearchableSelect';
import { Link } from 'lucide-react';
import type { IProject, IProjectPhase, IProjectTask } from '@alga-psa/types';
import { getProjects, getProjectDetails } from '../actions/projectActions';
import { addTicketLinkAction } from '../actions/projectTaskActions';
import { toast } from 'react-hot-toast';

interface LinkTicketToTaskDialogProps {
  ticket: {
    ticket_id: string;
    ticket_number: string;
    title: string;
    client_id?: string | null;
  };
}

export default function LinkTicketToTaskDialog({
  ticket
}: LinkTicketToTaskDialogProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<IProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [phases, setPhases] = useState<IProjectPhase[]>([]);
  const [tasks, setTasks] = useState<IProjectTask[]>([]);
  const [selectedPhaseId, setSelectedPhaseId] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [isLinking, setIsLinking] = useState(false);

  useEffect(() => {
    if (!open) return;
    const fetchProjects = async () => {
      try {
        const projectList = await getProjects();
        if (ticket.client_id) {
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
        setTasks([]);
        const projectDetails = await getProjectDetails(selectedProjectId);
        setPhases(projectDetails.phases || []);
        setTasks(projectDetails.tasks || []);
      } catch (error) {
        console.error('Error fetching project details:', error);
        setPhases([]);
        setTasks([]);
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

  const filteredTasks = useMemo(
    () =>
      selectedPhaseId
        ? tasks.filter((task) => task.phase_id === selectedPhaseId)
        : tasks,
    [tasks, selectedPhaseId]
  );

  const taskOptions = useMemo(
    () =>
      filteredTasks.map((task) => ({
        value: task.task_id,
        label: task.task_name
      })),
    [filteredTasks]
  );

  const handleLink = async () => {
    if (!selectedProjectId || !selectedTaskId) return;
    setIsLinking(true);
    try {
      const task = tasks.find((t) => t.task_id === selectedTaskId);
      const phaseId = task?.phase_id || selectedPhaseId;
      await addTicketLinkAction(selectedProjectId, selectedTaskId, ticket.ticket_id, phaseId);
      toast.success('Ticket linked to task successfully');
      setOpen(false);
      setSelectedProjectId('');
      setSelectedPhaseId('');
      setSelectedTaskId('');
    } catch (error) {
      console.error('Error linking ticket to task:', error);
      toast.error('Failed to link ticket to task');
    } finally {
      setIsLinking(false);
    }
  };

  return (
    <>
      <Button
        id="link-ticket-to-task-button"
        type="button"
        variant="soft"
        onClick={() => setOpen(true)}
        className="flex items-center"
      >
        <Link className="h-4 w-4 mr-1" />
        Link to Task
      </Button>

      <Dialog isOpen={open} onClose={() => setOpen(false)} title="Link Ticket to Task" className="max-w-lg">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Project
            </label>
            <SearchableSelect
              id="link-task-project"
              value={selectedProjectId}
              onChange={(value) => {
                setSelectedProjectId(value);
                setSelectedPhaseId('');
                setSelectedTaskId('');
              }}
              options={projectOptions}
              placeholder="Select a project"
              dropdownMode="overlay"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Phase (optional filter)
            </label>
            <SearchableSelect
              id="link-task-phase"
              value={selectedPhaseId}
              onChange={(value) => {
                setSelectedPhaseId(value);
                setSelectedTaskId('');
              }}
              options={phaseOptions}
              placeholder="All phases"
              disabled={!selectedProjectId || phaseOptions.length === 0}
              dropdownMode="overlay"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Task
            </label>
            <SearchableSelect
              id="link-task-select"
              value={selectedTaskId}
              onChange={setSelectedTaskId}
              options={taskOptions}
              placeholder="Select a task"
              disabled={!selectedProjectId || taskOptions.length === 0}
              dropdownMode="overlay"
            />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button id="link-task-cancel" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            id="link-task-confirm"
            onClick={handleLink}
            disabled={!selectedProjectId || !selectedTaskId || isLinking}
          >
            {isLinking ? 'Linking...' : 'Link'}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
