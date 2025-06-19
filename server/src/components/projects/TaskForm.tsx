'use client';

import React, { useState, useEffect } from 'react';
import { IProjectPhase, IProjectTask, ITaskChecklistItem, ProjectStatus, IProjectTicketLinkWithDetails, IProjectTaskDependency } from 'server/src/interfaces/project.interfaces';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { IPriority, IStandardPriority } from 'server/src/interfaces/ticket.interfaces';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import AvatarIcon from 'server/src/components/ui/AvatarIcon';
import { getProjectTreeData, getProjectDetails } from 'server/src/lib/actions/project-actions/projectActions';
import { getAllPrioritiesWithStandard } from 'server/src/lib/actions/priorityActions';
import {
  updateTaskWithChecklist,
  addTaskToPhase,
  getTaskChecklistItems,
  moveTaskToPhase,
  deleteTask,
  addTaskResourceAction,
  removeTaskResourceAction,
  getTaskResourcesAction,
  addTicketLinkAction,
  duplicateTaskToPhase,
  getTaskDependencies
} from 'server/src/lib/actions/project-actions/projectTaskActions';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { findTagsByEntityId } from 'server/src/lib/actions/tagActions';
import { TagManager } from 'server/src/components/tags';
import { Dialog, DialogContent } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { TextArea } from 'server/src/components/ui/TextArea';
import { ListChecks, UserPlus, Trash2, Clock } from 'lucide-react';
import { DatePicker } from 'server/src/components/ui/DatePicker';
import UserPicker from 'server/src/components/ui/UserPicker';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import DuplicateTaskDialog, { DuplicateOptions } from './DuplicateTaskDialog';
import { Input } from 'server/src/components/ui/Input';
import { toast } from 'react-hot-toast';
import { TaskTypeSelector } from './TaskTypeSelector';
import { getTaskTypes } from 'server/src/lib/actions/project-actions/projectTaskActions';
import { ITaskType } from 'server/src/interfaces/project.interfaces';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import TaskTicketLinks from './TaskTicketLinks';
import { TaskDependencies } from './TaskDependencies';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import TreeSelect, { TreeSelectOption, TreeSelectPath } from 'server/src/components/ui/TreeSelect';
import { Checkbox } from 'server/src/components/ui/Checkbox';
import { useDrawer } from 'server/src/context/DrawerContext';
import { IWorkItem, WorkItemType } from 'server/src/interfaces/workItem.interfaces';
import TimeEntryDialog from 'server/src/components/time-management/time-entry/time-sheet/TimeEntryDialog';
import { getCurrentTimePeriod } from 'server/src/lib/actions/timePeriodsActions';
import { fetchOrCreateTimeSheet, saveTimeEntry } from 'server/src/lib/actions/timeEntryActions';

type ProjectTreeTypes = 'project' | 'phase' | 'status';

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
  onPhaseChange: (phaseId: string) => void;
  inDrawer?: boolean;
  projectTreeData?: any[]; // Add projectTreeData prop
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
  onPhaseChange,
  inDrawer = false,
  projectTreeData = []
}: TaskFormProps): JSX.Element {
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [taskName, setTaskName] = useState(task?.task_name || '');
  const [description, setDescription] = useState(task?.description || '');
  const [projectTreeOptions, setProjectTreeOptions] = useState<Array<TreeSelectOption<'project' | 'phase' | 'status'>>>([]);
  const [selectedPhaseId, setSelectedPhaseId] = useState<string>(phase.phase_id);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checklistItems, setChecklistItems] = useState<Omit<ITaskChecklistItem, 'tenant'>[]>(task?.checklist_items || []);
  const [isEditingChecklist, setIsEditingChecklist] = useState(false);
  const [assignedUser, setAssignedUser] = useState<string | null>(task?.assigned_to ?? null);
  const [selectedPhase, setSelectedPhase] = useState<IProjectPhase>(phase);
  const [showMoveConfirmation, setShowMoveConfirmation] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [tempTaskId] = useState<string>(`temp-${Date.now()}`);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // Convert from minutes to hours for display
  const [estimatedHours, setEstimatedHours] = useState<number>(Number(task?.estimated_hours) / 60 || 0);
  const [actualHours, setActualHours] = useState<number>(Number(task?.actual_hours) / 60 || 0);
  const [dueDate, setDueDate] = useState<Date | undefined>(task?.due_date ? new Date(task.due_date) : undefined);
  const [taskResources, setTaskResources] = useState<any[]>(task?.task_id ? [] : []);
  const [tempTaskResources, setTempTaskResources] = useState<any[]>([]);
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [taskTags, setTaskTags] = useState<ITag[]>([]);
  const [pendingTicketLinks, setPendingTicketLinks] = useState<IProjectTicketLinkWithDetails[]>(task?.ticket_links || []);
  const [editingChecklistItemId, setEditingChecklistItemId] = useState<string | null>(null);
  const [isCrossProjectMove, setIsCrossProjectMove] = useState<boolean>(false);
  const [selectedDuplicatePhaseId, setSelectedDuplicatePhaseId] = useState<string | null>(null);
  const [showDuplicateConfirm, setShowDuplicateConfirm] = useState(false); // State for duplicate dialog
  const [taskTypes, setTaskTypes] = useState<ITaskType[]>([]);
  const [selectedTaskType, setSelectedTaskType] = useState<string>(task?.task_type_key || 'task');
  const [initialTaskType] = useState<string>(task?.task_type_key || 'task');
  const [allProjectTasks, setAllProjectTasks] = useState<IProjectTask[]>([]);
  const [duplicateTaskDetails, setDuplicateTaskDetails] = useState<{
    originalTaskId: string;
    originalTaskName: string;
    targetPhaseId: string;
    targetPhaseName: string;
    targetStatusId: string | null;
    hasChecklist: boolean;
    hasPrimaryAssignee: boolean;
    additionalAssigneeCount: number;
    ticketLinkCount: number;
  } | null>(null);
  const [priorities, setPriorities] = useState<(IPriority | IStandardPriority)[]>([]);
  const [selectedPriorityId, setSelectedPriorityId] = useState<string | null>(task?.priority_id ?? null);
  const [taskDependencies, setTaskDependencies] = useState<{
    predecessors: IProjectTaskDependency[];
    successors: IProjectTaskDependency[];
  }>({ predecessors: [], successors: [] });
  
  const { openDrawer, closeDrawer } = useDrawer();

  const [selectedStatusId, setSelectedStatusId] = useState<string>(
    task?.project_status_mapping_id ||
    defaultStatus?.project_status_mapping_id ||
    projectStatuses[0]?.project_status_mapping_id
  );
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const user = await getCurrentUser();
        if (user) {
          setCurrentUserId(user.user_id);
        }

        // Fetch priorities for project tasks
        const allPriorities = await getAllPrioritiesWithStandard('project_task');
        setPriorities(allPriorities);
        
        // Fetch task types
        const types = await getTaskTypes();
        setTaskTypes(types);
        
        // Fetch all tasks in the project
        if (phase.project_id) {
          try {
            const { tasks } = await getProjectDetails(phase.project_id);
            setAllProjectTasks(tasks);
          } catch (error) {
            console.error('Error fetching project tasks:', error);
          }
        }

        if (task?.task_id) {
          // Use checklist items and resources from the task object if they exist
          if (task.checklist_items !== undefined) {
            console.log('Using checklist items from task object');
            setChecklistItems(task.checklist_items);
          } else {
            // Only fetch if not available on the task object
            console.log('Fetching checklist items from API');
            const existingChecklistItems = await getTaskChecklistItems(task.task_id);
            setChecklistItems(existingChecklistItems);
          }

          if (task.resources !== undefined) {
            console.log('Using resources from task object');
            setTaskResources(task.resources);
          } else {
            // Only fetch if not available on the task object
            console.log('Fetching resources from API');
            const resources = await getTaskResourcesAction(task.task_id);
            setTaskResources(resources);
          }

          // Fetch tags
          const tags = await findTagsByEntityId(task.task_id, 'project_task');
          setTaskTags(tags);
        }
      } catch (error) {
        console.error('Error fetching initial data:', error);
      }
    };
    fetchInitialData();
  }, [task?.task_id]);

  // Separate effect for loading task dependencies
  useEffect(() => {
    const loadDependencies = async () => {
      if (task?.task_id && mode === 'edit') {
        try {
          console.log('Fetching task dependencies from API');
          const dependencies = await getTaskDependencies(task.task_id);
          setTaskDependencies(dependencies);
        } catch (error) {
          console.error('Error fetching task dependencies:', error);
          // Set empty dependencies on error to avoid breaking the UI
          setTaskDependencies({ predecessors: [], successors: [] });
        }
      }
    };

    loadDependencies();
  }, [task?.task_id, mode]);

  // Use provided projectTreeData if available, otherwise fetch it
  useEffect(() => {
    const fetchProjectsData = async () => {
      if (mode === 'edit') {
        if (projectTreeData && projectTreeData.length > 0) {
          // Use the provided project tree data
          setProjectTreeOptions(projectTreeData);
        } else {
          // Fall back to fetching the data if not provided
          try {
            const treeData = await getProjectTreeData();
            if (treeData && Array.isArray(treeData) && treeData.length > 0) {
              setProjectTreeOptions(treeData);
            } else {
              console.error('Invalid or empty tree data received:', treeData);
              toast.error('No projects available with valid phases and statuses');
              setProjectTreeOptions([]);
            }
          } catch (error) {
            console.error('Error fetching projects:', error);
            toast.error('Error loading project data. Please try again.');
            setProjectTreeOptions([]);
          }
        }
      }
    };

    fetchProjectsData();
  }, [mode, projectTreeData.length]);

  const handleTreeSelectChange = async (
    value: string,
    type: ProjectTreeTypes,
    excluded: boolean,
    path?: TreeSelectPath
  ) => {
    if (!path) {
      console.error('Path is undefined in tree select change');
      return;
    }

    // Get IDs from the path
    const phaseId = path['phase'];
    const statusId = path['status'];

    if (!phaseId) {
      console.error('Phase ID is missing from path');
      return;
    }
    
    // Find the selected phase from tree options
    const findPhaseInTree = (options: TreeSelectOption<ProjectTreeTypes>[]): TreeSelectOption<ProjectTreeTypes> | undefined => {
      for (const opt of options) {
        if (opt.type === 'phase' && opt.value === phaseId) {
          return opt;
        }
        if (opt.children) {
          const found = findPhaseInTree(opt.children);
          if (found) return found;
        }
      }
      return undefined;
    };

    const selectedPhaseOption = findPhaseInTree(projectTreeOptions);
    if (!selectedPhaseOption) return;

    // Update phase ID
    setSelectedPhaseId(phaseId);

    // Find the project ID of the selected phase
    const findProjectId = (options: TreeSelectOption<ProjectTreeTypes>[]): string | undefined => {
      for (const opt of options) {
        if (opt.type === 'project' && opt.children?.some(child => child.value === phaseId)) {
          return opt.value;
        }
        if (opt.children) {
          const found = findProjectId(opt.children);
          if (found) return found;
        }
      }
      return undefined;
    };

    const newProjectId = findProjectId(projectTreeOptions);
    const currentProjectId = phase.project_id;
    const isMovingToNewProject = Boolean(newProjectId && currentProjectId !== newProjectId);
    setIsCrossProjectMove(isMovingToNewProject);

    // Update status ID based on the following priority:
    // 1. Status from path (if explicitly selected)
    // 2. For same-project moves:
    //    a. Current task's status (if valid)
    //    b. Default status
    //    c. First available status
    // 3. For cross-project moves:
    //    Let moveTaskToPhase handle status mapping
    if (statusId) {
      // Status explicitly selected
      setSelectedStatusId(statusId);
    } else if (!isCrossProjectMove) {
      // Same project move - try to keep current status if valid
      const currentStatusId = task?.project_status_mapping_id;
      const currentStatusValid = currentStatusId && projectStatuses.some(s => s.project_status_mapping_id === currentStatusId);
      
      if (currentStatusValid) {
        setSelectedStatusId(currentStatusId);
      } else if (defaultStatus?.project_status_mapping_id) {
        setSelectedStatusId(defaultStatus.project_status_mapping_id);
      } else if (projectStatuses.length > 0) {
        setSelectedStatusId(projectStatuses[0].project_status_mapping_id);
      }
    } else {
      // Cross-project move - let moveTaskToPhase handle status mapping
      // Keep the current status ID until moveTaskToPhase determines the new one
      setSelectedStatusId(task?.project_status_mapping_id || projectStatuses[0]?.project_status_mapping_id);
    }
    
    // Show move confirmation if it's a different phase
    if (phaseId !== phase.phase_id) {
      setSelectedPhase({ ...phase, phase_id: phaseId });
      setShowMoveConfirmation(true);
    }
    
    handlePhaseChange(phaseId);
    onPhaseChange(phaseId);
  };

  const handleMoveConfirm = async () => {
    if (!task) return;
    
    setIsSubmitting(true);
    try {
      // For cross-project moves, let moveTaskToPhase handle status mapping
      const movedTask = await moveTaskToPhase(
        task.task_id, 
        selectedPhaseId, 
        isCrossProjectMove ? undefined : selectedStatusId // Only pass status ID for same-project moves
      );
      
      if (movedTask) {
        // For cross-project moves, use the status mapping that moveTaskToPhase determined
        // Update our local state to match the new status
        if (isCrossProjectMove) {
          setSelectedStatusId(movedTask.project_status_mapping_id);
        }

        // Update task with all fields preserved
        const taskData: Partial<IProjectTask> = {
          task_name: taskName,
          description: description,
          assigned_to: assignedUser || null,
          estimated_hours: Math.round(estimatedHours * 60), // Convert hours to minutes for storage
          actual_hours: Math.round(actualHours * 60), // Convert hours to minutes for storage
          due_date: dueDate || null,
          checklist_items: checklistItems,
          phase_id: selectedPhaseId,
          project_status_mapping_id: movedTask.project_status_mapping_id, // Always use the mapping from moveTaskToPhase
          task_type_key: selectedTaskType
        };
        const updatedTask = await updateTaskWithChecklist(movedTask.task_id, taskData);
        onSubmit(updatedTask);
      }
      
      toast.success('Task moved successfully');
      onClose();
    } catch (error) {
      console.error('Error moving task:', error);
      toast.error('Failed to move task');
    } finally {
      setIsSubmitting(false);
      setShowMoveConfirmation(false);
    }
  };

  const clearErrorIfSubmitted = () => {
    if (hasAttemptedSubmit) {
      setValidationErrors([]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);
    
    const errors: string[] = [];
    if (!taskName.trim()) errors.push('Task name');
    
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }
    
    setValidationErrors([]);

    setIsSubmitting(true);

    try {
      let resultTask: IProjectTask | null = null;

      // Convert empty string to null for database
      const finalAssignedTo = !assignedUser || assignedUser === '' ? null : assignedUser;

      if (mode === 'edit' && task?.task_id) {
        // Edit mode - handle cross-project moves properly
        const movedTask = await moveTaskToPhase(
          task.task_id, 
          selectedPhaseId, 
          isCrossProjectMove ? undefined : selectedStatusId
        );
        
        if (movedTask) {
          // For cross-project moves, use the status mapping that moveTaskToPhase determined
          // Update our local state to match the new status
          if (isCrossProjectMove) {
            setSelectedStatusId(movedTask.project_status_mapping_id);
          }

          const taskData: Partial<IProjectTask> = {
            task_name: taskName,
            description: description,
            assigned_to: finalAssignedTo,
            estimated_hours: Math.round(estimatedHours * 60), // Convert hours to minutes for storage
            actual_hours: Math.round(actualHours * 60), // Convert hours to minutes for storage
            due_date: dueDate || null,
            priority_id: selectedPriorityId,
            checklist_items: checklistItems,
            project_status_mapping_id: movedTask.project_status_mapping_id, // Always use the mapping from moveTaskToPhase
            task_type_key: selectedTaskType
          };
          resultTask = await updateTaskWithChecklist(movedTask.task_id, taskData);
        }
        onSubmit(resultTask);
        onClose();
      } else {
        // Create mode
        const taskData = {
          task_name: taskName,
          project_status_mapping_id: selectedStatusId,
          wbs_code: `${phase.wbs_code}.0`,
          description: description,
          assigned_to: finalAssignedTo,
          estimated_hours: Math.round(estimatedHours * 60), // Convert hours to minutes for storage
          actual_hours: Math.round(actualHours * 60), // Convert hours to minutes for storage
          due_date: dueDate || null, // Use selected due date or null
          priority_id: selectedPriorityId,
          phase_id: phase.phase_id,
          task_type_key: selectedTaskType
        };

        // Create the task first
        resultTask = await addTaskToPhase(phase.phase_id, taskData, checklistItems);

        if (resultTask) {
          try {
            // Add task resources
            for (const resource of tempTaskResources) {
              await addTaskResourceAction(resultTask.task_id, resource.additional_user_id);
            }
            
            // Add ticket links using the actual task ID and phase ID
            for (const link of pendingTicketLinks) {
              await addTicketLinkAction(phase.project_id, resultTask.task_id, link.ticket_id, phase.phase_id);
            }


            // Only submit and close after everything is done
            onSubmit(resultTask);
            onClose();
          } catch (error) {
            console.error('Error adding resources or linking tickets:', error);
            toast.error('Task created but failed to link some items');
            // Still submit the task even if linking fails
            onSubmit(resultTask);
            onClose();
          }
        }
      }
    } catch (error) {
      console.error('Error saving task:', error);
      toast.error('Failed to save task');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePhaseChange = (phaseId: string) => {
    if (!phases) return;
    
    const newPhase = phases.find(p => p.phase_id === phaseId);
    if (newPhase && newPhase.phase_id !== phase.phase_id) {
      setSelectedPhase(newPhase);
      setShowMoveConfirmation(true);
    }
  };

  const hasChanges = (): boolean => {
    if (mode === 'create') {
      // For new tasks, only show confirmation if user has entered any data
      if (taskName.trim() !== '') return true;
      if (description.trim() !== '') return true;
      if (assignedUser !== null && assignedUser !== currentUserId) return true; // Only if explicitly selected
      if (checklistItems.length > 0) return true;
      if (estimatedHours > 0) return true; // Only if actually entered a value
      if (actualHours > 0) return true; // Only if actually entered a value
      if (dueDate !== undefined) return true;
      if (tempTaskResources.length > 0) return true;
      if (pendingTicketLinks.length > 0) return true;
      if (selectedPriorityId !== null) return true; // User explicitly selected a priority
      if (selectedTaskType !== initialTaskType) return true; // Only if changed from initial value
      return false; // No changes detected
    }
    
    // Compare all form fields with their original values for edit mode
    if (!task) return false;

    if (taskName !== task.task_name) return true;
    if (description !== task.description) return true;
    if (selectedPhaseId !== task.phase_id) return true;
    if (selectedStatusId !== task.project_status_mapping_id) return true;
    if (estimatedHours !== Number(task.estimated_hours) / 60) return true;
    if (actualHours !== Number(task.actual_hours) / 60) return true;
    if (assignedUser !== task.assigned_to) return true;
    if (selectedPriorityId !== task.priority_id) return true;

    // Compare checklist items
    if (checklistItems.length !== task.checklist_items?.length) return true;
    for (let i = 0; i < checklistItems.length; i++) {
      const current = checklistItems[i];
      const original = task.checklist_items?.[i];
      if (!original) return true;
      if (current.item_name !== original.item_name) return true;
      if (current.completed !== original.completed) return true;
    }

    // Compare resources
    const currentResources = task.task_id ? taskResources : tempTaskResources;
    const initialResourcesLength = task.task_id ? taskResources.length : 0;
    if (currentResources.length !== initialResourcesLength) return true;

    if (task.task_id && taskResources.length > 0) {
      const sortedCurrentResources = [...taskResources].sort((a, b) =>
        a.additional_user_id.localeCompare(b.additional_user_id)
      );
      const sortedInitialResources = [...taskResources].sort((a, b) =>
        a.additional_user_id.localeCompare(b.additional_user_id)
      );
      for (let i = 0; i < sortedCurrentResources.length; i++) {
        if (sortedCurrentResources[i].additional_user_id !== sortedInitialResources[i].additional_user_id) return true;
      }
    }

    // Compare ticket links - only compare ticket IDs since other fields might differ in format
    const currentTicketIds = new Set(pendingTicketLinks.map((link): string => link.ticket_id));
    const originalTicketIds = new Set(task.ticket_links?.map((link): string => link.ticket_id) || []);
    
    if (currentTicketIds.size !== originalTicketIds.size) return true;
    for (const id of currentTicketIds) {
      if (!originalTicketIds.has(id)) return true;
    }

    return false;
  };

  const handleCancelClick = (e?: React.MouseEvent | boolean) => {
    // If called from Dialog's onOpenChange, e will be false
    if (typeof e === 'boolean' && !e) {
      if (hasChanges()) {
        setShowCancelConfirm(true);
      } else {
        onClose();
      }
      return;
    }
    
    // Original mouse event handling
    if (e && typeof e !== 'boolean') {
      e.preventDefault();
    }
    
    if (hasChanges()) {
      setShowCancelConfirm(true);
    } else {
      onClose();
    }
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

  const addChecklistItem = (): string => {
    const newItemId = `temp-${Date.now()}`;
    const newItem: Omit<ITaskChecklistItem, 'tenant'> = {
      checklist_item_id: newItemId,
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
    setChecklistItems((items) => [...items, newItem]);
    return newItemId;
  };

  const handleChecklistItemKeyDown = (
    e: React.KeyboardEvent<HTMLTextAreaElement>
  ) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const newId = addChecklistItem();
      setEditingChecklistItemId(newId);
    }
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

  const handleAddTimeEntry = async () => {
    if (!task?.task_id) {
      toast.error('Please save the task before adding time entries');
      return;
    }

    try {
      const currentUser = await getCurrentUser();
      if (!currentUser) {
        toast.error('No user session found');
        return;
      }

      const currentTimePeriod = await getCurrentTimePeriod();

      if (!currentTimePeriod) {
        toast.error('No active time period found. Please contact your administrator.');
        return;
      }

      const timeSheet = await fetchOrCreateTimeSheet(currentUser.user_id, currentTimePeriod.period_id);
      if (!timeSheet) {
        toast.error('Unable to add time entry: Failed to create or fetch time sheet');
        return;
      }

      const workItem: Omit<IWorkItem, 'tenant'> & {
        project_name?: string;
        phase_name?: string;
        task_name?: string;
      } = {
        work_item_id: task.task_id,
        type: 'project_task' as WorkItemType,
        name: `${task.task_name}`,
        description: '',  // Don't copy task description to time entry notes
        project_name: phase.phase_name, // Using phase name as a placeholder
        phase_name: phase.phase_name,
        task_name: task.task_name
      };

      openDrawer(
        <TimeEntryDialog
          isOpen={true}
          onClose={closeDrawer}
          onSave={async (timeEntry) => {
            try {
              await saveTimeEntry({
                ...timeEntry,
                time_sheet_id: timeSheet.id,
                user_id: currentUser.user_id,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                approval_status: 'DRAFT',
                work_item_type: 'project_task',
                work_item_id: task.task_id!
              });
              toast.success('Time entry saved successfully');
              closeDrawer();
            } catch (error) {
              console.error('Error saving time entry:', error);
              toast.error('Failed to save time entry');
            }
          }}
          workItem={workItem}
          date={new Date()}
          timePeriod={currentTimePeriod}
          timeSheetId={timeSheet.id}
          isEditable={true}
          inDrawer={true}
        />
      );
    } catch (error) {
      console.error('Error preparing time entry:', error);
      toast.error('Failed to prepare time entry. Please try again.');
    }
  };

  const handleAddAgent = async (userId: string) => {
    try {
      if (task?.task_id) {
        await addTaskResourceAction(task.task_id, userId);
        const updatedResources = await getTaskResourcesAction(task.task_id);
        setTaskResources(updatedResources);
      } else {
        // For new tasks, store resources temporarily
        const selectedUser = users.find(u => u.user_id === userId);
        if (selectedUser) {
          const tempResource = {
            additional_user_id: userId,
            first_name: selectedUser.first_name,
            last_name: selectedUser.last_name,
            assignment_id: `temp-${Date.now()}`
          };
          setTempTaskResources(prev => [...prev, tempResource]);
        }
      }
      setShowAgentPicker(false);
    } catch (error) {
      console.error('Error adding agent:', error);
      toast.error('Failed to add agent');
    }
  };

  const handleRemoveAgent = async (assignmentId: string) => {
    try {
      if (task?.task_id) {
        await removeTaskResourceAction(assignmentId);
        setTaskResources(taskResources.filter(r => r.assignment_id !== assignmentId));
      } else {
        setTempTaskResources(prev => prev.filter(r => r.assignment_id !== assignmentId));
      }
    } catch (error) {
      console.error('Error removing agent:', error);
      toast.error('Failed to remove agent');
    }
  };

  // Placeholder handler for the duplicate dropdown
  const handleDuplicateTreeSelectChange = (
    value: string,
    type: ProjectTreeTypes,
    excluded: boolean,
    path?: TreeSelectPath
  ) => {
    if (!path || !task) return; // Need the original task in edit mode
    const targetPhaseId = path['phase'];
    const targetStatusId = path['status'] || null;
 
    if (targetPhaseId) {
      console.log("Duplicate destination selected:", targetPhaseId, "Status:", targetStatusId);
      setSelectedDuplicatePhaseId(targetPhaseId);

      // Find target phase name from tree data (similar to move logic)
      const findPhaseName = (options: TreeSelectOption<ProjectTreeTypes>[], id: string): string | undefined => {
        for (const opt of options) {
          if (opt.type === 'phase' && opt.value === id) return opt.label;
          if (opt.children) {
            const found = findPhaseName(opt.children, id);
            if (found) return found;
          }
        }
        return undefined;
      };
      const targetPhaseName = findPhaseName(projectTreeOptions, targetPhaseId) || 'Unknown Phase';

      // Prepare details for the confirmation dialog
      const details = {
        originalTaskId: task.task_id,
        originalTaskName: task.task_name,
        targetPhaseId: targetPhaseId,
        targetPhaseName: targetPhaseName,
        targetStatusId: targetStatusId, // Store the target status ID
        hasChecklist: (task.checklist_items?.length || checklistItems.length) > 0,
        hasPrimaryAssignee: !!(task.assigned_to || assignedUser),
        additionalAssigneeCount: (task.task_id ? taskResources : tempTaskResources).length,
        ticketLinkCount: pendingTicketLinks.length,
      };

      console.log("Duplicate Task Details:", details);
      setDuplicateTaskDetails(details);
      setShowDuplicateConfirm(true);

      setTimeout(() => {
        setSelectedDuplicatePhaseId(null);
      }, 0);
    }
  };

  const renderContent = () => (
    <div className="h-full">
      {mode === 'edit' && (
        <div className="flex justify-end mb-4">
          <Button
            id='add-time-entry-button'
            type="button"
            variant="default"
            onClick={handleAddTimeEntry}
            disabled={isSubmitting || !task?.task_id}
          >
            <Clock className="h-4 w-4 mr-2" />
            Add Time Entry
          </Button>
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex flex-col h-full" noValidate>
        {hasAttemptedSubmit && validationErrors.length > 0 && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>
              <p className="font-medium mb-2">Please fill in the required fields:</p>
              <ul className="list-disc list-inside space-y-1">
                {validationErrors.map((err, index) => (
                  <li key={index}>{err}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
        <div className="space-y-4">
          <TextArea
                  value={taskName}
                  onChange={(e) => {
                    setTaskName(e.target.value);
                    clearErrorIfSubmitted();
                  }}
                  placeholder="Title... *"
                  className={`w-full text-2xl font-bold p-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 ${
                    hasAttemptedSubmit && !taskName.trim() ? 'border-red-500' : 'border-gray-300'
                  }`}
                  rows={1}
                />

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Task Type</label>
                    <TaskTypeSelector
                      value={selectedTaskType}
                      taskTypes={taskTypes}
                      onChange={setSelectedTaskType}
                      disabled={isSubmitting}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                    <CustomSelect
                      value={selectedPriorityId || ''}
                      options={priorities.map(p => ({
                        value: p.priority_id,
                        label: p.priority_name,
                        color: p.color
                      }))}
                      onValueChange={(value) => setSelectedPriorityId(value || null)}
                      placeholder="Select priority"
                      className="w-full"
                    />
                  </div>
                </div>

                {mode === 'edit' && (
                  <div className="flex gap-4 w-full"> {/* Container for side-by-side dropdowns */}
                    {/* Move To Dropdown */}
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Move to</label>
                      {projectTreeOptions.length > 0 ? (
                        <TreeSelect<ProjectTreeTypes>
                          value={selectedPhaseId}
                          onValueChange={handleTreeSelectChange}
                          options={projectTreeOptions}
                          placeholder="Select move destination..."
                          className="w-full"
                          multiSelect={false}
                          showExclude={false}
                          showReset={false}
                          allowEmpty={false}
                        />
                      ) : (
                        <div className="text-sm text-gray-500">Loading...</div>
                      )}
                    </div>

                    {/* Duplicate To Dropdown */}
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Duplicate to</label>
                      {projectTreeOptions.length > 0 ? (
                        <TreeSelect<ProjectTreeTypes>
                          value={selectedDuplicatePhaseId || ''}
                          onValueChange={handleDuplicateTreeSelectChange}
                          options={projectTreeOptions}
                          placeholder="Select duplicate destination..."
                          className="w-full"
                          multiSelect={false}
                          showExclude={false}
                          showReset={false}
                          allowEmpty={true}
                        />
                      ) : (
                        <div className="text-sm text-gray-500">Loading...</div>
                      )}
                    </div>
                  </div>
                )}
                <TextArea
                  value={description}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
                  placeholder="Description"
                  className="w-full max-w-4xl p-2 border border-gray-300 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 whitespace-pre-wrap break-words"
                  rows={3}
                />

                <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
                  <DatePicker
                    value={dueDate}
                    onChange={setDueDate}
                    id="task-due-date-picker"
                    label="Task Due Date"
                    placeholder="Select due date"
                    required={true}
                    disabled={isSubmitting}
                  />
                </div>
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
                <div className="space-y-4">
                  <UserPicker
                    label="Assigned To"
                    value={assignedUser ?? ''}
                    onValueChange={(value) => {
                      // Only set to null if explicitly choosing "Not assigned"
                      setAssignedUser(value === '' ? null : value);
                    }}
                    size="sm"
                    users={users.filter(u => 
                      !(task?.task_id ? taskResources : tempTaskResources)
                        .some(r => r.additional_user_id === u.user_id)
                    )}
                  />


                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <h3 className="font-semibold">Additional Agents</h3>
                      <Button
                        id='add-agent-button'
                        type="button"
                        variant="soft"
                        onClick={() => setShowAgentPicker(true)}
                        className="w-fit"
                      >
                        <UserPlus className="h-4 w-4 mr-2" />
                        Add Agent
                      </Button>
                    </div>
                    <div className="space-y-2">
                      {(task?.task_id ? taskResources : tempTaskResources).map((resource): JSX.Element => (
                        <div key={resource.assignment_id} className="flex items-center justify-between bg-gray-50 p-2 rounded">
                          <div className="flex items-center gap-2">
                            <AvatarIcon
                              userId={resource.additional_user_id}
                              firstName={resource.first_name}
                              lastName={resource.last_name}
                              size="sm"
                            />
                            <span>{resource.first_name} {resource.last_name}</span>
                          </div>
                          <Button
                            id='remove-agent-button'
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveAgent(resource.assignment_id)}
                            className="text-red-500 hover:text-red-700"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {mode === 'edit' && task?.task_id && (
                  <div>
                    <h3 className="font-semibold mb-2">Tags</h3>
                    <TagManager
                      id="task-tags-edit"
                      entityId={task.task_id}
                      entityType="project_task"
                      initialTags={taskTags}
                      onTagsChange={setTaskTags}
                    />
                  </div>
                )}

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
                    <div key={index} className="flex items-center gap-2 w-full">
                      {isEditingChecklist || editingChecklistItemId === item.checklist_item_id ? (
                        <>
                          <Checkbox
                            checked={item.completed}
                            onChange={(e) => updateChecklistItem(index, 'completed', e.target.checked)}
                            className="flex-none"
                          />
                          <div className="flex-1">
                            <TextArea
                              value={item.item_name}
                              onChange={(e) => updateChecklistItem(index, 'item_name', e.target.value)}
                              placeholder="Checklist item"
                              className="w-full"
                              onBlur={() => setEditingChecklistItemId(null)} // Stop editing when focus is lost
                              autoFocus={editingChecklistItemId === item.checklist_item_id}
                              onKeyDown={handleChecklistItemKeyDown}
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => removeChecklistItem(index)}
                            className="text-red-500 flex-none"
                          >
                            Remove
                          </button>
                        </>
                      ) : (
                        <>
                          <Checkbox
                            checked={item.completed}
                            onChange={(e) => updateChecklistItem(index, 'completed', e.target.checked)}
                            className="flex-none"
                          />
                          <span
                            className={`flex-1 whitespace-pre-wrap ${item.completed ? 'line-through text-gray-500' : ''}`}
                            onClick={() => setEditingChecklistItemId(item.checklist_item_id)} // Start editing when clicked
                          >
                            {item.item_name}
                          </span>
                        </>
                      )}
                    </div>
                  ))}
                </div>

                {isEditingChecklist && (
                  <Button id='add-checklist-item-button' type="button" variant="soft" onClick={addChecklistItem}>
                    Add an item
                  </Button>
                )}

            {mode === 'edit' && task && (
              <TaskDependencies
                task={task}
                allTasksInProject={allProjectTasks}
                taskTypes={taskTypes}
                initialPredecessors={taskDependencies.predecessors}
                initialSuccessors={taskDependencies.successors}
                users={users}
                phases={phases}
                refreshDependencies={async () => {
                  try {
                    const dependencies = await getTaskDependencies(task.task_id);
                    setTaskDependencies(dependencies);
                  } catch (error) {
                    console.error('Error refreshing dependencies:', error);
                  }
                }}
              />
            )}

            <TaskTicketLinks
              taskId={task?.task_id || undefined}
              phaseId={phase.phase_id}
              projectId={phase.project_id}
              initialLinks={task?.ticket_links}
              users={users}
              onLinksChange={setPendingTicketLinks}
            />

                <div className="flex justify-between mt-6">
                  <div className="flex gap-2">
                    {/* Only show Cancel button if not in drawer */}
                    {!inDrawer && (
                      <Button
                        id='cancel-button'
                        type="button"
                        variant="ghost"
                        onClick={handleCancelClick}
                        disabled={isSubmitting}
                      >
                        Cancel
                      </Button>
                    )}
                    {mode === 'edit' && !inDrawer && (
                      <Button
                        id='delete-button'
                        type="button"
                        variant="destructive"
                        onClick={() => setShowDeleteConfirm(true)}
                        disabled={isSubmitting}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button id='save-button' type="submit" disabled={isSubmitting} className={!taskName.trim() ? 'opacity-50' : ''}>
                      {isSubmitting ? (mode === 'edit' ? 'Updating...' : 'Adding...') : (mode === 'edit' ? 'Update' : 'Save')}
                    </Button>
                  </div>
                </div>
        </div>
      </form>
    </div>
  );

  return (
    <>
      {inDrawer ? (
        renderContent()
      ) : (
        <Dialog 
          isOpen={true} 
          onClose={handleCancelClick}
          className="max-w-2xl max-h-[90vh] overflow-y-auto"
          title={mode === 'create' ? 'Add New Task' : 'Edit Task'}
        >
          <DialogContent>
            {renderContent()}
          </DialogContent>
        </Dialog>
      )}

      <ConfirmationDialog
        isOpen={showCancelConfirm}
        onClose={handleCancelDismiss}
        onConfirm={handleCancelConfirm}
        title="Cancel Edit"
        message="Are you sure you want to cancel? Any unsaved changes will be lost."
        confirmLabel="Discard changes"
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
          message={`Are you sure you want to move task "${taskName}" to phase "${selectedPhase.phase_name}"?`}
          confirmLabel="Move"
          cancelLabel="Cancel"
        />
      )}

      {/* Render Duplicate Confirmation Dialog */}
      {duplicateTaskDetails && (
        <DuplicateTaskDialog
          isOpen={showDuplicateConfirm}
          onClose={() => {
            setShowDuplicateConfirm(false);
            setDuplicateTaskDetails(null);
          }}
          taskDetails={duplicateTaskDetails}
          projectTreeData={projectTreeOptions}
          initialTargetPhaseId={duplicateTaskDetails.targetPhaseId}
          initialTargetStatusId={duplicateTaskDetails.targetStatusId}
          onConfirm={async (targetPhaseId: string, options: DuplicateOptions) => {
            if (!duplicateTaskDetails) return;
            console.log("Duplicate confirmed for phase:", targetPhaseId, "with options:", options);
            setIsSubmitting(true);
            try {
              const duplicatedTask = await duplicateTaskToPhase(
                duplicateTaskDetails.originalTaskId,
                targetPhaseId,
                options
              );
              toast.success(`Task "${duplicateTaskDetails.originalTaskName}" duplicated successfully!`);
              setShowDuplicateConfirm(false);
              setDuplicateTaskDetails(null);
              onSubmit(duplicatedTask);
              onClose();
            } catch (error) {
              console.error("Error duplicating task:", error);
              toast.error("Failed to duplicate task.");
              setShowDuplicateConfirm(false);
              setDuplicateTaskDetails(null);
            } finally {
               setIsSubmitting(false);
            }
          }}
        />
      )}

      <Dialog 
        isOpen={showAgentPicker} 
        onClose={() => setShowAgentPicker(false)}
        title="Add Additional Agent"
        className="max-w-md"
      >
        <DialogContent>
            <div className="space-y-4">
              <UserPicker
                value=""
                onValueChange={handleAddAgent}
                users={users.filter(u => 
                  (!assignedUser ? u.user_id !== currentUserId : true) && 
                  u.user_id !== assignedUser && 
                  !(task?.task_id ? taskResources : tempTaskResources)
                    .some(r => r.additional_user_id === u.user_id)
                )}
                size="sm"
              />
              <div className="flex justify-end space-x-2">
                <Button id='cancel-button' variant="ghost" onClick={() => setShowAgentPicker(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </DialogContent>
      </Dialog>
    </>
  );
}
