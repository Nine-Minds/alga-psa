'use client';

import React, { useState, useEffect, useRef } from 'react';
import { IProjectPhase, IProjectTask, ITaskChecklistItem, ProjectStatus, IProjectTicketLinkWithDetails, IProjectTaskDependency } from '@alga-psa/types';
import { IUser } from '@shared/interfaces/user.interfaces';
import { IPriority } from '@alga-psa/types';
import { ITag } from '@alga-psa/types';
import UserAvatar from '@alga-psa/ui/components/UserAvatar';
import { getProjectTreeData, getProjectDetails } from '../actions/projectActions';
import { getAllPriorities } from '@alga-psa/reference-data/actions';
import { getServices } from '@alga-psa/projects/actions/serviceCatalogActions';
import { IService } from '@alga-psa/types';
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
  getTaskDependencies,
  addTaskDependency
} from '../actions/projectTaskActions';
import { getCurrentUser, getUserAvatarUrlsBatchAction } from '@alga-psa/users/actions';
import { findTagsByEntityId, createTagsForEntity } from '@alga-psa/tags/actions';
import { QuickAddTagPicker, TagManager } from '@alga-psa/tags/components';
import type { PendingTag } from '@alga-psa/types';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { ListChecks, Trash2, Clock, Ticket } from 'lucide-react';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import MultiUserPicker from '@alga-psa/ui/components/MultiUserPicker';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import DuplicateTaskDialog, { DuplicateOptions } from './DuplicateTaskDialog';
import { Input } from '@alga-psa/ui/components/Input';
import { toast } from 'react-hot-toast';
import { TaskTypeSelector } from './TaskTypeSelector';
import { getTaskTypes } from '../actions/projectTaskActions';
import { ITaskType } from '@alga-psa/types';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import TaskTicketLinks from './TaskTicketLinks';
import { TaskDependencies, TaskDependenciesRef } from './TaskDependencies';
import TaskDocumentsSimple, { PendingTaskDocument } from './TaskDocumentsSimple';
import TaskCommentThread from './TaskCommentThread';
import { createDocumentAssociations, deleteDocument, removeDocumentAssociations } from '@alga-psa/documents/actions/documentActions';
import { SearchableSelect } from '@alga-psa/ui/components/SearchableSelect';
import TreeSelect, { TreeSelectOption, TreeSelectPath } from '@alga-psa/ui/components/TreeSelect';
import { PrioritySelect } from '@alga-psa/tickets/components/PrioritySelect';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { useDrawer } from '@alga-psa/ui';
import { useSchedulingCallbacks } from '@alga-psa/ui/context';
import { IExtendedWorkItem, WorkItemType } from '@alga-psa/types';
import TaskStatusSelect from './TaskStatusSelect';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import PrefillFromTicketDialog from './PrefillFromTicketDialog';
import { TaskPrefillFields } from '../lib/taskTicketMapping';
import { buildTaskTimeEntryContext } from '../lib/timeEntryContext';

type ProjectTreeTypes = 'project' | 'phase' | 'status';

export interface TaskFormPrefillData extends TaskPrefillFields {
  pendingTicketLink?: IProjectTicketLinkWithDetails | null;
}

interface TaskFormProps {
  task?: IProjectTask;
  phase: IProjectPhase;
  phases?: IProjectPhase[];
  onClose: () => void;
  onSubmit: (task: IProjectTask | null) => void;
  projectStatuses: ProjectStatus[];
  defaultStatus?: ProjectStatus;
  users: IUser[];
  mode: 'create' | 'edit';
  onPhaseChange: (phaseId: string) => void;
  inDrawer?: boolean;
  projectTreeData?: any[]; // Add projectTreeData prop
  prefillData?: TaskFormPrefillData;
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
  projectTreeData = [],
  prefillData
}: TaskFormProps): React.JSX.Element {
  const dependenciesRef = useRef<TaskDependenciesRef>(null);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [taskName, setTaskName] = useState(task?.task_name || prefillData?.task_name || '');
  const [description, setDescription] = useState(task?.description || prefillData?.description || '');
  const [projectTreeOptions, setProjectTreeOptions] = useState<Array<TreeSelectOption<'project' | 'phase' | 'status'>>>([]);
  const [selectedPhaseId, setSelectedPhaseId] = useState<string>(phase.phase_id);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checklistItems, setChecklistItems] = useState<Omit<ITaskChecklistItem, 'tenant'>[]>(task?.checklist_items || []);
  const [isEditingChecklist, setIsEditingChecklist] = useState(false);
  const [assignedUser, setAssignedUser] = useState<string | null>(task?.assigned_to ?? prefillData?.assigned_to ?? null);
  const [selectedPhase, setSelectedPhase] = useState<IProjectPhase>(phase);
  const [showMoveConfirmation, setShowMoveConfirmation] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showDocumentCleanupConfirm, setShowDocumentCleanupConfirm] = useState(false);
  const [isDeletingDocuments, setIsDeletingDocuments] = useState(false);
  const [tempTaskId] = useState<string>(`temp-${Date.now()}`);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const { launchTimeEntry } = useSchedulingCallbacks();
  // Convert from minutes to hours for display
  const [estimatedHours, setEstimatedHours] = useState<number>(
    task?.estimated_hours !== undefined && task?.estimated_hours !== null
      ? Number(task?.estimated_hours) / 60
      : prefillData?.estimated_hours ?? 0
  );
  const [actualHours, setActualHours] = useState<number>(Number(task?.actual_hours) / 60 || 0);
  const [dueDate, setDueDate] = useState<Date | undefined>(
    task?.due_date
      ? new Date(task.due_date)
      : prefillData?.due_date ?? undefined
  );
  const [taskResources, setTaskResources] = useState<any[]>(task?.task_id ? [] : []);
  const [initialTaskResources, setInitialTaskResources] = useState<any[]>([]);
  const [resourcesLoaded, setResourcesLoaded] = useState(false); // Track if resources have been loaded
  const [tempTaskResources, setTempTaskResources] = useState<any[]>([]);
  const [pendingDocuments, setPendingDocuments] = useState<PendingTaskDocument[]>([]);
  // Track documents added during edit session (for cleanup on cancel)
  const [sessionAddedDocuments, setSessionAddedDocuments] = useState<PendingTaskDocument[]>([]);

  // Ref to prevent race conditions when rapidly adding/removing agents
  const isProcessingAgentsRef = useRef(false);
  const [taskTags, setTaskTags] = useState<ITag[]>([]);
  const [pendingTags, setPendingTags] = useState<PendingTag[]>([]);
  const [pendingTicketLinks, setPendingTicketLinks] = useState<IProjectTicketLinkWithDetails[]>(() => {
    if (task?.ticket_links?.length) return task.ticket_links;
    if (prefillData?.pendingTicketLink) return [prefillData.pendingTicketLink];
    return [];
  });
  const [editingChecklistItemId, setEditingChecklistItemId] = useState<string | null>(null);
  const [isCrossProjectMove, setIsCrossProjectMove] = useState<boolean>(false);
  const [selectedDuplicatePhaseId, setSelectedDuplicatePhaseId] = useState<string | null>(null);
  const [showDuplicateConfirm, setShowDuplicateConfirm] = useState(false); // State for duplicate dialog
  const [showDependencyConfirmation, setShowDependencyConfirmation] = useState(false);
  const [pendingSubmit, setPendingSubmit] = useState<React.FormEvent | null>(null);
  const [showPrefillDialog, setShowPrefillDialog] = useState(false);
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
  const [priorities, setPriorities] = useState<IPriority[]>([]);
  const [selectedPriorityId, setSelectedPriorityId] = useState<string | null>(task?.priority_id ?? null);
  const [availableServices, setAvailableServices] = useState<IService[]>([]);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(task?.service_id ?? null);
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

  const handlePrefillFromTicket = (payload: {
    prefillData: TaskFormPrefillData;
    ticket: {
      ticket_id: string;
      ticket_number: string;
      title: string;
      status_name?: string;
      is_closed?: boolean;
      closed_at?: string | null;
    };
    shouldLink: boolean;
  }) => {
    const { prefillData, ticket, shouldLink } = payload;
    setTaskName(prefillData.task_name);
    setDescription(prefillData.description);
    setAssignedUser(prefillData.assigned_to);
    setDueDate(prefillData.due_date ?? undefined);
    setEstimatedHours(prefillData.estimated_hours);

    if (shouldLink) {
      setPendingTicketLinks((prev) => {
        const exists = prev.some(link => link.ticket_id === ticket.ticket_id);
        if (exists) return prev;
        const newLink: IProjectTicketLinkWithDetails = {
          link_id: `temp-${Date.now()}`,
          task_id: 'temp',
          ticket_id: ticket.ticket_id,
          ticket_number: ticket.ticket_number,
          title: ticket.title,
          created_at: new Date(),
          project_id: phase.project_id,
          phase_id: phase.phase_id,
          status_name: ticket.status_name || 'New',
          is_closed: ticket.is_closed ?? ticket.closed_at != null
        };
        return [...prev, newLink];
      });
    }
  };

  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const user = await getCurrentUser();
        if (user) {
          setCurrentUserId(user.user_id);
        }

        // Fetch priorities for project tasks
        const allPriorities = await getAllPriorities('project_task');
        setPriorities(allPriorities);

        // Fetch task types
        const types = await getTaskTypes();
        setTaskTypes(types);

        // Fetch services for time entry prefill
        const servicesResponse = await getServices(1, 999);
        setAvailableServices(servicesResponse.services);

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

          // Always fetch resources to ensure we have the latest data
          const resources = await getTaskResourcesAction(task.task_id);
          setTaskResources(resources);
          setInitialTaskResources(resources); // Track initial state for hasChanges()
          setResourcesLoaded(true); // Mark resources as loaded

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

    // Check for unsaved dependency selection
    if (dependenciesRef.current?.hasPendingChanges()) {
      setPendingSubmit(e);
      setShowDependencyConfirmation(true);
      return;
    }

    await performSubmit();
  };

  const handleDependencyConfirm = async () => {
    // "Discard changes" — discard the pending dependency selection and save the task
    setShowDependencyConfirmation(false);
    setPendingSubmit(null);
    await performSubmit();
  };

  const handleDependencyCancel = () => {
    // "Continue editing" — go back so user can click the + button
    setShowDependencyConfirmation(false);
    setPendingSubmit(null);
  };

  const performSubmit = async () => {
    setIsSubmitting(true);

    try {
      let resultTask: IProjectTask | null = null;

      // Convert empty string to null for database
      const finalAssignedTo = !assignedUser || assignedUser === '' ? null : assignedUser;

      if (mode === 'edit' && task?.task_id) {
        // Check if phase or status actually changed
        const phaseChanged = task.phase_id !== selectedPhaseId;
        const statusChanged = task.project_status_mapping_id !== selectedStatusId;

        let taskToUpdate = task;

        // Only call moveTaskToPhase if phase or status actually changed
        if (phaseChanged || statusChanged) {
          // Phase or status changed - handle the move
          const movedTask = await moveTaskToPhase(
            task.task_id,
            selectedPhaseId,
            isCrossProjectMove ? undefined : selectedStatusId
          );

          if (movedTask) {
            taskToUpdate = movedTask;
            // For cross-project moves, use the status mapping that moveTaskToPhase determined
            if (isCrossProjectMove) {
              setSelectedStatusId(movedTask.project_status_mapping_id);
            }
          }
        }

        // Always update the task data (whether moved or not)
        const taskData: Partial<IProjectTask> = {
          task_name: taskName,
          description: description,
          assigned_to: finalAssignedTo,
          estimated_hours: Math.round(estimatedHours * 60), // Convert hours to minutes for storage
          actual_hours: Math.round(actualHours * 60), // Convert hours to minutes for storage
          due_date: dueDate || null,
          priority_id: selectedPriorityId,
          checklist_items: checklistItems,
          project_status_mapping_id: statusChanged ? taskToUpdate.project_status_mapping_id : task.project_status_mapping_id,
          task_type_key: selectedTaskType,
          order_key: task.order_key, // Always preserve the original order_key
          service_id: selectedServiceId
        };
        resultTask = await updateTaskWithChecklist(taskToUpdate.task_id, taskData);
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
          task_type_key: selectedTaskType,
          service_id: selectedServiceId
        };

        // Create the task first
        resultTask = await addTaskToPhase(phase.phase_id, taskData, checklistItems);

        if (resultTask) {
          let linkingFailed = false;
          try {
            // Add task resources
            for (const resource of tempTaskResources) {
              await addTaskResourceAction(resultTask.task_id, resource.additional_user_id);
            }

            // Add ticket links using the actual task ID and phase ID
            for (const link of pendingTicketLinks) {
              await addTicketLinkAction(phase.project_id, resultTask.task_id, link.ticket_id, phase.phase_id);
            }

            // Create document associations for pending documents
            if (pendingDocuments.length > 0) {
              const documentIds = pendingDocuments.map(d => d.document_id);
              await createDocumentAssociations(resultTask.task_id, 'project_task', documentIds);
            }

            // Save pending dependencies
            // Always pass new task as predecessor — addTaskDependency handles the swap for 'blocked_by'
            if (dependenciesRef.current) {
              const pendingDeps = dependenciesRef.current.getPendingDependencies();
              for (const dep of pendingDeps) {
                await addTaskDependency(resultTask.task_id, dep.targetTaskId, dep.dependencyType, 0, undefined);
              }
            }
          } catch (error) {
            console.error('Error adding resources or linking tickets:', error);
            toast.error('Task created but failed to link some items');
            linkingFailed = true;
          }

          // Create tags for the new task (always attempt, even if linking failed)
          let createdTags: typeof resultTask.tags = [];
          if (pendingTags.length > 0) {
            try {
              createdTags = await createTagsForEntity(resultTask.task_id, 'project_task', pendingTags);
              if (createdTags.length < pendingTags.length) {
                toast.error(`${pendingTags.length - createdTags.length} tag(s) could not be created`);
              }
            } catch (tagError) {
              console.error("Error creating task tags:", tagError);
            }
          }

          // Submit task with tags
          onSubmit({ ...resultTask, tags: createdTags });
          onClose();
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
      if (selectedServiceId !== null) return true; // User explicitly selected a service
      if (pendingTags.length > 0) return true;
      if (pendingDocuments.length > 0) return true; // User has added pending documents
      if (dependenciesRef.current?.getPendingDependencies()?.length) return true; // User has added pending dependencies
      return false; // No changes detected
    }

    // Compare all form fields with their original values for edit mode
    if (!task) return false;

    // Helper to normalize null/undefined/empty string for comparison
    const normalizeString = (val: string | null | undefined): string => val || '';
    const normalizeNullable = <T,>(val: T | null | undefined): T | null => val ?? null;

    if (taskName !== (task.task_name || '')) return true;
    if (normalizeString(description) !== normalizeString(task.description)) return true;
    if (selectedPhaseId !== task.phase_id) return true;
    if (selectedStatusId !== task.project_status_mapping_id) return true;
    // Use || 0 to handle null/undefined consistently with initial state
    if (estimatedHours !== (Number(task.estimated_hours) / 60 || 0)) return true;
    if (actualHours !== (Number(task.actual_hours) / 60 || 0)) return true;
    if (normalizeNullable(assignedUser) !== normalizeNullable(task.assigned_to)) return true;
    if (normalizeNullable(selectedPriorityId) !== normalizeNullable(task.priority_id)) return true;
    if (normalizeNullable(selectedServiceId) !== normalizeNullable(task.service_id)) return true;

    // Compare checklist items - use 0 as fallback for undefined length
    if (checklistItems.length !== (task.checklist_items?.length ?? 0)) return true;
    for (let i = 0; i < checklistItems.length; i++) {
      const current = checklistItems[i];
      const original = task.checklist_items?.[i];
      if (!original) return true;
      if (current.item_name !== original.item_name) return true;
      if (current.completed !== original.completed) return true;
    }

    // Compare resources - use initialTaskResources to compare against the loaded state
    // Only compare if resources have been loaded to avoid false positives during initial load
    if (task.task_id && resourcesLoaded) {
      // For existing tasks, compare current resources with initial resources
      if (taskResources.length !== initialTaskResources.length) return true;

      const currentUserIds = new Set(taskResources.map(r => r.additional_user_id));
      const initialUserIds = new Set(initialTaskResources.map(r => r.additional_user_id));

      if (currentUserIds.size !== initialUserIds.size) return true;
      for (const id of currentUserIds) {
        if (!initialUserIds.has(id)) return true;
      }
    }

    // Compare ticket links - only compare ticket IDs since other fields might differ in format
    const currentTicketIds = new Set(pendingTicketLinks.map((link): string => link.ticket_id));
    const originalTicketIds = new Set(task.ticket_links?.map((link): string => link.ticket_id) || []);

    if (currentTicketIds.size !== originalTicketIds.size) return true;
    for (const id of currentTicketIds) {
      if (!originalTicketIds.has(id)) return true;
    }

    // Check if documents were added during this edit session
    if (sessionAddedDocuments.length > 0) return true;

    return false;
  };

  const handleCancelClick = (e?: React.MouseEvent) => {
    if (e) {
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
    // Check for NEW documents (uploaded or created) that need cleanup prompt
    // Linked documents already existed in the system, so they don't need cleanup
    const docsToCleanup = mode === 'create' ? pendingDocuments : sessionAddedDocuments;
    const newDocsToCleanup = docsToCleanup.filter(d => d.type === 'uploaded' || d.type === 'block');
    if (newDocsToCleanup.length > 0) {
      setShowDocumentCleanupConfirm(true);
    } else {
      onClose();
    }
  };

  const handleCancelDismiss = () => {
    setShowCancelConfirm(false);
  };

  const handleDocumentCleanupKeep = () => {
    // Keep documents in the system, just close the form
    setShowDocumentCleanupConfirm(false);
    onClose();
  };

  const handleDocumentCleanupDelete = async () => {
    setIsDeletingDocuments(true);
    try {
      // Only process uploaded and created documents - linked docs are ignored
      const docsToDelete = mode === 'create'
        ? pendingDocuments.filter(d => d.type === 'uploaded' || d.type === 'block')
        : sessionAddedDocuments.filter(d => d.type === 'uploaded' || d.type === 'block');

      let failureCount = 0;
      for (const doc of docsToDelete) {
        try {
          if (mode === 'edit' && task?.task_id) {
            // In edit mode, first remove the association from the task
            await removeDocumentAssociations(task.task_id, 'project_task', [doc.document_id]);
          }
          // Delete the document from the system
          await deleteDocument(doc.document_id, currentUserId);
        } catch (error) {
          console.error(`Failed to delete document ${doc.document_id}:`, error);
          failureCount++;
        }
      }

      if (failureCount > 0) {
        toast.error(`${failureCount} document${failureCount !== 1 ? 's' : ''} could not be deleted and will remain in Documents`);
      }
    } finally {
      setIsDeletingDocuments(false);
      setShowDocumentCleanupConfirm(false);
      onClose();
    }
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
      const findProjectName = (options: Array<TreeSelectOption<'project' | 'phase' | 'status'>>, phaseId: string): string | undefined => {
        for (const option of options) {
          if (option.type === 'project' && option.children?.some(child => child.value === phaseId)) {
            return typeof option.label === 'string' ? option.label : undefined;
          }
          if (option.children) {
            const nested = findProjectName(option.children, phaseId);
            if (nested) return nested;
          }
        }
        return undefined;
      };

      const projectName = findProjectName(projectTreeOptions, selectedPhaseId);
      const serviceName = availableServices.find(service => service.service_id === selectedServiceId)?.service_name ?? null;

      await launchTimeEntry({
        openDrawer,
        closeDrawer,
        context: buildTaskTimeEntryContext({
          taskId: task.task_id,
          taskName: taskName || task.task_name,
          projectName,
          phaseName: selectedPhase.phase_name,
          serviceId: selectedServiceId,
          serviceName,
        }),
      });
    } catch (error) {
      console.error('Error preparing time entry:', error);
      toast.error('Failed to prepare time entry. Please try again.');
    }
  };

  const handleAddAgent = async (userId: string) => {
    try {
      if (!assignedUser) {
        toast.error('Please assign a primary agent first');
        return;
      }

      if (task?.task_id) {
        await addTaskResourceAction(task.task_id, userId);
        const updatedResources = await getTaskResourcesAction(task.task_id);
        setTaskResources(updatedResources);
        toast.success('Agent added successfully');
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
          toast.success('Agent will be added when task is saved');
        }
      }
    } catch (error: any) {
      console.error('Error adding agent:', error);
      if (error.message?.includes('assigned_to')) {
        toast.error('Please assign a primary agent first');
      } else {
        toast.error(`Failed to add agent: ${error.message || 'Unknown error'}`);
      }
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
          if (opt.type === 'phase' && opt.value === id) {
            // Handle both string and ReactNode labels
            if (typeof opt.label === 'string') {
              return opt.label;
            } else if (React.isValidElement(opt.label) && (opt.label.props as { children?: React.ReactNode }).children) {
              // Extract text from JSX element
              const children = (opt.label.props as { children?: React.ReactNode }).children;
              if (typeof children === 'string') {
                return children;
              } else if (Array.isArray(children)) {
                const textContent = children.find(child => typeof child === 'string');
                if (textContent) return textContent;
              }
            }
            return 'Unknown Phase';
          }
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
      {mode === 'create' && (
        <PrefillFromTicketDialog
          open={showPrefillDialog}
          onOpenChange={setShowPrefillDialog}
          onPrefill={handlePrefillFromTicket}
        />
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
          {/* Full width Title with Status dropdown */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <label className="block text-sm font-medium text-gray-700">Task Name *</label>
                {mode === 'create' && (
                  <Tooltip content="Create from ticket">
                    <Button
                      id="task-create-from-ticket"
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowPrefillDialog(true)}
                    >
                      <Ticket className="h-4 w-4" />
                    </Button>
                  </Tooltip>
                )}
              </div>
              <TaskStatusSelect
                id="task-status-select"
                value={selectedStatusId}
                statuses={projectStatuses}
                onValueChange={setSelectedStatusId}
                disabled={isSubmitting}
              />
            </div>
            <TextArea
              value={taskName}
              onChange={(e) => {
                setTaskName(e.target.value);
                clearErrorIfSubmitted();
              }}
              placeholder="Enter task name..."
              className={`w-full text-2xl font-bold p-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 ${
                hasAttemptedSubmit && !taskName.trim() ? 'border-red-500' : 'border-gray-300'
              }`}
              rows={1}
            />
          </div>

          {/* Full width Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <TextArea
              value={description}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
              placeholder="Add task description..."
              className="w-full p-2 border border-gray-300 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 whitespace-pre-wrap break-words"
              rows={3}
            />
          </div>

          {/* Service (for time entry prefill) - right under description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Service (for time entries)
            </label>
            <SearchableSelect
              id="task-service-select"
              value={selectedServiceId || ''}
              onChange={(value) => setSelectedServiceId(value || null)}
              options={[
                { value: '', label: 'No service' },
                ...availableServices.map(s => ({
                  value: s.service_id,
                  label: s.service_name
                }))
              ]}
              placeholder="Select service for time entry prefill..."
              className="w-full"
              dropdownMode="overlay"
            />
            <p className="text-xs text-gray-500 mt-1">
              When set, this service will be automatically selected when creating time entries from this task.
            </p>
          </div>

          {/* 2 Column Grid Section */}
          <div className="grid grid-cols-2 gap-4">
            {/* Row 1: Task Type and Priority */}
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
              <PrioritySelect
                value={selectedPriorityId}
                options={priorities
                  .sort((a, b) => a.order_number - b.order_number)
                  .map(p => ({
                    value: p.priority_id,
                    label: p.priority_name,
                    color: p.color
                  }))}
                onValueChange={(value) => setSelectedPriorityId(value || null)}
                placeholder="Select priority"
                className="w-full"
              />
            </div>

            {/* Row 2: Move To and Duplicate To (Edit mode only) */}
            {mode === 'edit' && (
              <>
                <div>
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
                <div>
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
              </>
            )}

            {/* Row 3: Created At (Edit mode only) and Due Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Created At</label>
              {mode === 'edit' && task ? (
                <div className="p-2 bg-gray-50 border border-gray-200 rounded-md text-gray-700">
                  {new Date(task.created_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </div>
              ) : (
                <div className="p-2 bg-gray-50 border border-gray-200 rounded-md text-gray-500">
                  Will be set on creation
                </div>
              )}
            </div>
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

            {/* Row 4: Estimated Hours and Actual Hours */}
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
            {/* Row 5: Assigned To and Additional Agents in one row */}
            <div className="col-span-2">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Assigned To</label>
                  <UserPicker
                    label=""
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
                    getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Additional Agents</label>
                  {!assignedUser ? (
                    <div className="text-sm text-gray-500 italic p-2 bg-gray-50 rounded">
                      Please assign a primary agent first.
                    </div>
                  ) : mode === 'edit' && task?.assigned_to !== assignedUser ? (
                    <div className="text-sm text-gray-500 italic p-2 bg-gray-50 rounded">
                      Save task after changing primary agent.
                    </div>
                  ) : (
                    <MultiUserPicker
                      id="task-additional-agents"
                      values={(task?.task_id ? taskResources : tempTaskResources).map(r => r.additional_user_id)}
                      getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
                      onValuesChange={async (newUserIds) => {
                        // Prevent race conditions from rapid clicks
                        if (isProcessingAgentsRef.current) {
                          return;
                        }
                        isProcessingAgentsRef.current = true;

                        try {
                          const currentResources = task?.task_id ? taskResources : tempTaskResources;
                          const currentUserIds = currentResources.map(r => r.additional_user_id);

                          // Find added users
                          const addedUserIds = newUserIds.filter(id => !currentUserIds.includes(id));
                          // Find removed users
                          const removedUserIds = currentUserIds.filter(id => !newUserIds.includes(id));

                          // Process all additions sequentially
                          for (const userId of addedUserIds) {
                            await handleAddAgent(userId);
                          }

                          // Process all removals sequentially
                          for (const userId of removedUserIds) {
                            const resource = currentResources.find(r => r.additional_user_id === userId);
                            if (resource) {
                              await handleRemoveAgent(resource.assignment_id);
                            }
                          }
                        } finally {
                          isProcessingAgentsRef.current = false;
                        }
                      }}
                      users={users.filter(u => u.user_id !== assignedUser)}
                      size="sm"
                      placeholder="Select additional agents..."
                    />
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Full width Tags section */}
          {mode === 'edit' && task?.task_id ? (
            <div>
              <h3 className="font-semibold mb-2">Tags</h3>
              <TagManager
                id="task-tags-edit"
                entityId={task.task_id}
                entityType="project_task"
                initialTags={taskTags}
                onTagsChange={setTaskTags}
                useInlineInput={true}
              />
            </div>
          ) : mode === 'create' && (
            <div>
              <h3 className="font-semibold mb-2">Tags</h3>
              <QuickAddTagPicker
                id="task-tags-create"
                entityType="project_task"
                pendingTags={pendingTags}
                onPendingTagsChange={setPendingTags}
                disabled={isSubmitting}
              />
            </div>
          )}

          {/* Full width Checklist section */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <h3 className='font-semibold'>Checklist</h3>
              <button
                onClick={toggleEditChecklist}
                className="text-gray-500 hover:text-gray-700"
                type="button"
                title={isEditingChecklist ? "Done editing" : "Edit checklist"}
              >
                <ListChecks className="h-5 w-5" />
              </button>
            </div>

                <div className="flex flex-col space-y-2">
                  {checklistItems.map((item, index): React.JSX.Element => (
                    <div key={index} className="flex items-center gap-2 w-full">
                      {isEditingChecklist || editingChecklistItemId === item.checklist_item_id ? (
                        <>
                          <Checkbox
                            checked={item.completed}
                            onChange={(e) => updateChecklistItem(index, 'completed', e.target.checked)}
                            className="flex-none"
                            containerClassName=""
                          />
                          <div className="flex-1">
                            <TextArea
                              value={item.item_name}
                              onChange={(e) => updateChecklistItem(index, 'item_name', e.target.value)}
                              placeholder="Checklist item"
                              className="w-full"
                              wrapperClassName="!mb-0 !px-0"
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
                            containerClassName=""
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
          </div>

          {/* Full width Dependencies section */}
          {mode === 'edit' && task ? (
            <TaskDependencies
              ref={dependenciesRef}
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
          ) : mode === 'create' && allProjectTasks.length > 0 && (
            <TaskDependencies
              ref={dependenciesRef}
              allTasksInProject={allProjectTasks}
              taskTypes={taskTypes}
              users={users}
              phases={phases}
              pendingMode
            />
          )}

          {/* Full width Associated Tickets section */}
          <TaskTicketLinks
            taskId={task?.task_id || undefined}
            phaseId={phase.phase_id}
            projectId={phase.project_id}
            initialLinks={task?.ticket_links}
            users={users}
            onLinksChange={setPendingTicketLinks}
            taskData={
              mode === 'edit'
                ? {
                    task_name: taskName,
                    description,
                    assigned_to: assignedUser,
                    due_date: dueDate ?? null,
                    estimated_hours: Math.round(estimatedHours * 60)
                  }
                : undefined
            }
          />

          {/* Full width Attachments section */}
          <div onClick={(e) => e.stopPropagation()} onSubmit={(e) => e.preventDefault()}>
            <TaskDocumentsSimple
              taskId={mode === 'edit' && task ? task.task_id : undefined}
              pendingDocuments={mode === 'create' ? pendingDocuments : undefined}
              onPendingDocumentsChange={mode === 'create' ? setPendingDocuments : undefined}
              onDocumentAdded={mode === 'edit' ? (doc) => setSessionAddedDocuments(prev => [...prev, doc]) : undefined}
            />
          </div>

          {/* Full width Comments section */}
          {mode === 'edit' && task && (
            <div onClick={(e) => e.stopPropagation()} onSubmit={(e) => e.preventDefault()}>
              <TaskCommentThread
                taskId={task.task_id}
                projectId={phase.project_id}
              />
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-between mt-6 pt-4 border-t">
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
              {mode === 'edit' && (
                <Button
                  id='add-time-entry-button'
                  type="button"
                  variant="soft"
                  onClick={handleAddTimeEntry}
                  disabled={isSubmitting || !task?.task_id}
                >
                  <Clock className="h-4 w-4 mr-2" />
                  Add Time Entry
                </Button>
              )}
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
          className="max-w-3xl"
          title={mode === 'create' ? 'Add New Task' : 'Edit Task'}
          disableFocusTrap
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
        title={mode === 'create' ? "Cancel Task Creation" : "Cancel Edit"}
        message="Are you sure you want to cancel? Any unsaved changes will be lost."
        confirmLabel="Discard changes"
        cancelLabel="Continue editing"
      />

      {/* Document cleanup confirmation - shown when canceling with new documents (uploaded/created) */}
      <ConfirmationDialog
        isOpen={showDocumentCleanupConfirm}
        onClose={() => setShowDocumentCleanupConfirm(false)}
        onConfirm={handleDocumentCleanupDelete}
        onCancel={handleDocumentCleanupKeep}
        title="Keep Uploaded Documents?"
        message={(() => {
          const allDocs = mode === 'create' ? pendingDocuments : sessionAddedDocuments;
          // Only show uploaded and created documents - linked docs don't need cleanup
          const docsToShow = allDocs.filter(d => d.type === 'uploaded' || d.type === 'block');

          return (
            <div>
              <p>You have {docsToShow.length} document{docsToShow.length !== 1 ? 's' : ''} that {docsToShow.length !== 1 ? 'were' : 'was'} {docsToShow.some(d => d.type === 'block') && docsToShow.some(d => d.type === 'uploaded') ? 'uploaded or created' : docsToShow.some(d => d.type === 'block') ? 'created' : 'uploaded'}:</p>
              <ul className="list-disc list-inside mt-2 text-sm">
                {docsToShow.slice(0, 5).map(doc => (
                  <li key={doc.document_id} className="truncate">
                    {doc.document_name}
                    <span className="text-gray-400 ml-1">
                      ({doc.type === 'block' ? 'created' : 'uploaded'})
                    </span>
                  </li>
                ))}
                {docsToShow.length > 5 && (
                  <li className="text-gray-500">...and {docsToShow.length - 5} more</li>
                )}
              </ul>
              <p className="mt-3">Would you like to keep these in the Documents section or delete them?</p>
            </div>
          );
        })()}
        confirmLabel={isDeletingDocuments ? "Deleting..." : "Delete documents"}
        cancelLabel="Continue editing"
        thirdButtonLabel="Keep documents"
        isConfirming={isDeletingDocuments}
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

      <ConfirmationDialog
        isOpen={showDependencyConfirmation}
        onClose={handleDependencyCancel}
        onConfirm={handleDependencyConfirm}
        title="Unsaved Changes"
        message="You have a dependency selected but not yet added. Click the purple + button to add it, or discard the selection and save."
        confirmLabel="Discard changes"
        cancelLabel="Continue editing"
      />

    </>
  );
}
