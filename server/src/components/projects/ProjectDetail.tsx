'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { IProject, IProjectPhase, IProjectTask, IProjectTicketLink, IProjectTicketLinkWithDetails, ProjectStatus, ITaskType, IProjectTaskDependency } from 'server/src/interfaces/project.interfaces';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { IPriority, IStandardPriority } from 'server/src/interfaces/ticket.interfaces';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import { ITaskResource } from 'server/src/interfaces/taskResource.interfaces';
import { useDrawer } from "server/src/context/DrawerContext";
import { getAllPriorities } from 'server/src/lib/actions/priorityActions';
import { getTaskTypes } from 'server/src/lib/actions/project-actions/projectTaskActions';
import { findTagsByEntityId, findTagsByEntityIds } from 'server/src/lib/actions/tagActions';
import { getDocumentCountsForEntities } from 'server/src/lib/actions/document-actions/documentActions';
import { TagManager, TagFilter } from 'server/src/components/tags';
import { useTags } from 'server/src/context/TagContext';
import { useTagPermissions } from 'server/src/hooks/useTagPermissions';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import TaskQuickAdd from './TaskQuickAdd';
import TaskEdit from './TaskEdit';
import PhaseQuickAdd from './PhaseQuickAdd';
import TaskListView from './TaskListView';
import ViewSwitcher from 'server/src/components/ui/ViewSwitcher';
import { getProjectTaskStatuses, updatePhase, deletePhase, getProjectTreeData, reorderPhase } from 'server/src/lib/actions/project-actions/projectActions';
import { updateTaskStatus, reorderTask, reorderTasksInStatus, moveTaskToPhase, updateTaskWithChecklist, getTaskChecklistItems, getTaskResourcesAction, getTaskTicketLinksAction, duplicateTaskToPhase, deleteTask as deleteTaskAction, getTasksForPhase, getTaskById, getAllProjectTasksForListView, getPhaseTaskCounts } from 'server/src/lib/actions/project-actions/projectTaskActions';
import styles from './ProjectDetail.module.css';
import { Toaster, toast } from 'react-hot-toast';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import DuplicateTaskDialog, { DuplicateOptions } from './DuplicateTaskDialog';
import MoveTaskDialog from './MoveTaskDialog';
import ProjectPhases from './ProjectPhases';
import KanbanBoard from './KanbanBoard';
import DonutChart from './DonutChart';
import { calculateProjectCompletion } from 'server/src/lib/utils/projectUtils';
import { IClient } from 'server/src/interfaces/client.interfaces';
import { HelpCircle, LayoutGrid, List } from 'lucide-react';
import { Tooltip } from 'server/src/components/ui/Tooltip';
import { generateKeyBetween } from 'fractional-indexing';
import KanbanBoardSkeleton from 'server/src/components/ui/skeletons/KanbanBoardSkeleton';
import { useUserPreference } from 'server/src/hooks/useUserPreference';

const PROJECT_VIEW_MODE_SETTING = 'project_detail_view_mode';

interface ProjectDetailProps {
  project: IProject;
  phases: IProjectPhase[];
  statuses: ProjectStatus[];
  users: IUserWithRoles[];
  clients: IClient[];
  contact?: { full_name: string };
  assignedUser?: IUserWithRoles;
  onTagsUpdate?: (tags: ITag[], allTagTexts: string[]) => void;
  initialTaskId?: string | null;
}

export default function ProjectDetail({
  project,
  phases,
  statuses: initialStatuses,
  users,
  clients,
  contact,
  assignedUser,
  onTagsUpdate,
  initialTaskId
}: ProjectDetailProps) {
  useTagPermissions(['project', 'project_task']);

  // View mode state with persistence
  type ProjectViewMode = 'kanban' | 'list';
  const {
    value: viewMode,
    setValue: setViewMode,
    isLoading: isViewModeLoading
  } = useUserPreference<ProjectViewMode>(
    PROJECT_VIEW_MODE_SETTING,
    {
      defaultValue: 'kanban',
      localStorageKey: PROJECT_VIEW_MODE_SETTING,
      debounceMs: 300
    }
  );

  // Kanban view state (existing - phase-scoped)
  const [selectedTask, setSelectedTask] = useState<IProjectTask | null>(null);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showPhaseQuickAdd, setShowPhaseQuickAdd] = useState(false);
  const [currentPhase, setCurrentPhase] = useState<IProjectPhase | null>(null);
  const [selectedPhase, setSelectedPhase] = useState<IProjectPhase | null>(null);

  // List view state (separate - project-scoped)
  const [listViewData, setListViewData] = useState<{
    phases: IProjectPhase[];
    tasks: IProjectTask[];
    statuses: ProjectStatus[];
    ticketLinks: Record<string, IProjectTicketLinkWithDetails[]>;
    taskResources: Record<string, ITaskResource[]>;
    checklistItems: Record<string, any[]>;
    taskTags: Record<string, ITag[]>;
    taskDependencies: Record<string, { predecessors: IProjectTaskDependency[]; successors: IProjectTaskDependency[] }>;
  } | null>(null);
  const [listViewLoading, setListViewLoading] = useState(false);
  const { openDrawer: _openDrawer, closeDrawer: _closeDrawer } = useDrawer();
  const [projectTasks, setProjectTasks] = useState<IProjectTask[]>([]);
  const [phaseTicketLinks, setPhaseTicketLinks] = useState<{ [taskId: string]: IProjectTicketLinkWithDetails[] }>({});
  const [phaseTaskResources, setPhaseTaskResources] = useState<{ [taskId: string]: any[] }>({});
  const [phaseTaskDependencies, setPhaseTaskDependencies] = useState<{ [taskId: string]: { predecessors: IProjectTaskDependency[]; successors: IProjectTaskDependency[] } }>({});
  const [projectPhases, setProjectPhases] = useState<IProjectPhase[]>(phases);
  const [projectStatuses, setProjectStatuses] = useState<ProjectStatus[]>(initialStatuses);
  const [isLoadingTasks, setIsLoadingTasks] = useState(false);
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [defaultStatus, setDefaultStatus] = useState<ProjectStatus | null>(null);
  const [editingPhaseId, setEditingPhaseId] = useState<string | null>(null);
  const [editingPhaseName, setEditingPhaseName] = useState('');
  const [editingStartDate, setEditingStartDate] = useState<Date | undefined>(undefined);
  const [editingEndDate, setEditingEndDate] = useState<Date | undefined>(undefined);
  const [editingPhaseDescription, setEditingPhaseDescription] = useState<string | null>(null);
  const [phaseDropTarget, setPhaseDropTarget] = useState<{
    phaseId: string;
    position: 'before' | 'after';
  } | null>(null);
  const [moveConfirmation, setMoveConfirmation] = useState<{
    taskId: string;
    taskName: string;
    sourcePhase: IProjectPhase;
    targetPhase: IProjectPhase;
  } | null>(null);

  const [deletePhaseConfirmation, setDeletePhaseConfirmation] = useState<{
    phaseId: string;
    phaseName: string;
  } | null>(null);
  
  const [projectMetrics, setProjectMetrics] = useState<{
    taskCompletionPercentage: number;
    hoursCompletionPercentage: number;
    budgetedHours: number;
    spentHours: number;
    remainingHours: number;
  } | null>(null);
 
  // State for the Move Task Dialog
  const [isMoveTaskDialogOpen, setIsMoveTaskDialogOpen] = useState(false);
  const [taskToMove, setTaskToMove] = useState<IProjectTask | null>(null);
  const [isDuplicateDialogOpen, setIsDuplicateDialogOpen] = useState(false);
  const [taskToDuplicate, setTaskToDuplicate] = useState<IProjectTask | null>(null);
  const [animatingTasks, setAnimatingTasks] = useState<Set<string>>(new Set());
  const [animatingPhases, setAnimatingPhases] = useState<Set<string>>(new Set());
  const [taskDraggingOverPhaseId, setTaskDraggingOverPhaseId] = useState<string | null>(null); // Added state
  
  // Tag-related state
  const [projectTags, setProjectTags] = useState<ITag[]>([]);
  const { tags: allTags } = useTags();
  const hasNotifiedParent = useRef(false);
  const hasOpenedInitialTask = useRef(false);
  
  // Auto-select the first phase when the project has phases (but not when opening a specific task)
  useEffect(() => {
    // Don't auto-select if we have an initialTaskId - that case is handled separately
    if (initialTaskId) return;

    // Only auto-select if we have phases but none is selected yet
    if (projectPhases.length > 0 && !selectedPhase) {
      // Sort phases by order_key to get the first one
      const sortedPhases = [...projectPhases].sort((a, b) => {
        const aKey = a.order_key || 'zzz';
        const bKey = b.order_key || 'zzz';
        return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
      });

      const firstPhase = sortedPhases[0];
      setSelectedPhase(firstPhase);
      setCurrentPhase(firstPhase);
    }
  }, [projectPhases, initialTaskId]); // Intentionally exclude selectedPhase to avoid re-triggering

  // Fetch tags when component mounts
  useEffect(() => {
    const fetchTags = async () => {
      if (!project.project_id) return;

      try {
        const tags = await findTagsByEntityId(project.project_id, 'project').catch((error) => {
          console.warn('Failed to fetch project tags, continuing without tags:', error);
          return [];
        });

        setProjectTags(tags);

        // Notify parent component of tags update only once
        if (onTagsUpdate && !hasNotifiedParent.current) {
          const projectTagTexts = allTags.filter(tag => tag.tagged_type === 'project').map(tag => tag.tag_text);
          onTagsUpdate(tags, projectTagTexts);
          hasNotifiedParent.current = true;
        }
      } catch (error) {
        console.error('Error fetching project tags:', error);
      }
    };
    fetchTags();
  }, [project.project_id]); // Remove onTagsUpdate from dependencies to prevent infinite loop
  const [duplicateTaskToggleDetails, setDuplicateTaskToggleDetails] = useState<{
      hasChecklist: boolean;
      hasPrimaryAssignee: boolean;
      additionalAssigneeCount: number;
      ticketLinkCount: number;
  } | null>(null);

  const [taskToDelete, setTaskToDelete] = useState<IProjectTask | null>(null);
  const [priorities, setPriorities] = useState<(IPriority | IStandardPriority)[]>([]);
  const [taskTypes, setTaskTypes] = useState<ITaskType[]>([]);
  const [selectedPriorityFilter, setSelectedPriorityFilter] = useState<string>('all');
  const [selectedTaskTags, setSelectedTaskTags] = useState<string[]>([]);
  const [taskTags, setTaskTags] = useState<Record<string, ITag[]>>({});
  const [allTaskTags, setAllTaskTags] = useState<ITag[]>([]);
  const [taskDocumentCounts, setTaskDocumentCounts] = useState<Map<string, number>>(new Map());

  const filteredTasks = useMemo(() => {
    if (!selectedPhase) return [];
    let tasks = projectTasks.filter(task => task.wbs_code.startsWith(selectedPhase.wbs_code + '.'));
    
    // Apply priority filter
    if (selectedPriorityFilter !== 'all') {
      tasks = tasks.filter(task => task.priority_id === selectedPriorityFilter);
    }
    
    // Apply tag filter
    if (selectedTaskTags.length > 0) {
      tasks = tasks.filter(task => {
        const tags = taskTags[task.task_id] || [];
        const tagTexts = tags.map(tag => tag.tag_text);
        return selectedTaskTags.some(selectedTag => tagTexts.includes(selectedTag));
      });
    }
    
    return tasks;
  }, [projectTasks, selectedPhase, selectedPriorityFilter, selectedTaskTags, taskTags]);

  const completedTasksCount = useMemo(() => {
    return filteredTasks.filter(task =>
      projectStatuses.find(status => status.project_status_mapping_id === task.project_status_mapping_id)?.is_closed === true
    ).length;
  }, [filteredTasks, projectStatuses]);

  // Task counts per phase for the phase sidebar (fetched from server)
  const [phaseTaskCounts, setPhaseTaskCounts] = useState<Record<string, number>>({});

  // Fetch task counts for all phases when component loads
  useEffect(() => {
    const fetchTaskCounts = async () => {
      try {
        const counts = await getPhaseTaskCounts(project.project_id);
        setPhaseTaskCounts(counts);
      } catch (error) {
        console.error('Error fetching phase task counts:', error);
      }
    };
    fetchTaskCounts();
  }, [project.project_id]);

  const [scrollInterval, setScrollInterval] = useState<NodeJS.Timeout | null>(null);
  const [projectTreeData, setProjectTreeData] = useState<any[]>([]);

  useEffect(() => {
    return () => {
      if (scrollInterval) {
        clearInterval(scrollInterval);
      }
    };
  }, [scrollInterval]);

  // Lazy load list view data when switching to list mode
  const loadListViewData = useCallback(async () => {
    if (listViewLoading || listViewData) return;
    setListViewLoading(true);
    try {
      const data = await getAllProjectTasksForListView(project.project_id);
      setListViewData(data);
    } catch (error) {
      console.error('Error loading list view data:', error);
      toast.error('Failed to load list view data');
    } finally {
      setListViewLoading(false);
    }
  }, [project.project_id, listViewData, listViewLoading]);

  useEffect(() => {
    if (viewMode === 'list') {
      loadListViewData();
    }
  }, [viewMode, loadListViewData]);

  // Refresh list view after task mutations
  const refreshListView = useCallback(() => {
    setListViewData(null); // Force reload on next render
  }, []);

  // Handle task move in list view (drag-and-drop)
  const handleListViewTaskMove = useCallback(async (
    taskId: string,
    newStatusMappingId: string,
    newPhaseId: string,
    beforeTaskId: string | null,
    afterTaskId: string | null
  ) => {
    try {
      const task = listViewData?.tasks.find(t => t.task_id === taskId);
      if (!task) {
        console.error('Task not found');
        return;
      }

      // Check if we're moving to a different phase
      if (task.phase_id !== newPhaseId) {
        // Move to different phase with new status
        await moveTaskToPhase(taskId, newPhaseId, newStatusMappingId);
        // Update task counts: decrement source, increment target
        setPhaseTaskCounts(prev => ({
          ...prev,
          [task.phase_id]: Math.max((prev[task.phase_id] || 0) - 1, 0),
          [newPhaseId]: (prev[newPhaseId] || 0) + 1
        }));
        toast.success('Task moved to new phase');
      } else if (task.project_status_mapping_id !== newStatusMappingId) {
        // Same phase, different status
        await updateTaskStatus(taskId, newStatusMappingId, beforeTaskId, afterTaskId);
        toast.success('Task status updated');
      } else {
        // Same phase and status - just reorder
        await reorderTask(taskId, beforeTaskId, afterTaskId);
        toast.success('Task reordered');
      }

      // Refresh list view to show updated data
      refreshListView();
    } catch (error) {
      console.error('Error moving task:', error);
      toast.error('Failed to move task');
    }
  }, [listViewData, refreshListView]);
  
  // Handle tag changes
  const handleProjectTagsChange = (tags: ITag[]) => {
    setProjectTags(tags);
    if (onTagsUpdate) {
      const projectTagTexts = allTags.filter(tag => tag.tagged_type === 'project').map(tag => tag.tag_text);
      onTagsUpdate(tags, projectTagTexts);
    }
  };
  
  // Handle task tag changes
  const handleTaskTagsChange = (taskId: string, tags: ITag[]) => {
    // Update kanban view tags
    setTaskTags(prev => ({
      ...prev,
      [taskId]: tags
    }));

    // Update all unique tags
    setAllTaskTags(current => {
      const currentTagTexts = new Set(current.map(t => t.tag_text));
      const newTags = tags.filter(tag => !currentTagTexts.has(tag.tag_text));
      return [...current, ...newTags];
    });

    // Update list view data if it exists
    if (listViewData) {
      setListViewData(prev => prev ? {
        ...prev,
        taskTags: {
          ...prev.taskTags,
          [taskId]: tags
        }
      } : null);
    }
  };
  
  // Fetch project completion metrics and project tree data
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        // Fetch project metrics
        const metrics = await calculateProjectCompletion(project.project_id);
        setProjectMetrics({
          taskCompletionPercentage: metrics.taskCompletionPercentage,
          hoursCompletionPercentage: metrics.hoursCompletionPercentage,
          budgetedHours: metrics.budgetedHours,
          spentHours: metrics.spentHours,
          remainingHours: metrics.remainingHours
        });
        
        // Fetch project tree data once
        const treeData = await getProjectTreeData();
        setProjectTreeData(treeData);
        
        // Fetch priorities for project tasks
        const allPriorities = await getAllPriorities('project_task');
        setPriorities(allPriorities);

        // Fetch task types
        const types = await getTaskTypes();
        setTaskTypes(types);
      } catch (error) {
        console.error('Error fetching initial data:', error);
        toast.error('Failed to load initial data');
      }
    };
    
    fetchInitialData();
  }, [project.project_id]);
  
  // Fetch tags for all tasks
  useEffect(() => {
    const fetchTaskTags = async () => {
      if (projectTasks.length === 0) return;
      
      try {
        const taskIds = projectTasks.map(task => task.task_id);
        // Add error handling for the server action call
        const tags = await findTagsByEntityIds(taskIds, 'project_task').catch((error) => {
          console.warn('Failed to fetch task tags, continuing without tags:', error);
          return [];
        });
        
        // Group tags by task
        const tagsByTask: Record<string, ITag[]> = {};
        tags.forEach((tag: ITag) => {
          if (!tagsByTask[tag.tagged_id]) {
            tagsByTask[tag.tagged_id] = [];
          }
          tagsByTask[tag.tagged_id].push(tag);
        });
        
        setTaskTags(tagsByTask);
        // Get unique task tags by tag_text to prevent duplicates
        const taskTagsMap = new Map<string, ITag>();
        allTags
          .filter(tag => tag.tagged_type === 'project_task')
          .forEach(tag => {
            // Only keep the first occurrence of each tag text
            if (!taskTagsMap.has(tag.tag_text)) {
              taskTagsMap.set(tag.tag_text, tag);
            }
          });
        setAllTaskTags(Array.from(taskTagsMap.values()));
      } catch (error) {
        console.error('Error fetching task tags:', error);
      }
    };
    
    fetchTaskTags();
  }, [projectTasks, allTags]);

  // Update task tags when global tags change (for color updates)
  useEffect(() => {
    if (Object.keys(taskTags).length > 0 && allTags.length > 0) {
      const updatedTaskTags: Record<string, ITag[]> = {};
      let hasChanges = false;
      
      Object.entries(taskTags).forEach(([taskId, tags]) => {
        const updatedTags = tags.map(localTag => {
          const globalTag = allTags.find(gt => gt.tag_text === localTag.tag_text && gt.tagged_type === 'project_task');
          if (globalTag && (globalTag.background_color !== localTag.background_color || globalTag.text_color !== localTag.text_color)) {
            hasChanges = true;
            return { ...localTag, background_color: globalTag.background_color, text_color: globalTag.text_color };
          }
          return localTag;
        });
        updatedTaskTags[taskId] = updatedTags;
      });
      
      if (hasChanges) {
        setTaskTags(updatedTaskTags);
      }
    }
  }, [allTags]);

  // Fetch tasks when phase is selected
  useEffect(() => {
    const fetchPhaseTasks = async () => {
      if (!selectedPhase) {
        setProjectTasks([]);
        setPhaseTicketLinks({});
        setPhaseTaskResources({});
        setPhaseTaskDependencies({});
        return;
      }

      setIsLoadingTasks(true);
      try {
        const { tasks, ticketLinks, taskResources, taskDependencies } = await getTasksForPhase(selectedPhase.phase_id);

        // Add checklist items to tasks
        const tasksWithChecklists = await Promise.all(
          tasks.map(async (task) => {
            const checklistItems = await getTaskChecklistItems(task.task_id);
            return { ...task, checklist_items: checklistItems };
          })
        );

        setProjectTasks(tasksWithChecklists);
        setPhaseTicketLinks(ticketLinks);
        setPhaseTaskResources(taskResources);
        setPhaseTaskDependencies(taskDependencies);
      } catch (error) {
        console.error('Error fetching phase tasks:', error);
        toast.error('Failed to load tasks for the selected phase');
      } finally {
        setIsLoadingTasks(false);
      }
    };

    fetchPhaseTasks();
  }, [selectedPhase]);

  // Handle opening task from URL parameter (e.g., from notifications)
  // First effect: Fetch task and select its phase
  useEffect(() => {
    if (!initialTaskId || projectPhases.length === 0) return;

    // Reset the flag when initialTaskId changes
    hasOpenedInitialTask.current = false;

    const loadTaskAndSelectPhase = async () => {
      try {
        const task = await getTaskById(initialTaskId);
        if (!task) {
          toast.error('Task not found');
          return;
        }

        // Find the phase for this task
        const taskPhase = projectPhases.find(phase => phase.phase_id === task.phase_id);
        if (!taskPhase) {
          toast.error('Task phase not found');
          return;
        }

        // Select the phase (this will trigger loading tasks for that phase)
        if (selectedPhase?.phase_id !== taskPhase.phase_id) {
          setSelectedPhase(taskPhase);
          setCurrentPhase(taskPhase);
        }
      } catch (error) {
        console.error('Error loading task from notification:', error);
        toast.error('Failed to load task');
      }
    };

    loadTaskAndSelectPhase();
  }, [initialTaskId, projectPhases]);

  // Second effect: Once tasks are loaded, open the specific task
  useEffect(() => {
    if (!initialTaskId || projectTasks.length === 0 || showQuickAdd || hasOpenedInitialTask.current) return;

    // Find the task in the loaded tasks
    const taskToOpen = projectTasks.find(task => task.task_id === initialTaskId);

    if (taskToOpen) {
      // Open the task dialog
      setSelectedTask(taskToOpen);
      setCurrentPhase(selectedPhase);
      setShowQuickAdd(true);
      hasOpenedInitialTask.current = true; // Mark that we've opened the task
    }
  }, [initialTaskId, projectTasks, showQuickAdd]);

  // Fetch document counts for tasks in the selected phase
  useEffect(() => {
    const fetchDocumentCounts = async () => {
      if (!selectedPhase || filteredTasks.length === 0) {
        setTaskDocumentCounts(new Map());
        return;
      }
      
      try {
        // Get task IDs for bulk fetch
        const taskIds = filteredTasks.map(task => task.task_id);
        
        // Fetch all document counts in one query
        const countMap = await getDocumentCountsForEntities(taskIds, 'project_task');
        
        // Set the Map directly
        setTaskDocumentCounts(countMap);
      } catch (error) {
        console.error('Error fetching document counts:', error);
        // Set empty counts on error
        const emptyMap = new Map<string, number>();
        filteredTasks.forEach(task => {
          emptyMap.set(task.task_id, 0);
        });
        setTaskDocumentCounts(emptyMap);
      }
    };
    
    fetchDocumentCounts();
  }, [selectedPhase, filteredTasks]);

  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData('text/plain', taskId);
    if (e.target instanceof HTMLElement) {
      e.target.classList.add('opacity-50');
    }
    document.body.classList.add('dragging-task');
  };

  const handleDragEnd = (e: React.DragEvent) => {
    if (e.target instanceof HTMLElement) {
      e.target.classList.remove('opacity-50');
    }
    document.body.classList.remove('dragging-task');
    setPhaseDropTarget(null);
    setTaskDraggingOverPhaseId(null); // Clear task dragging over phase
    
    if (scrollInterval) {
      clearInterval(scrollInterval);
      setScrollInterval(null);
    }
  };

  const handleDrop = async (e: React.DragEvent, targetStatusId: string, draggedTaskId: string, beforeTaskId: string | null, afterTaskId: string | null) => {
    e.preventDefault();
    const task = projectTasks.find(t => t.task_id === draggedTaskId);
    
    if (!task) {
      console.error('Task not found');
      return;
    }

    try {
      // Check if this is a status change or reorder
      if (task.project_status_mapping_id !== targetStatusId) {
        // Status change with position
        const updatedTask = await updateTaskStatus(draggedTaskId, targetStatusId, beforeTaskId, afterTaskId);
        const checklistItems = await getTaskChecklistItems(draggedTaskId);
        const taskWithChecklist = { ...updatedTask, checklist_items: checklistItems };
        
        // Remove from current status and add to new status
        setProjectTasks(prevTasks => {
          const newTasks = prevTasks.filter(t => t.task_id !== draggedTaskId);
          return [...newTasks, taskWithChecklist];
        });
        
        // Add animation state
        setAnimatingTasks(prev => new Set(prev).add(draggedTaskId));
        
        // Remove the entering animation after a delay
        setTimeout(() => {
          setAnimatingTasks(prev => {
            const next = new Set(prev);
            next.delete(draggedTaskId);
            return next;
          });
        }, 500);
        
        toast.success(`Task moved to new status`);
      } else {
        // Reorder within same status - use the new reorderTask function
        await reorderTask(draggedTaskId, beforeTaskId, afterTaskId);
        
        // Update local state to reflect the new order immediately
        // Generate a new order key for the moved task
        
        // Get the order keys from the before/after tasks
        let beforeKey: string | null = null;
        let afterKey: string | null = null;
        
        if (beforeTaskId) {
          const beforeTask = projectTasks.find(t => t.task_id === beforeTaskId);
          beforeKey = beforeTask?.order_key || null;
        }
        
        if (afterTaskId) {
          const afterTask = projectTasks.find(t => t.task_id === afterTaskId);
          afterKey = afterTask?.order_key || null;
        }
        
        const newOrderKey = generateKeyBetween(beforeKey, afterKey);
        
        // Update the task with the new order key
        setProjectTasks(prevTasks =>
          prevTasks.map((t): IProjectTask =>
            t.task_id === draggedTaskId ? { ...t, order_key: newOrderKey } : t
          )
        );
        
        // Add animation state
        setAnimatingTasks(prev => new Set(prev).add(draggedTaskId));
        
        // Remove the entering animation after a delay
        setTimeout(() => {
          setAnimatingTasks(prev => {
            const next = new Set(prev);
            next.delete(draggedTaskId);
            return next;
          });
        }, 500);
      }
    } catch (error) {
      console.error('Error handling drop:', error);
      toast.error('Failed to move task');
    }
  };


  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    
    const mouseY = e.clientY;
    const viewportHeight = window.innerHeight;
    const topThreshold = viewportHeight * 0.3; // Start scrolling at top 30%
    const bottomThreshold = viewportHeight * 0.7; // Start scrolling at bottom 30%
    const edgeThreshold = 100; // Pixels from very edge for max speed
    const maxScrollSpeed = 25;

    if (scrollInterval) {
      clearInterval(scrollInterval);
      setScrollInterval(null);
    }

    // Calculate scroll speed based on distance from edges
    if (mouseY < topThreshold) {
      const distance = Math.max(mouseY - edgeThreshold, 0);
      const speed = Math.min(maxScrollSpeed, maxScrollSpeed * (1 - distance / (topThreshold - edgeThreshold)));
      
      const newInterval = setInterval(() => {
        window.scrollBy({
          top: -speed,
          behavior: 'auto' // Use auto for smoother continuous scrolling
        });
      }, 16); // 60fps
      setScrollInterval(newInterval);
    } else if (mouseY > bottomThreshold) {
      const distance = Math.max((viewportHeight - mouseY) - edgeThreshold, 0);
      const speed = Math.min(maxScrollSpeed, maxScrollSpeed * (1 - distance / (viewportHeight - bottomThreshold - edgeThreshold)));
      
      const newInterval = setInterval(() => {
        window.scrollBy({
          top: speed,
          behavior: 'auto' // Use auto for smoother continuous scrolling
        });
      }, 16); // 60fps
      setScrollInterval(newInterval);
    }
  };

  const handlePhaseDragOver = (e: React.DragEvent, phaseId: string, dropPosition: 'before' | 'after' | '', isOverPhaseItemBody: boolean = false) => {
    e.preventDefault();
    const isPhaseBeingDragged = e.dataTransfer.types.includes('application/json');

    if (isPhaseBeingDragged) {
      // Only show phase drop target (dotted line) if a phase is being dragged over a 'before'/'after' zone
      if (!isOverPhaseItemBody && (dropPosition === 'before' || dropPosition === 'after')) {
        setPhaseDropTarget({ phaseId, position: dropPosition });
      } else {
        setPhaseDropTarget(null); // Don't show dotted line when dragging phase over another phase's body or if dropPosition is ""
      }
      setTaskDraggingOverPhaseId(null);
    } else {
      // Task is being dragged
      setPhaseDropTarget(null); // Don't show dotted line for phase reorder
      if (isOverPhaseItemBody) {
        setTaskDraggingOverPhaseId(phaseId); // Highlight the phase item itself
      } else {
        // Task is over a 'before'/'after' zone, do nothing or clear highlight
        setTaskDraggingOverPhaseId(null);
      }
    }
    handleDragOver(e); // Generic scroll handler
  };

  const handlePhaseDragLeave = () => {
    setPhaseDropTarget(null);
    setTaskDraggingOverPhaseId(null); // Clear task dragging over phase
  };

  const handlePhaseDragStart = (_e: React.DragEvent, _phaseId: string) => {
    // Phase drag start logic - phases handle their own data transfer
    document.body.classList.add('dragging-phase');
  };

  const handlePhaseDragEnd = (_e: React.DragEvent) => {
    // Phase drag end cleanup
    document.body.classList.remove('dragging-phase');
    setPhaseDropTarget(null);
    setTaskDraggingOverPhaseId(null); // Clear task dragging over phase
  };

  const handlePhaseReorder = async (draggedPhaseId: string, beforePhaseId: string | null, afterPhaseId: string | null) => {
    if (!draggedPhaseId) return;
    
    try {
      const draggedPhase = projectPhases.find(p => p.phase_id === draggedPhaseId);
      if (!draggedPhase) return;
      
      await reorderPhase(draggedPhaseId, beforePhaseId, afterPhaseId);
      
      // Calculate the new order key locally for immediate UI update
      
      // Get the order keys for before and after phases
      let beforeKey: string | null = null;
      let afterKey: string | null = null;
      
      if (beforePhaseId) {
        const beforePhase = projectPhases.find(p => p.phase_id === beforePhaseId);
        beforeKey = beforePhase?.order_key || null;
      }
      
      if (afterPhaseId) {
        const afterPhase = projectPhases.find(p => p.phase_id === afterPhaseId);
        afterKey = afterPhase?.order_key || null;
      }
      
      const newOrderKey = generateKeyBetween(
        beforeKey === undefined ? null : beforeKey,
        afterKey === undefined ? null : afterKey
      );
      
      // Update the phases with the new order key
      const updatedPhases = projectPhases.map(p => {
        if (p.phase_id === draggedPhaseId) {
          return { ...p, order_key: newOrderKey };
        }
        return p;
      });
      setProjectPhases(updatedPhases);
      
      // Add animation state
      setAnimatingPhases(prev => new Set(prev).add(draggedPhaseId));
      
      // Remove the entering animation after a delay
      setTimeout(() => {
        setAnimatingPhases(prev => {
          const next = new Set(prev);
          next.delete(draggedPhaseId);
          return next;
        });
      }, 500);
      
      toast.success('Phase reordered successfully');
    } catch (error) {
      console.error('Error reordering phase:', error);
      toast.error('Failed to reorder phase');
    }
  };

  const handlePhaseDropZone = async (e: React.DragEvent, targetPhase: IProjectPhase, beforePhaseId: string | null, afterPhaseId: string | null) => {
    e.preventDefault();
    setPhaseDropTarget(null);
    setTaskDraggingOverPhaseId(null); // Clear highlight on drop
    
    // Debug logging
    console.log('handlePhaseDropZone called:', {
      targetPhase: targetPhase.phase_name,
      beforePhaseId,
      afterPhaseId,
      dataTransferTypes: e.dataTransfer.types
    });
    
    // Check if it's a phase being dropped
    const dropData = e.dataTransfer.getData('application/json');
    const plainData = e.dataTransfer.getData('text/plain');
    
    console.log('Drop data:', { dropData, plainData });
    
    if (dropData) {
      try {
        const parsed = JSON.parse(dropData);
        console.log('Parsed drop data:', parsed);
        if (parsed.type === 'phase' && parsed.phaseId) {
          // Handle phase reordering with the provided before/after IDs
          console.log('Calling handlePhaseReorder with:', { draggedId: parsed.phaseId, beforePhaseId, afterPhaseId });
          await handlePhaseReorder(parsed.phaseId, beforePhaseId, afterPhaseId);
          return;
        }
      } catch (err) {
        console.log('Error parsing drop data:', err);
        // Not JSON data, continue with task drop logic
      }
    }
    
    // Original task drop logic
    const taskId = plainData;
    const task = projectTasks.find(t => t.task_id === taskId);
    const sourcePhase = projectPhases.find(p => p.phase_id === task?.phase_id);
    
    if (task && sourcePhase && targetPhase.phase_id !== sourcePhase.phase_id) {
      setMoveConfirmation({
        taskId,
        taskName: task.task_name,
        sourcePhase,
        targetPhase
      });
    }
  };

  const handleMoveConfirm = async () => {
    if (!moveConfirmation) return;
    
    try {
      // Get the current task to preserve its status
      const task = projectTasks.find(t => t.task_id === moveConfirmation.taskId);
      if (!task) {
        throw new Error('Task not found');
      }

      const updatedTask = await moveTaskToPhase(
        moveConfirmation.taskId,
        moveConfirmation.targetPhase.phase_id,
        task.project_status_mapping_id  // Pass the current status mapping ID
      );
      
      const checklistItems = await getTaskChecklistItems(moveConfirmation.taskId);
      const taskWithChecklist = { ...updatedTask, checklist_items: checklistItems };
      
      setProjectTasks(prevTasks =>
        prevTasks.map((task): IProjectTask =>
          task.task_id === updatedTask.task_id ? taskWithChecklist : task
        )
      );
      // Update task counts: decrement source, increment target
      setPhaseTaskCounts(prev => ({
        ...prev,
        [moveConfirmation.sourcePhase.phase_id]: Math.max((prev[moveConfirmation.sourcePhase.phase_id] || 0) - 1, 0),
        [moveConfirmation.targetPhase.phase_id]: (prev[moveConfirmation.targetPhase.phase_id] || 0) + 1
      }));

      toast.success(`Task moved to ${moveConfirmation.targetPhase.phase_name}`);
    } catch (error) {
      console.error('Error moving task:', error);
      toast.error('Failed to move task');
    } finally {
      setMoveConfirmation(null);
    }
  };

  const handleAddTask = useCallback(async (newTask: IProjectTask | null) => {
    if (!newTask) return;

    setIsAddingTask(true);
    try {
      if (selectedPhase && newTask.wbs_code.startsWith(selectedPhase.wbs_code)) {
        const checklistItems = await getTaskChecklistItems(newTask.task_id);
        const taskWithChecklist = { ...newTask, checklist_items: checklistItems };

        setProjectTasks((prevTasks) => [...prevTasks, taskWithChecklist]);
        // Update task count for the phase
        setPhaseTaskCounts(prev => ({
          ...prev,
          [newTask.phase_id]: (prev[newTask.phase_id] || 0) + 1
        }));
        setShowQuickAdd(false);
        toast.success('New task added successfully!');
      } else {
        console.error('New task does not match selected phase');
        toast.error('Error adding new task: Phase mismatch');
      }
    } catch (error) {
      console.error('Error adding new task:', error);
      toast.error('Error adding new task. Please try again.');
    } finally {
      setIsAddingTask(false);
    }
  }, [selectedPhase]);

  const handleCloseQuickAdd = useCallback(() => {
    setShowQuickAdd(false);
    setDefaultStatus(null);
    setIsAddingTask(false);
    setSelectedTask(null);
  }, []);

  const handlePhaseAdded = useCallback((newPhase: IProjectPhase) => {
    setProjectPhases((prevPhases) => [...prevPhases, newPhase]);
    setSelectedPhase(newPhase);
    setCurrentPhase(newPhase);
    toast.success('New phase added successfully!');
  }, []);

  const handleAddCard = useCallback((status: ProjectStatus) => {
    if (!selectedPhase) {
      toast.error('Please select a phase before adding a card.');
      return;
    }
    
    setIsAddingTask(true);
    setDefaultStatus(status);
    setCurrentPhase(selectedPhase);
    setSelectedTask(null);
    setShowQuickAdd(true);
  }, [selectedPhase]);

  const handleTaskUpdated = useCallback(async (updatedTask: IProjectTask | null) => {
    if (updatedTask) {
      try {
        // Fetch checklist items and task resources in parallel
        const [checklistItems, taskResources] = await Promise.all([
          getTaskChecklistItems(updatedTask.task_id),
          getTaskResourcesAction(updatedTask.task_id)
        ]);
        const taskWithChecklist = { ...updatedTask, checklist_items: checklistItems };

        // Update kanban view data
        setProjectTasks((prevTasks) => {
          const taskExists = prevTasks.some(task => task.task_id === updatedTask.task_id);

          if (taskExists) {
            return prevTasks.map((task): IProjectTask =>
              task.task_id === updatedTask.task_id ? taskWithChecklist : task
            );
          } else {
            return [...prevTasks, taskWithChecklist];
          }
        });

        // Update task resources for kanban view
        setPhaseTaskResources(prev => ({
          ...prev,
          [updatedTask.task_id]: taskResources
        }));

        // Update list view data if it exists
        setListViewData(prev => {
          if (!prev) return null;
          const taskExists = prev.tasks.some(t => t.task_id === updatedTask.task_id);
          return {
            ...prev,
            tasks: taskExists
              ? prev.tasks.map(t => t.task_id === updatedTask.task_id ? taskWithChecklist : t)
              : [...prev.tasks, taskWithChecklist],
            checklistItems: {
              ...prev.checklistItems,
              [updatedTask.task_id]: checklistItems
            },
            taskResources: {
              ...prev.taskResources,
              [updatedTask.task_id]: taskResources
            }
          };
        });

        toast.success(taskWithChecklist.task_id ? 'Task updated successfully!' : 'Task added successfully!');
      } catch (error) {
        console.error('Error updating task:', error);
        toast.error('Failed to update task');
      }
    } else {
      // Task deleted
      setProjectTasks((prevTasks) =>
        prevTasks.filter((task) => task.task_id !== selectedTask?.task_id)
      );

      // Also remove from list view data
      if (selectedTask) {
        setListViewData(prev => prev ? {
          ...prev,
          tasks: prev.tasks.filter(t => t.task_id !== selectedTask.task_id)
        } : null);
      }

      toast.success('Task deleted successfully!');
    }
    setShowQuickAdd(false);
    setSelectedTask(null);
    setIsAddingTask(false);
  }, [selectedTask]);

  const handleTaskSelected = useCallback((task: IProjectTask) => {
    // Log that we're using the cached project tree data for editing
    console.log('Using cached project tree data for edit task dialog');
    
    setSelectedTask(task);
    setCurrentPhase(phases.find(phase => phase.phase_id === task.phase_id) || null);
    setShowQuickAdd(true);
  }, [phases]);

  const handleAssigneeChange = async (taskId: string, newAssigneeId: string | null, newTaskName?: string) => {
    try {
      // Find task in either kanban data or list view data
      const task = projectTasks.find(t => t.task_id === taskId) || listViewData?.tasks.find(t => t.task_id === taskId);
      if (!task) {
        throw new Error('Task not found');
      }

      const updatedTask = await updateTaskWithChecklist(taskId, {
        ...task,
        assigned_to: !newAssigneeId || newAssigneeId === 'unassigned' || newAssigneeId === '' ? null : newAssigneeId,
        task_name: newTaskName || task.task_name,
        estimated_hours: Number(task.estimated_hours) || 0,
        actual_hours: Number(task.actual_hours) || 0,
        checklist_items: task.checklist_items
      });

      if (updatedTask) {
        const checklistItems = await getTaskChecklistItems(taskId);
        const taskWithChecklist = { ...updatedTask, checklist_items: checklistItems };

        // Update kanban view data
        setProjectTasks(prevTasks =>
          prevTasks.map((task): IProjectTask =>
            task.task_id === taskId ? taskWithChecklist : task
          )
        );

        // Update list view data if it exists
        if (listViewData) {
          setListViewData(prev => prev ? {
            ...prev,
            tasks: prev.tasks.map(t =>
              t.task_id === taskId ? taskWithChecklist : t
            )
          } : null);
        }

        toast.success('Task assignee updated successfully!');
      }
    } catch (error) {
      console.error('Error updating task assignee:', error);
      toast.error('Failed to update task assignee. Please try again.');
    }
  };

  const handleEditPhase = (phase: IProjectPhase) => {
    setEditingPhaseId(phase.phase_id);
    setEditingPhaseName(phase.phase_name);
    setEditingPhaseDescription(phase.description);
    // Always create new Date objects from the timestamps to ensure consistent format
    setEditingStartDate(phase.start_date ? new Date(phase.start_date) : undefined);
    setEditingEndDate(phase.end_date ? new Date(phase.end_date) : undefined);
  };

  const handleSavePhase = async (phase: IProjectPhase) => {
    try {
      if (!editingPhaseName.trim()) {
        toast.error('Phase name cannot be empty');
        return;
      }
  
      const updatedPhase = await updatePhase(phase.phase_id, {
        phase_name: editingPhaseName,
        description: editingPhaseDescription,
        start_date: editingStartDate || null,
        end_date: editingEndDate || null
      });
  
      setProjectPhases(prevPhases =>
        prevPhases.map((p): IProjectPhase =>
          p.phase_id === phase.phase_id
            ? { 
                ...p, 
                phase_name: editingPhaseName,
                description: updatedPhase.description,
                start_date: updatedPhase.start_date,
                end_date: updatedPhase.end_date
              }
            : p
        )
      );

      if (selectedPhase?.phase_id === updatedPhase.phase_id) {
        setSelectedPhase(updatedPhase);
      }
      
      setEditingPhaseId(null);
      setEditingPhaseName('');
      setEditingPhaseDescription(null);
      setEditingStartDate(undefined);
      setEditingEndDate(undefined);
      toast.success('Phase updated successfully!');
    } catch (error) {
      console.error('Error updating phase:', error);
      toast.error('Failed to update phase. Please try again.');
    }
  };

  const handleCancelEdit = () => {
    setEditingPhaseId(null);
    setEditingPhaseName('');
    setEditingPhaseDescription(null);
    setEditingStartDate(undefined);
    setEditingEndDate(undefined);
  };

  const handleDeletePhase = async () => {
    if (!deletePhaseConfirmation) return;

    try {
      await deletePhase(deletePhaseConfirmation.phaseId);
      setProjectPhases(prevPhases => 
        prevPhases.filter(phase => phase.phase_id !== deletePhaseConfirmation.phaseId)
      );
      if (selectedPhase?.phase_id === deletePhaseConfirmation.phaseId) {
        setSelectedPhase(null);
      }
      toast.success('Phase deleted successfully!');
    } catch (error) {
      console.error('Error deleting phase:', error);
      toast.error('Failed to delete phase. Please try again.');
    } finally {
      setDeletePhaseConfirmation(null);
    }
  };

  const handleEmptyTaskUpdate = async (_: IProjectTask | null) => {
    return Promise.resolve();
  };

  const handlePhaseSelect = (phase: IProjectPhase) => {
    setSelectedPhase(phase);
    setCurrentPhase(phase);
  };

  const handleDeletePhaseClick = (phase: IProjectPhase) => {
    setDeletePhaseConfirmation({
      phaseId: phase.phase_id,
      phaseName: phase.phase_name
    });
  };

  const handleReorderTasks = async (updates: { taskId: string, newWbsCode: string }[]) => {
    try {
      await reorderTasksInStatus(updates);
      // Update local state to reflect the new order
      const updatedTasks = [...projectTasks];
      updates.forEach(({taskId, newWbsCode}) => {
        const taskIndex = updatedTasks.findIndex(t => t.task_id === taskId);
        if (taskIndex !== -1) {
          updatedTasks[taskIndex] = {
            ...updatedTasks[taskIndex],
            wbs_code: newWbsCode
          };
        }
      });
      setProjectTasks(updatedTasks);
      toast.success('Tasks reordered successfully');
    } catch (error) {
      console.error('Error reordering tasks:', error);
      toast.error('Failed to reorder tasks');
    }
  };

  const handleMoveTaskClick = (task: IProjectTask) => {
    console.log("Move Task action clicked in ProjectDetail:", task);
    setTaskToMove(task);
    setIsMoveTaskDialogOpen(true);
  };

  const handleDuplicateTaskClick = async (task: IProjectTask) => {
    console.log("Duplicate clicked in ProjectDetail:", task);

    const placeholderTargetPhase = projectPhases.find(p => p.phase_id !== task.phase_id) || projectPhases[0]; // Just picking another phase for demo
    if (!placeholderTargetPhase) {
        toast.error("Could not find a target phase to duplicate to.");
        return;
    }
    // Using placeholderTargetPhase directly in the dialog

    try {
        // Fetch necessary details for the dialog toggles
        const [resources, links, checklist] = await Promise.all([
            getTaskResourcesAction(task.task_id),
            getTaskTicketLinksAction(task.task_id),
            getTaskChecklistItems(task.task_id)
        ]);

        setTaskToDuplicate(task);
        setDuplicateTaskToggleDetails({
            hasChecklist: (checklist || []).length > 0,
            hasPrimaryAssignee: !!task.assigned_to,
            additionalAssigneeCount: (resources || []).length,
            ticketLinkCount: (links || []).length,
        });
        setIsDuplicateDialogOpen(true);
    } catch (error) {
        console.error("Error preparing duplicate dialog:", error);
        toast.error("Failed to load task details for duplication.");
    }
  };

  // Placeholder for delete handler (will add later)
  const handleDeleteTaskClick = (task: IProjectTask) => {
    console.log("Delete clicked in ProjectDetail:", task);
    setTaskToDelete(task);
  };
 
  // Handler for MoveTaskDialog confirmation
  const handleDialogMoveConfirm = async (targetPhaseId: string, targetStatusId: string | undefined) => {
    if (!taskToMove) return;

    console.log(`Moving task ${taskToMove.task_id} to phase ${targetPhaseId} with status ${targetStatusId}`);
    try {
      const movedTask = await moveTaskToPhase(
        taskToMove.task_id,
        targetPhaseId,
        targetStatusId
      );

      if (movedTask) {
        const checklistItems = await getTaskChecklistItems(movedTask.task_id);
        const taskWithDetails = { ...movedTask, checklist_items: checklistItems };

        // Check if the task was moved to a different phase than the currently selected one
        const movedToDifferentPhase = selectedPhase && movedTask.phase_id !== selectedPhase.phase_id;

        if (movedToDifferentPhase) {
          // Remove the task from the current view since it's no longer in this phase
          setProjectTasks(prevTasks =>
            prevTasks.filter(t => t.task_id !== movedTask.task_id)
          );
          // Update task counts: decrement source, increment target
          setPhaseTaskCounts(prev => ({
            ...prev,
            [taskToMove.phase_id]: Math.max((prev[taskToMove.phase_id] || 0) - 1, 0),
            [targetPhaseId]: (prev[targetPhaseId] || 0) + 1
          }));
          toast.success(`Task "${taskToMove.task_name}" moved to different phase successfully! Switch to the target phase to see it.`);
        } else {
          // Task moved within the same phase (to different status) - update in place
          setProjectTasks(prevTasks =>
            prevTasks.map(t => t.task_id === movedTask.task_id ? taskWithDetails : t)
          );
          toast.success(`Task "${taskToMove.task_name}" moved successfully!`);
        }
      } else {
        toast.error("Failed to move task. Please try again.");
      }
    } catch (error) {
      console.error("Error moving task via dialog:", error);
      toast.error(`Failed to move task: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsMoveTaskDialogOpen(false);
      setTaskToMove(null);
    }
  };

  const renderContent = () => {
    // List view rendering
    if (viewMode === 'list') {
      if (listViewLoading) {
        return (
          <div className="flex items-center justify-center h-64">
            <div className="text-gray-500">Loading list view...</div>
          </div>
        );
      }

      if (!listViewData) {
        return (
          <div className="flex items-center justify-center h-64">
            <div className="text-gray-500">No data available</div>
          </div>
        );
      }

      return (
        <div className="flex flex-col h-full">
          <div className="mb-4">
            <div className="flex justify-end items-center gap-4">
                {/* Tag Filter */}
                <TagFilter
                  allTags={allTaskTags}
                  selectedTags={selectedTaskTags}
                  onTagSelect={(tag) => {
                    setSelectedTaskTags(prev =>
                      prev.includes(tag)
                        ? prev.filter(t => t !== tag)
                        : [...prev, tag]
                    );
                  }}
                />

                {/* Priority Filter */}
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-gray-700">Filter by Priority:</label>
                  <CustomSelect
                    value={selectedPriorityFilter}
                    onValueChange={setSelectedPriorityFilter}
                    options={[
                      { value: 'all', label: 'All Priorities' },
                      ...priorities.map(p => ({
                        value: p.priority_id,
                        label: p.priority_name,
                        color: p.color
                      }))
                    ]}
                    className="w-48"
                    placeholder="Select priority"
                  />
                </div>

                {/* View Switcher - rightmost */}
                <ViewSwitcher
                  currentView={viewMode}
                  onChange={setViewMode}
                  options={[
                    { value: 'kanban', label: 'Kanban', icon: LayoutGrid },
                    { value: 'list', label: 'List', icon: List }
                  ]}
                />
            </div>
          </div>
          <TaskListView
            phases={listViewData.phases}
            tasks={listViewData.tasks}
            statuses={listViewData.statuses}
            taskResources={listViewData.taskResources}
            taskTags={listViewData.taskTags}
            taskDependencies={listViewData.taskDependencies}
            checklistItems={Object.entries(listViewData.checklistItems).reduce((acc, [taskId, items]) => {
              acc[taskId] = {
                total: items.length,
                completed: items.filter(item => item.completed).length,
                items: items.map(item => ({ item_name: item.item_name, completed: item.completed }))
              };
              return acc;
            }, {} as Record<string, { total: number; completed: number; items?: Array<{ item_name: string; completed: boolean }> }>)}
            documentCounts={{}}
            onTaskClick={handleTaskSelected}
            onTaskDelete={handleDeleteTaskClick}
            onTaskDuplicate={handleDuplicateTaskClick}
            onTaskMove={handleListViewTaskMove}
            onAddPhase={() => setShowPhaseQuickAdd(true)}
            onAddTask={(phaseId) => {
              const phase = listViewData.phases.find(p => p.phase_id === phaseId);
              if (phase) {
                setCurrentPhase(phase);
                setShowQuickAdd(true);
              }
            }}
            onTaskTagsChange={handleTaskTagsChange}
            onAssigneeChange={(taskId, newAssigneeId) => handleAssigneeChange(taskId, newAssigneeId)}
            users={users}
            selectedPriorityFilter={selectedPriorityFilter}
            selectedTaskTags={selectedTaskTags}
          />
        </div>
      );
    }

    // Kanban view rendering (existing)
    if (!selectedPhase) {
      return (
        <div className="flex items-center justify-center h-64 bg-gray-100 rounded-lg">
          <div className="text-center">
            <p className="text-xl text-gray-600 flex items-center justify-center gap-2">
              Please select or create a phase to view the Kanban board.
              <Tooltip content="A phase is a distinct stage or milestone in your project timeline. Each phase can contain multiple tasks and helps organize work into manageable sections.">
                <HelpCircle className="w-5 h-5 text-gray-500 cursor-help" />
              </Tooltip>
            </p>
          </div>
        </div>
      );
    }

    const completionPercentage = (completedTasksCount / filteredTasks.length) * 100 || 0;

    return (
      <div className="flex flex-col h-full">
        <div className="mb-4">
          <div className="flex justify-between items-center gap-4">
            {/* Section 1: Kanban Board Title */}
            <div>
              <h2 className="text-xl font-bold mb-1">Kanban Board: {selectedPhase.phase_name}</h2>
              {selectedPhase.description && (
                <p className="text-sm text-gray-600">{selectedPhase.description}</p>
              )}
            </div>
            
            {/* Section 2: Tag Filter, Priority Filter, Donut Chart and ViewSwitcher (rightmost) */}
            <div className="flex items-center gap-4">
              {/* Tag Filter */}
              <TagFilter
                allTags={allTaskTags}
                selectedTags={selectedTaskTags}
                onTagSelect={(tag) => {
                  setSelectedTaskTags(prev =>
                    prev.includes(tag)
                      ? prev.filter(t => t !== tag)
                      : [...prev, tag]
                  );
                }}
              />

              {/* Priority Filter */}
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700">Filter by Priority:</label>
                <CustomSelect
                  value={selectedPriorityFilter}
                  onValueChange={setSelectedPriorityFilter}
                  options={[
                    { value: 'all', label: 'All Priorities' },
                    ...priorities.map(p => ({
                      value: p.priority_id,
                      label: p.priority_name,
                      color: p.color
                    }))
                  ]}
                  className="w-48"
                  placeholder="Select priority"
                />
              </div>

              {/* Donut Chart */}
              <div className="flex items-center justify-end space-x-2">
                <DonutChart
                  percentage={completionPercentage}
                  tooltipContent={`Shows the percentage of completed tasks for the selected phase "${selectedPhase.phase_name}" only`}
                />
                <span className="text-sm font-semibold text-gray-600">
                  {completedTasksCount} / {filteredTasks.length} Done
                </span>
              </div>

              {/* View Switcher - rightmost */}
              <ViewSwitcher
                currentView={viewMode}
                onChange={setViewMode}
                options={[
                  { value: 'kanban', label: 'Kanban', icon: LayoutGrid },
                  { value: 'list', label: 'List', icon: List }
                ]}
              />
            </div>
          </div>
        </div>
        <div className={styles.kanbanWrapper}>
          {!selectedPhase ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-gray-500">Please select a phase to view tasks</div>
            </div>
          ) : isLoadingTasks ? (
            <KanbanBoardSkeleton />
          ) : (
            <KanbanBoard
              tasks={projectTasks}
              phaseTasks={filteredTasks}
              users={users}
              taskTypes={taskTypes}
              statuses={projectStatuses}
              isAddingTask={isAddingTask}
              selectedPhase={!!selectedPhase}
              ticketLinks={phaseTicketLinks}
              taskResources={phaseTaskResources}
              taskDependencies={phaseTaskDependencies}
              taskTags={taskTags}
              taskDocumentCounts={taskDocumentCounts}
              allTaskTags={allTaskTags}
              projectTreeData={projectTreeData} // Pass project tree data
              animatingTasks={animatingTasks}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onAddCard={handleAddCard}
              onTaskSelected={handleTaskSelected}
              onAssigneeChange={handleAssigneeChange}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onReorderTasks={handleReorderTasks}
              onMoveTaskClick={handleMoveTaskClick}
              onDuplicateTaskClick={handleDuplicateTaskClick}
              onEditTaskClick={handleTaskSelected}
              onDeleteTaskClick={handleDeleteTaskClick}
              onTaskTagsChange={handleTaskTagsChange}
            />
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={styles.pageContainer}>
      <Toaster position="top-right" />
      <div 
        className={styles.mainContent}
        onDragOver={handleDragOver}
      >
        <div className={styles.contentWrapper}>
          {/* Hide phase panel when in list view */}
          {viewMode === 'kanban' && (
            <div className={styles.phasesList}>
              <ProjectPhases
              phases={projectPhases}
              selectedPhase={selectedPhase}
              isAddingTask={isAddingTask}
              editingPhaseId={editingPhaseId}
              editingPhaseName={editingPhaseName}
              editingPhaseDescription={editingPhaseDescription}
              editingStartDate={editingStartDate}
              editingEndDate={editingEndDate}
              phaseTaskCounts={phaseTaskCounts}
              phaseDropTarget={phaseDropTarget}
              taskDraggingOverPhaseId={taskDraggingOverPhaseId} // Pass new state
              animatingPhases={animatingPhases}
              onPhaseSelect={handlePhaseSelect}
              onAddTask={() => {
                if (!selectedPhase) {
                  toast.error('Please select a phase before adding a task.');
                  return;
                }
                setCurrentPhase(selectedPhase);
                setShowQuickAdd(true);
              }}
              onAddPhase={() => setShowPhaseQuickAdd(true)}
              onEditPhase={handleEditPhase}
              onSavePhase={handleSavePhase}
              onCancelEdit={handleCancelEdit}
              onDeletePhase={handleDeletePhaseClick}
              onEditingPhaseNameChange={setEditingPhaseName}
              onEditingPhaseDescriptionChange={setEditingPhaseDescription}
              onEditingStartDateChange={setEditingStartDate}
              onEditingEndDateChange={setEditingEndDate}
              onDragOver={handlePhaseDragOver}
              onDragLeave={handlePhaseDragLeave}
              onDrop={handlePhaseDropZone}
              onDragStart={handlePhaseDragStart}
              onDragEnd={handlePhaseDragEnd}
            />
          </div>
          )}
          <div className={styles.kanbanContainer}>
            {renderContent()}
          </div>
        </div>
      </div>

      {(showQuickAdd && (currentPhase || selectedPhase)) && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-lg relative w-full max-w-3xl">
            <button
              onClick={handleCloseQuickAdd}
              className="absolute top-2 right-2 text-gray-500 hover:text-gray-700"
              aria-label="Close"
            >
              ×
            </button>
            {selectedTask ? (
              <TaskEdit
                task={selectedTask}
                phase={currentPhase || selectedPhase!}
                phases={projectPhases}
                onClose={handleCloseQuickAdd}
                onTaskUpdated={handleTaskUpdated}
                projectStatuses={projectStatuses}
                users={users}
                projectTreeData={projectTreeData}
              />
            ) : (
              <TaskQuickAdd
                phase={currentPhase || selectedPhase!}
                onClose={handleCloseQuickAdd}
                onTaskAdded={handleAddTask}
                onTaskUpdated={handleEmptyTaskUpdate}
                projectStatuses={projectStatuses}
                defaultStatus={defaultStatus || undefined}
                onCancel={() => setIsAddingTask(false)}
                users={users}
                task={selectedTask || undefined}
                projectTreeData={projectTreeData}
              />
            )}
          </div>
        </div>
      )}

      {showPhaseQuickAdd && (
        <PhaseQuickAdd
          projectId={project.project_id}
          onClose={() => setShowPhaseQuickAdd(false)}
          onPhaseAdded={handlePhaseAdded}
          onCancel={() => setShowPhaseQuickAdd(false)}
        />
      )}

      {moveConfirmation && (
        <ConfirmationDialog
          isOpen={true}
          onClose={() => setMoveConfirmation(null)}
          onConfirm={handleMoveConfirm}
          title="Move Task"
          message={`Are you sure you want to move task "${moveConfirmation.taskName}" from phase "${moveConfirmation.sourcePhase.phase_name}" to "${moveConfirmation.targetPhase.phase_name}"?`}
          confirmLabel="Move"
          cancelLabel="Cancel"
        />
      )}

      {deletePhaseConfirmation && (
        <ConfirmationDialog
          isOpen={true}
          onClose={() => setDeletePhaseConfirmation(null)}
          onConfirm={handleDeletePhase}
          title="Delete Phase"
          message={`Are you sure you want to delete phase "${deletePhaseConfirmation.phaseName}"? This will also delete all tasks and their checklists in this phase.`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
        />
      )}

      {/* Duplicate Task Dialog */}
      {isDuplicateDialogOpen && taskToDuplicate && duplicateTaskToggleDetails && (
        <DuplicateTaskDialog
          isOpen={isDuplicateDialogOpen}
          onClose={() => { 
              setIsDuplicateDialogOpen(false);
              setTaskToDuplicate(null);
              setDuplicateTaskToggleDetails(null);
          }}
          taskDetails={{
              originalTaskId: taskToDuplicate.task_id,
              originalTaskName: taskToDuplicate.task_name,
              ...duplicateTaskToggleDetails
          }}
          projectTreeData={projectTreeData}
          onConfirm={async (targetPhaseId: string, options: DuplicateOptions) => {
            if (!taskToDuplicate) return;
            try {
              const newTask = await duplicateTaskToPhase(
                taskToDuplicate.task_id,
                targetPhaseId,
                options
              );
              
              const checklistItems = await getTaskChecklistItems(newTask.task_id);
              const taskWithChecklist = { ...newTask, checklist_items: checklistItems };
              setProjectTasks(prev => [...prev, taskWithChecklist]);
              // Update task count for the target phase
              setPhaseTaskCounts(prev => ({
                ...prev,
                [newTask.phase_id]: (prev[newTask.phase_id] || 0) + 1
              }));

              toast.success(`Task "${newTask.task_name}" duplicated successfully!`);
              setIsDuplicateDialogOpen(false);
              setTaskToDuplicate(null);
              setDuplicateTaskToggleDetails(null);
            } catch (error) {
              console.error("Error duplicating task:", error);
              toast.error("Failed to duplicate task.");
            }
          }}
        />
      )}
 
      {/* Move Task Dialog */}
      {isMoveTaskDialogOpen && taskToMove && (
        <MoveTaskDialog
          isOpen={isMoveTaskDialogOpen}
          onClose={() => {
            setIsMoveTaskDialogOpen(false);
            setTaskToMove(null);
          }}
          task={taskToMove}
          currentProjectId={project.project_id}
          projectTreeData={projectTreeData}
          onConfirm={handleDialogMoveConfirm}
        />
      )}

      {/* Delete Task Confirmation Dialog */}
      {taskToDelete && (
        <ConfirmationDialog
          isOpen={!!taskToDelete}
          onClose={() => setTaskToDelete(null)}
          onConfirm={async () => {
            if (!taskToDelete) return;
            try {
              await deleteTaskAction(taskToDelete.task_id);
              setProjectTasks(prev => prev.filter(t => t.task_id !== taskToDelete.task_id));
              // Update task count for the phase
              setPhaseTaskCounts(prev => ({
                ...prev,
                [taskToDelete.phase_id]: Math.max((prev[taskToDelete.phase_id] || 0) - 1, 0)
              }));
              toast.success(`Task "${taskToDelete.task_name}" deleted successfully!`);
              setTaskToDelete(null);
            } catch (error) {
              console.error("Error deleting task:", error);
              toast.error("Failed to delete task.");
              setTaskToDelete(null);
            }
          }}
          title="Delete Task"
          message={`Are you sure you want to delete task "${taskToDelete.task_name}"? This action cannot be undone.`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
        />
      )}
    </div>
  );
}
