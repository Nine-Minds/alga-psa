'use client';

import React, { useState, useEffect } from 'react';
import { IProjectPhase, IProjectTask, ITaskChecklistItem, IProjectTicketLinkWithDetails } from '@/interfaces/project.interfaces';
import { ITicket, ITicketListItem, ITicketListFilters } from '@/interfaces/ticket.interfaces';
import { IProject } from '@/interfaces/project.interfaces';
import { IUserWithRoles } from '@/interfaces/auth.interfaces';
import { 
  ProjectStatus, 
  updateTaskWithChecklist, 
  addTaskToPhase, 
  getTaskChecklistItems, 
  moveTaskToPhase, 
  deleteTask, 
  addTicketLinkAction, 
  getTaskTicketLinksAction, 
  deleteTaskTicketLinkAction,
  getProjectPhases,
  getProjectTaskStatuses 
} from '@/lib/actions/projectActions';
import { getTicketsForList, getTicketById } from '@/lib/actions/ticket-actions/ticketActions';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/Button';
import { TextArea } from '@/components/ui/TextArea';
import EditableText from '@/components/ui/EditableText';
import { ListChecks, Link, Plus, ExternalLink, Trash2, ChevronRight, ChevronDown } from 'lucide-react';
import UserPicker from '@/components/ui/UserPicker';
import { ConfirmationDialog } from '@/components/ui/ConfirmationDialog';
import CustomSelect from '@/components/ui/CustomSelect';
import HierarchicalSelect from '@/components/ui/HierarchicalSelect';
import { Input } from '@/components/ui/Input';
import { toast } from 'react-hot-toast';
import { QuickAddTicket } from '@/components/tickets/QuickAddTicket';
import { useDrawer } from '@/context/DrawerContext';
import TicketDetails from '@/components/tickets/TicketDetails';

interface TaskFormProps {
  task?: IProjectTask;
  phase: IProjectPhase;
  phases?: IProjectPhase[];
  onClose: () => void;
  onSubmit: (task: IProjectTask | null) => void;
  projectStatuses: ProjectStatus[];
  defaultStatus?: ProjectStatus;
  users: IUserWithRoles[];
  mode: 'create' | 'edit';
  projects?: IProject[];
}

export default function TaskForm({
  task,
  phase,
  phases,
  onClose,
  onSubmit,
  projectStatuses,
  defaultStatus,
  users,
  mode,
  projects
}: TaskFormProps): JSX.Element {
  const { openDrawer } = useDrawer();
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [taskName, setTaskName] = useState(task?.task_name || '');
  const [description, setDescription] = useState(task?.description || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checklistItems, setChecklistItems] = useState<Omit<ITaskChecklistItem, 'tenant'>[]>(task?.checklist_items || []);
  const [isEditingChecklist, setIsEditingChecklist] = useState(false);
  const [assignedUser, setAssignedUser] = useState<string>(task?.assigned_to || '');
  const [selectedProject, setSelectedProject] = useState<IProject | null>(null);
  const [availablePhases, setAvailablePhases] = useState<IProjectPhase[]>(phases || []);
  const [availableStatuses, setAvailableStatuses] = useState<ProjectStatus[]>(projectStatuses);
  const [showMoveConfirmation, setShowMoveConfirmation] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showTicketDialog, setShowTicketDialog] = useState(false);
  const [showNewTicketForm, setShowNewTicketForm] = useState(false);
  const [availableTickets, setAvailableTickets] = useState<ITicketListItem[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<string>('');
  const [taskTicketLinks, setTaskTicketLinks] = useState<IProjectTicketLinkWithDetails[]>([]);
  const [tempTaskId] = useState<string>(`temp-${Date.now()}`);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [estimatedHours, setEstimatedHours] = useState<number>(Number(task?.estimated_hours) || 0);
  const [actualHours, setActualHours] = useState<number>(Number(task?.actual_hours) || 0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPhase, setSelectedPhase] = useState<IProjectPhase>(phase);
  const [expandedPhases, setExpandedPhases] = useState<Record<string, boolean>>({});
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});

  const [selectedStatus, setSelectedStatus] = useState<string>(
    task?.project_status_mapping_id || 
    defaultStatus?.project_status_mapping_id || 
    projectStatuses[0]?.project_status_mapping_id
  );

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    setError(null);

    const fetchInitialData = async () => {
      try {
        const user = await getCurrentUser();
        if (!user) {
          throw new Error('No user found');
        }
        
        if (isMounted) {
          setCurrentUserId(user.user_id);
          const filters: ITicketListFilters = {
            channelFilterState: 'all'
          };
          const tickets = await getTicketsForList(user, filters);
          if (isMounted) {
            setAvailableTickets(tickets);
          }
        }

        if (task?.task_id && isMounted) {
          const [existingChecklistItems, links] = await Promise.all([
            getTaskChecklistItems(task.task_id),
            getTaskTicketLinksAction(task.task_id)
          ]);
          if (isMounted) {
            setChecklistItems(existingChecklistItems);
            setTaskTicketLinks(links);
          }
        }
      } catch (error) {
        console.error('Error fetching initial data:', error);
        if (isMounted) {
          setError(error instanceof Error ? error.message : 'Failed to load initial data');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    fetchInitialData();

    return () => {
      isMounted = false;
    };
  }, [task]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    if (taskName.trim() === '') {
      toast.error('Task name is required');
      return;
    }

    if (estimatedHours < 0) {
      toast.error('Estimated hours cannot be negative');
      return;
    }

    if (actualHours < 0) {
      toast.error('Actual hours cannot be negative');
      return;
    }

    setIsSubmitting(true);

    try {
      let resultTask: IProjectTask | null = null;

      if (mode === 'edit' && task) {
        const taskData = {
          ...task,
          task_name: taskName,
          project_status_mapping_id: selectedStatus,
          description: description,
          assigned_to: assignedUser || currentUserId,
          estimated_hours: estimatedHours,
          actual_hours: actualHours,
          checklist_items: checklistItems
        };
        resultTask = await updateTaskWithChecklist(task.task_id, taskData);
      } else {
        const taskData = {
          task_name: taskName,
          project_status_mapping_id: selectedStatus,
          wbs_code: `${phase.wbs_code}.0`,
          description: description,
          assigned_to: assignedUser || currentUserId,
          estimated_hours: estimatedHours,
          actual_hours: actualHours,
          due_date: new Date(),
          phase_id: phase.phase_id
        };

        resultTask = await addTaskToPhase(phase.phase_id, taskData, checklistItems);
        
        if (resultTask && taskTicketLinks.length > 0) {
          const linkErrors: string[] = [];
          
          for (const link of taskTicketLinks) {
            try {
              await addTicketLinkAction(phase.project_id, resultTask.task_id, link.ticket_id);
            } catch (error: any) {
              console.error('Error linking ticket:', error);
              linkErrors.push(`${link.ticket_number}: ${error.message || 'Unknown error'}`);
            }
          }
          
          if (linkErrors.length > 0) {
            toast.error(`Failed to link some tickets:\n${linkErrors.join('\n')}`);
          }
        }
      }
      
      onSubmit(resultTask);
      onClose();
    } catch (error) {
      console.error('Error saving task:', error);
      toast.error('Failed to save task');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleProjectChange = async (projectId: string) => {
    try {
      const newProject = projects?.find(p => p.project_id === projectId);
      if (newProject && newProject.project_id !== phase.project_id) {
        setSelectedProject(newProject);
        
        const [projectPhases, projectStatuses] = await Promise.all([
          getProjectPhases(projectId),
          getProjectTaskStatuses(projectId)
        ]);
        
        setAvailablePhases(projectPhases);
        setAvailableStatuses(projectStatuses);
        
        if (projectPhases.length > 0) {
          setSelectedPhase(projectPhases[0]);
          setShowMoveConfirmation(true);
        }
        if (projectStatuses.length > 0) {
          setSelectedStatus(projectStatuses[0].project_status_mapping_id);
        }

        // Expand the selected project's phases
        setExpandedProjects(prev => ({
          ...prev,
          [projectId]: true
        }));
      }
    } catch (error) {
      console.error('Error fetching project data:', error);
      toast.error('Failed to load project data');
    }
  };

  const handlePhaseChange = (phaseId: string) => {
    const newPhase = availablePhases.find(p => p.phase_id === phaseId);
    if (newPhase && newPhase.phase_id !== selectedPhase.phase_id) {
      setSelectedPhase(newPhase);
      setShowMoveConfirmation(true);
    }
  };

  const handleMoveConfirm = async () => {
    if (!task) return;
    
    setIsSubmitting(true);
    try {
      const movedTask = await moveTaskToPhase(
        task.task_id,
        selectedPhase.phase_id,
        selectedProject?.project_id,
        selectedStatus
      );
      
      if (movedTask) {
        const taskData = {
          ...movedTask,
          estimated_hours: estimatedHours,
          actual_hours: actualHours,
          checklist_items: checklistItems
        };
        const updatedTask = await updateTaskWithChecklist(movedTask.task_id, taskData);
        onSubmit(updatedTask);
      }
      
      const successMessage = selectedProject
        ? `Task moved to ${selectedProject.project_name}, ${selectedPhase.phase_name}`
        : `Task moved to ${selectedPhase.phase_name}`;
      toast.success(successMessage);
      onClose();
    } catch (error) {
      console.error('Error moving task:', error);
      toast.error('Failed to move task');
    } finally {
      setIsSubmitting(false);
      setShowMoveConfirmation(false);
    }
  };

  const handleCancelClick = (e?: React.MouseEvent) => {
    e?.preventDefault();
    setShowCancelConfirm(true);
  };

  const handleCancelConfirm = () => {
    setShowCancelConfirm(false);
    onClose();
  };

  const handleCancelDismiss = () => {
    setShowCancelConfirm(false);
  };

  const handleDialogClose = (open: boolean) => {
    if (!open) {
      handleCancelClick();
    }
  };

  const toggleEditChecklist = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditingChecklist(!isEditingChecklist);
  };

  const addChecklistItem = () => {
    const newItem: Omit<ITaskChecklistItem, 'tenant'> = {
      checklist_item_id: `temp-${Date.now()}`,
      task_id: task?.task_id || tempTaskId,
      item_name: '',
      description: null,
      assigned_to: null,
      completed: false,
      due_date: null,
      created_at: new Date(),
      updated_at: new Date(),
      order_number: checklistItems.length + 1,
    };
    setChecklistItems([...checklistItems, newItem]);
  };

  const updateChecklistItem = (index: number, field: keyof ITaskChecklistItem, value: any) => {
    const updatedItems = [...checklistItems];
    updatedItems[index] = { ...updatedItems[index], [field]: value };
    setChecklistItems(updatedItems);
  };

  const removeChecklistItem = (index: number) => {
    const updatedItems = checklistItems.filter((_, i) => i !== index);
    setChecklistItems(updatedItems);
  };

  const handleLinkTicket = async () => {
    if (!selectedTicket) return;
    
    try {
      if (task?.task_id) {
        await addTicketLinkAction(phase.project_id, task.task_id, selectedTicket);
        const links = await getTaskTicketLinksAction(task.task_id);
        setTaskTicketLinks(links);
      } else {
        const selectedTicketDetails = availableTickets.find(t => t.ticket_id === selectedTicket);
        if (selectedTicketDetails) {
          const tempLink: IProjectTicketLinkWithDetails = {
            link_id: `temp-${Date.now()}`,
            task_id: tempTaskId,
            ticket_id: selectedTicket,
            ticket_number: selectedTicketDetails.ticket_number,
            title: selectedTicketDetails.title,
            created_at: new Date(),
            project_id: phase.project_id,
            phase_id: phase.phase_id,
            status_name: selectedTicketDetails.status_name,
            is_closed: selectedTicketDetails.closed_at !== null
          };
          setTaskTicketLinks([...taskTicketLinks, tempLink]);
        }
      }
      toast.success('Ticket linked successfully');
      setShowTicketDialog(false);
    } catch (error: any) {
      console.error('Error linking ticket:', error);
      if (error.message === 'This ticket is already linked to this task') {
        toast.error('This ticket is already linked to this task');
      } else {
        toast.error('Failed to link ticket');
      }
    }
  };

  const handleNewTicketCreated = async (ticket: ITicket) => {
    if (!ticket.ticket_id) {
      toast.error('Invalid ticket ID');
      return;
    }
    try {
      if (task?.task_id) {
        await addTicketLinkAction(phase.project_id, task.task_id, ticket.ticket_id);
        const links = await getTaskTicketLinksAction(task.task_id);
        setTaskTicketLinks(links);
      } else {
        const user = await getCurrentUser();
        if (!user) {
          toast.error('No user session found');
          return;
        }
        const filters: ITicketListFilters = {
          channelFilterState: 'all'
        };
        const updatedTickets = await getTicketsForList(user, filters);
        setAvailableTickets(updatedTickets);

        const newTicketDetails = updatedTickets.find(t => t.ticket_id === ticket.ticket_id);
        if (!newTicketDetails) {
          toast.error('Failed to load ticket details');
          return;
        }

        const tempLink: IProjectTicketLinkWithDetails = {
          link_id: `temp-${Date.now()}`,
          task_id: tempTaskId,
          ticket_id: ticket.ticket_id,
          ticket_number: ticket.ticket_number,
          title: ticket.title,
          created_at: new Date(),
          project_id: phase.project_id,
          phase_id: phase.phase_id,
          status_name: newTicketDetails.status_name,
          is_closed: false
        };
        setTaskTicketLinks([...taskTicketLinks, tempLink]);
      }
      toast.success('New ticket created and linked');
      setShowNewTicketForm(false);
    } catch (error: any) {
      console.error('Error linking new ticket:', error);
      if (error.message === 'This ticket is already linked to this task') {
        toast.error('This ticket is already linked to this task');
      } else {
        toast.error('Failed to link ticket');
      }
    }
  };

  const handleViewTicket = async (ticketId: string) => {
    try {
      const user = await getCurrentUser();
      if (!user) {
        toast.error('No user session found');
        return;
      }
      
      const ticket = await getTicketById(ticketId, user);
      if (!ticket) {
        toast.error('Failed to load ticket');
        return;
      }

      openDrawer(<TicketDetails initialTicket={ticket} />);
    } catch (error) {
      console.error('Error loading ticket:', error);
      toast.error('Failed to load ticket');
    }
  };

  const handleDeleteTicketLink = async (linkId: string) => {
    try {
      if (task?.task_id) {
        await deleteTaskTicketLinkAction(linkId);
        const links = await getTaskTicketLinksAction(task.task_id);
        setTaskTicketLinks(links);
      } else {
        setTaskTicketLinks(taskTicketLinks.filter(link => link.link_id !== linkId));
      }
      toast.success('Ticket link removed');
    } catch (error) {
      console.error('Error deleting ticket link:', error);
      toast.error('Failed to remove ticket link');
    }
  };

  const handleDeleteConfirm = async () => {
    if (!task?.task_id) return;
    
    setIsSubmitting(true);
    try {
      await deleteTask(task.task_id);
      toast.success('Task deleted successfully');
      onSubmit(null);
      onClose();
    } catch (error) {
      console.error('Error deleting task:', error);
      toast.error('Failed to delete task');
    } finally {
      setIsSubmitting(false);
      setShowDeleteConfirm(false);
    }
  };
  
  const handleDeleteDismiss = () => {
    setShowDeleteConfirm(false);
  };

const generateMoveToOptions = () => {
  const options = [];

  // Add current project first
  const currentProject = projects?.find(p => p.project_id === phase.project_id);
  if (currentProject) {
    // Project header
    options.push({
      value: `project_header_${currentProject.project_id}`,
      label: (
        <div className="flex items-center space-x-1 font-semibold" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="p-1 hover:bg-gray-100 rounded"
            onClick={() => {
              setExpandedProjects(prev => ({
                ...prev,
                [currentProject.project_id]: !prev[currentProject.project_id]
              }));
            }}
          >
            {expandedProjects[currentProject.project_id] ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
          <span 
            onClick={() => handleProjectChange(currentProject.project_id)}
            className="cursor-pointer hover:text-purple-600"
          >
            {currentProject.project_name}
          </span>
        </div>
      ),
      isHeader: true
    });

    // If project is expanded, show phases
    if (expandedProjects[currentProject.project_id]) {
      (phases || []).forEach(p => {
        // Phase header
        options.push({
          value: `phase_header_${p.phase_id}`,
          label: (
            <div className="flex items-center space-x-1 ml-4" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="p-1 hover:bg-gray-100 rounded"
                onClick={() => {
                  setExpandedPhases(prev => ({
                    ...prev,
                    [p.phase_id]: !prev[p.phase_id]
                  }));
                }}
              >
                {expandedPhases[p.phase_id] ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
              <span 
                onClick={() => handlePhaseChange(p.phase_id)}
                className="cursor-pointer hover:text-purple-600"
              >
                {p.phase_name}
              </span>
            </div>
          ),
          isHeader: true
        });

        // If phase is expanded, show statuses
        if (expandedPhases[p.phase_id]) {
          projectStatuses.forEach(status => {
            options.push({
              value: `${p.phase_id}_${status.project_status_mapping_id}`,
              label: <span className="ml-12">{status.custom_name || status.name}</span>
            });
          });
        }
      });
    }
  }

  // Add other projects
  projects?.filter(p => p.project_id !== phase.project_id).forEach(p => {
    // Project header
    options.push({
      value: `project_header_${p.project_id}`,
      label: (
        <div className="flex items-center space-x-1 font-semibold mt-2" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="p-1 hover:bg-gray-100 rounded"
            onClick={() => {
              setExpandedProjects(prev => ({
                ...prev,
                [p.project_id]: !prev[p.project_id]
              }));
            }}
          >
            {expandedProjects[p.project_id] ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
          <span 
            onClick={() => handleProjectChange(p.project_id)}
            className="cursor-pointer hover:text-purple-600"
          >
            {p.project_name}
          </span>
        </div>
      ),
      isHeader: true
    });

    // If project is expanded and it's the selected project, show its phases
    if (expandedProjects[p.project_id] && selectedProject?.project_id === p.project_id) {
      availablePhases.forEach(p => {
        // Phase header
        options.push({
          value: `phase_header_${p.phase_id}`,
          label: (
            <div className="flex items-center space-x-1 ml-4" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="p-1 hover:bg-gray-100 rounded"
                onClick={() => {
                  setExpandedPhases(prev => ({
                    ...prev,
                    [p.phase_id]: !prev[p.phase_id]
                  }));
                }}
              >
                {expandedPhases[p.phase_id] ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
              <span 
                onClick={() => handlePhaseChange(p.phase_id)}
                className="cursor-pointer hover:text-purple-600"
              >
                {p.phase_name}
              </span>
            </div>
          ),
          isHeader: true
        });

        // If phase is expanded, show statuses
        if (expandedPhases[p.phase_id]) {
          availableStatuses.forEach(status => {
            options.push({
              value: `${p.phase_id}_${status.project_status_mapping_id}`,
              label: <span className="ml-12">{status.custom_name || status.name}</span>
            });
          });
        }
      });
    }
  });

  return options;
};

  const renderSelectedValue = (value: string, options: any[]) => {
    const [phaseId, statusId] = value.split('_');
    if (!statusId) return 'Select destination...';
  
    // Find the current phase and status
    const currentPhase = phases?.find(p => p.phase_id === phaseId) || 
                        availablePhases.find(p => p.phase_id === phaseId);
    const currentStatus = projectStatuses.find(s => s.project_status_mapping_id === statusId) ||
                         availableStatuses.find(s => s.project_status_mapping_id === statusId);
    
    if (!currentPhase || !currentStatus) return 'Select destination...';
  
    // Find the project that owns this phase
    const phaseProject = selectedProject || 
                        projects?.find(p => p.project_id === currentPhase.project_id) || 
                        projects?.find(p => p.project_id === phase.project_id);
  
    if (!phaseProject) return `${currentPhase.phase_name} / ${currentStatus.custom_name || currentStatus.name}`;
  
    // Return the full hierarchy
    return `${phaseProject.project_name} / ${currentPhase.phase_name} / ${currentStatus.custom_name || currentStatus.name}`;
  };
  
  const handleMoveToChange = (value: string) => {
    if (value.startsWith('project_header_') || value.startsWith('phase_header_')) {
      return; // These are just headers, ignore selection
    }

    // Handle phase and status selection
    const [phaseId, statusId] = value.split('_');
    handlePhaseChange(phaseId);
    if (statusId) {
      setSelectedStatus(statusId);
    }
  };

  const statusOptions = projectStatuses.map((status): { value: string; label: string } => ({
    value: status.project_status_mapping_id,
    label: status.custom_name || status.name
  }));

  const ticketOptions = availableTickets
    .filter((ticket): ticket is ITicketListItem & { ticket_id: string } => ticket.ticket_id !== undefined)
    .map((ticket): { value: string; label: string } => ({
      value: ticket.ticket_id,
      label: `${ticket.ticket_number} - ${ticket.title}`
    }));

  return (
    <>
      <Dialog.Root open={true} onOpenChange={handleDialogClose}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black bg-opacity-50" />
          <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white p-6 rounded-lg shadow-lg w-[600px] max-h-[90vh] overflow-y-auto">
            <Dialog.Title className="text-xl font-semibold mb-4">
              {mode === 'edit' ? 'Edit Task' : 'Add New Task'}
            </Dialog.Title>
            <form onSubmit={handleSubmit} className="flex flex-col">
              {error && (
                <div className="mb-4 p-2 bg-red-100 border border-red-400 text-red-700 rounded">
                  {error}
                </div>
              )}
              {isLoading ? (
                <div className="flex justify-center items-center p-4">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500"></div>
                </div>
              ) : (
                <div className="space-y-4">
                  <EditableText
                    value={taskName}
                    onChange={setTaskName}
                    placeholder="Title..."
                    className="w-full text-lg font-semibold"
                  />

                  {mode === 'edit' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Move To</label>
                      <HierarchicalSelect
                        value={`${selectedPhase.phase_id}_${selectedStatus}`}
                        onValueChange={handleMoveToChange}
                        options={generateMoveToOptions()}
                        className="w-full"
                        renderSelectedValue={renderSelectedValue}
                        placeholder="Select destination..."
                      />
                    </div>
                  )}

                  <TextArea
                    value={description}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
                    placeholder="Description"
                    className="w-full p-2 border border-gray-300 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
                    rows={3}
                  />

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Estimated Hours
                      </label>
                      <Input
                        type="number"
                        min="0"
                        step="0.5"
                        value={estimatedHours}
                        onChange={(e) => setEstimatedHours(Number(e.target.value))}
                        className="w-full"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Actual Hours
                      </label>
                      <Input
                        type="number"
                        min="0"
                        step="0.5"
                        value={actualHours}
                        onChange={(e) => setActualHours(Number(e.target.value))}
                        className="w-full"
                      />
                    </div>
                  </div>

                  <CustomSelect
                    value={selectedStatus}
                    onValueChange={setSelectedStatus}
                    options={statusOptions}
                    placeholder="Select status"
                    className="w-full"
                  />

                  <UserPicker
                    label="Assigned To"
                    value={assignedUser}
                    onValueChange={setAssignedUser}
                    size="sm"
                    users={users}
                  />

                  <div className="flex items-center justify-between mb-2">
                    <h3 className='font-semibold'>Checklist</h3>
                    <button 
                      onClick={toggleEditChecklist} 
                      className="text-gray-500 hover:text-gray-700"
                      type="button"
                    >
                      <ListChecks className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="flex flex-col space-y-2">
                    {checklistItems.map((item, index): JSX.Element => (
                      <div key={index} className="flex items-center space-x-2">
                        {isEditingChecklist ? (
                          <>
                            <input
                              type="checkbox"
                              checked={item.completed}
                              onChange={(e) => updateChecklistItem(index, 'completed', e.target.checked)}
                              className="mr-2"
                            />
                            <Input
                              value={item.item_name}
                              onChange={(e) => updateChecklistItem(index, 'item_name', e.target.value)}
                              placeholder="Checklist item"
                              className="flex-grow"
                            />
                            <button
                              type="button"
                              onClick={() => removeChecklistItem(index)}
                              className="text-red-500"
                            >
                              Remove
                            </button>
                          </>
                        ) : (
                          <>
                            <input
                              type="checkbox"
                              checked={item.completed}
                              onChange={(e) => updateChecklistItem(index, 'completed', e.target.checked)}
                              className="mr-2"
                            />
                            <span className={item.completed ? 'line-through text-gray-500' : ''}>
                              {item.item_name}
                              </span>
                        </>
                      )}
                    </div>
                  ))}
                </div>

                {isEditingChecklist && (
                  <Button type="button" variant="soft" onClick={addChecklistItem}>
                    Add an item
                  </Button>
                )}

                <div className="mt-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold">Associated Tickets</h3>
                    <div className="flex space-x-2">
                      <Button
                        type="button"
                        variant="soft"
                        onClick={() => setShowTicketDialog(true)}
                        className="flex items-center"
                      >
                        <Link className="h-4 w-4 mr-1" />
                        Link Ticket
                      </Button>
                      <Button
                        type="button"
                        variant="soft"
                        onClick={() => setShowNewTicketForm(true)}
                        className="flex items-center"
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        Create Ticket
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {taskTicketLinks.map((link): JSX.Element => (
                      <div key={link.link_id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                        <span>{link.ticket_number} - {link.title}</span>
                        <div className="flex items-center space-x-2">
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => handleViewTicket(link.ticket_id)}
                            className="flex items-center text-sm"
                          >
                            <ExternalLink className="h-4 w-4 mr-1" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => handleDeleteTicketLink(link.link_id)}
                            className="flex items-center text-sm text-red-500 hover:text-red-700"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-between mt-6">
                  <Button 
                    type="button" 
                    variant="ghost" 
                    onClick={handleCancelClick} 
                    disabled={isSubmitting}
                  >
                    Cancel
                  </Button>
                  {mode === 'edit' && (
                    <Button
                      type="button"
                      variant="destructive"  // or use custom styling for orange color
                      onClick={() => setShowDeleteConfirm(true)}
                      disabled={isSubmitting}
                    >
                      Delete
                    </Button>
                  )}
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? (mode === 'edit' ? 'Updating...' : 'Adding...') : (mode === 'edit' ? 'Update' : 'Save')}
                  </Button>
                </div>
                </div>
              )}
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <ConfirmationDialog
        isOpen={showCancelConfirm}
        onClose={handleCancelDismiss}
        onConfirm={handleCancelConfirm}
        title="Cancel Task"
        message="Are you sure you want to cancel? Any unsaved changes will be lost."
        confirmLabel="Cancel"
        cancelLabel="Continue editing"
      />

      <ConfirmationDialog
        isOpen={showDeleteConfirm}
        onClose={handleDeleteDismiss}
        onConfirm={handleDeleteConfirm}
        title="Delete Task"
        message={`Are you sure you want to delete task "${taskName}"? This action cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />

      {mode === 'edit' && (
        <ConfirmationDialog
          isOpen={showMoveConfirmation}
          onClose={() => {
            setShowMoveConfirmation(false);
            setSelectedPhase(phase);
          }}
          onConfirm={handleMoveConfirm}
          title="Move Task"
          message={selectedProject 
            ? `Are you sure you want to move task "${taskName}" to project "${selectedProject.project_name}", phase "${selectedPhase.phase_name}"?`
            : `Are you sure you want to move task "${taskName}" to phase "${selectedPhase.phase_name}"?`}
          confirmLabel="Move"
          cancelLabel="Cancel"
        />
      )}

      <Dialog.Root open={showTicketDialog} onOpenChange={setShowTicketDialog}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black bg-opacity-50" />
          <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white p-4 rounded-lg shadow-lg w-[400px]">
            <Dialog.Title className="text-lg font-semibold mb-4">Link Existing Ticket</Dialog.Title>
            <div className="space-y-4">
              <CustomSelect
                value={selectedTicket}
                onValueChange={setSelectedTicket}
                options={ticketOptions}
                placeholder="Select a ticket"
                className="w-full"
              />
              <div className="flex justify-end space-x-2">
                <Button variant="ghost" onClick={() => setShowTicketDialog(false)}>
                  Cancel
                </Button>
                <Button onClick={handleLinkTicket} disabled={!selectedTicket}>
                  Link Ticket
                </Button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={showNewTicketForm} onOpenChange={setShowNewTicketForm}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black bg-opacity-50" />
          <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white p-4 rounded-lg shadow-lg w-[600px]">
            <Dialog.Title className="text-lg font-semibold mb-4">Create New Ticket</Dialog.Title>
            <QuickAddTicket 
              open={showNewTicketForm}
              onOpenChange={setShowNewTicketForm}
              onTicketAdded={handleNewTicketCreated}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
