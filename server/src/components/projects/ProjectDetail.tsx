'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { IProject, IProjectPhase, IProjectTask, IProjectTicketLink, IProjectTicketLinkWithDetails, ProjectStatus } from 'server/src/interfaces/project.interfaces';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { useDrawer } from "server/src/context/DrawerContext";
import TaskQuickAdd from './TaskQuickAdd';
import TaskEdit from './TaskEdit';
import PhaseQuickAdd from './PhaseQuickAdd';
import { getProjectTaskStatuses, updatePhase, deletePhase, getProjectTreeData } from 'server/src/lib/actions/project-actions/projectActions';
import { updateTaskStatus, reorderTasksInStatus, moveTaskToPhase, updateTaskWithChecklist, getTaskChecklistItems } from 'server/src/lib/actions/project-actions/projectTaskActions';
import styles from './ProjectDetail.module.css';
import { Toaster, toast } from 'react-hot-toast';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import ProjectPhases from './ProjectPhases';
import KanbanBoard from './KanbanBoard';
import DonutChart from './DonutChart';
import { calculateProjectCompletion } from 'server/src/lib/utils/projectUtils';
import { ICompany } from 'server/src/interfaces/company.interfaces';

interface ProjectDetailProps {
  project: IProject;
  phases: IProjectPhase[];
  tasks: IProjectTask[];
  ticketLinks: IProjectTicketLink[];
  statuses: ProjectStatus[];
  users: IUserWithRoles[];
  companies: ICompany[];
  contact?: { full_name: string };
  assignedUser?: IUserWithRoles;
}

export default function ProjectDetail({ 
  project, 
  phases, 
  tasks: initialTasks, 
  ticketLinks: _ticketLinks, 
  statuses: initialStatuses, 
  users,
  companies,
  contact,
  assignedUser
}: ProjectDetailProps) {
  const [selectedTask, setSelectedTask] = useState<IProjectTask | null>(null);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showPhaseQuickAdd, setShowPhaseQuickAdd] = useState(false);
  const [currentPhase, setCurrentPhase] = useState<IProjectPhase | null>(null);
  const [selectedPhase, setSelectedPhase] = useState<IProjectPhase | null>(null);
  const { openDrawer: _openDrawer, closeDrawer: _closeDrawer } = useDrawer();
  const [projectTasks, setProjectTasks] = useState<IProjectTask[]>(initialTasks);
  const [projectPhases, setProjectPhases] = useState<IProjectPhase[]>(phases);
  const [projectStatuses, setProjectStatuses] = useState<ProjectStatus[]>(initialStatuses);
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [defaultStatus, setDefaultStatus] = useState<ProjectStatus | null>(null);
  const [editingPhaseId, setEditingPhaseId] = useState<string | null>(null);
  const [editingPhaseName, setEditingPhaseName] = useState('');
  const [editingStartDate, setEditingStartDate] = useState<Date | undefined>(undefined);
  const [editingEndDate, setEditingEndDate] = useState<Date | undefined>(undefined);
  const [dragOverPhaseId, setDragOverPhaseId] = useState<string | null>(null);
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

  const filteredTasks = useMemo(() => {
    if (!selectedPhase) return [];
    return projectTasks.filter(task => task.wbs_code.startsWith(selectedPhase.wbs_code + '.'));
  }, [projectTasks, selectedPhase]);

  const completedTasksCount = useMemo(() => {
    return filteredTasks.filter(task =>
      projectStatuses.find(status => status.project_status_mapping_id === task.project_status_mapping_id)?.is_closed === true
    ).length;
  }, [filteredTasks, projectStatuses]);

  const [scrollInterval, setScrollInterval] = useState<NodeJS.Timeout | null>(null);
  const [projectTreeData, setProjectTreeData] = useState<any[]>([]);

  useEffect(() => {
    return () => {
      if (scrollInterval) {
        clearInterval(scrollInterval);
      }
    };
  }, [scrollInterval]);
  
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
      } catch (error) {
        console.error('Error fetching initial data:', error);
        toast.error('Failed to load initial data');
      }
    };
    
    fetchInitialData();
  }, [project.project_id]);

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
    setDragOverPhaseId(null);
    
    if (scrollInterval) {
      clearInterval(scrollInterval);
      setScrollInterval(null);
    }
  };

  const handleDrop = async (e: React.DragEvent, targetStatusId: string, position: 'before' | 'after' | 'end', relativeTaskId: string | null) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('text');
    const task = projectTasks.find(t => t.task_id === taskId);
    
    if (!task) {
      console.error('Task not found');
      return;
    }

    try {
      // Check if this is a status change or reorder
      if (task.project_status_mapping_id !== targetStatusId) {
        // Get tasks in target status for position calculation
        const tasksInTargetStatus = projectTasks.filter(t => 
          t.project_status_mapping_id === targetStatusId &&
          t.phase_id === task.phase_id
        ).sort((a, b) => a.wbs_code.localeCompare(b.wbs_code));

        // Calculate position index based on relative task and position
        let positionIndex: number;
        if (position === 'end' || !relativeTaskId) {
          positionIndex = tasksInTargetStatus.length;
        } else {
          const relativeTaskIndex = tasksInTargetStatus.findIndex(t => t.task_id === relativeTaskId);
          positionIndex = position === 'before' ? relativeTaskIndex : relativeTaskIndex + 1;
        }

        // Status change with position
        const updatedTask = await updateTaskStatus(taskId, targetStatusId, positionIndex);
        const checklistItems = await getTaskChecklistItems(taskId);
        const taskWithChecklist = { ...updatedTask, checklist_items: checklistItems };
        
        // Remove from current status and add to new status
        setProjectTasks(prevTasks => {
          const newTasks = prevTasks.filter(t => t.task_id !== taskId);
          return [...newTasks, taskWithChecklist];
        });
        
        toast.success(`Task moved to new status`);
      } else {
        // Reorder within same status
        const targetIndex = e.currentTarget.getAttribute('data-index');
        if (targetIndex !== null) {
          const newWbsCode = generateNewWbsCode(
            filteredTasks,
            parseInt(targetIndex, 10)
          );
          
          if (newWbsCode) {
            await reorderTasksInStatus([{
              taskId,
              newWbsCode
            }]);
            
            // Update local state
            setProjectTasks(prevTasks =>
              prevTasks.map((t): IProjectTask =>
                t.task_id === taskId ? { ...t, wbs_code: newWbsCode } : t
              )
            );
          }
        }
      }
    } catch (error) {
      console.error('Error handling drop:', error);
      toast.error('Failed to move task');
    }
  };

  const generateNewWbsCode = (tasks: IProjectTask[], targetIndex: number): string | null => {
    if (tasks.length === 0) return null;
    
    // Get the tasks in the same status
    const statusTasks = tasks.filter(t => 
      t.project_status_mapping_id === tasks[0].project_status_mapping_id
    ).sort((a, b) => a.wbs_code.localeCompare(b.wbs_code));
    
    if (targetIndex === 0) {
      // Insert at beginning
      const nextCode = incrementWbsCode(statusTasks[0].wbs_code, -1);
      return nextCode;
    } else if (targetIndex >= statusTasks.length) {
      // Insert at end
      const prevCode = statusTasks[statusTasks.length - 1].wbs_code;
      return incrementWbsCode(prevCode, 1);
    } else {
      // Insert between two tasks
      const prevCode = statusTasks[targetIndex - 1].wbs_code;
      const nextCode = statusTasks[targetIndex].wbs_code;
      return calculateMiddleWbsCode(prevCode, nextCode);
    }
  };

  const incrementWbsCode = (wbsCode: string, increment: number): string => {
    const parts = wbsCode.split('.');
    const lastPart = parts[parts.length - 1];
    const newLastPart = String(Number(lastPart) + increment).padStart(lastPart.length, '0');
    return [...parts.slice(0, -1), newLastPart].join('.');
  };

  const calculateMiddleWbsCode = (prevCode: string, nextCode: string): string => {
    const prevParts = prevCode.split('.');
    const nextParts = nextCode.split('.');
    
    // Find the first differing part
    let diffIndex = 0;
    while (diffIndex < prevParts.length && 
           diffIndex < nextParts.length &&
           prevParts[diffIndex] === nextParts[diffIndex]) {
      diffIndex++;
    }
    
    // Calculate middle value
    const prevValue = Number(prevParts[diffIndex]);
    const nextValue = Number(nextParts[diffIndex]);
    const middleValue = Math.floor((prevValue + nextValue) / 2);
    
    // If middle value equals prevValue, we need to add another level
    if (middleValue === prevValue) {
      return [...prevParts.slice(0, diffIndex + 1), '1'].join('.');
    }
    
    // Otherwise use the middle value
    return [...prevParts.slice(0, diffIndex), String(middleValue)].join('.');
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

  const handlePhaseDragOver = (e: React.DragEvent, phaseId: string) => {
    e.preventDefault();
    setDragOverPhaseId(phaseId);
    handleDragOver(e);
  };

  const handlePhaseDragLeave = () => {
    setDragOverPhaseId(null);
  };

  const handlePhaseDropZone = async (e: React.DragEvent, targetPhase: IProjectPhase) => {
    e.preventDefault();
    setDragOverPhaseId(null);
    
    const taskId = e.dataTransfer.getData('text/plain');
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
    
    // Create an empty task object with all necessary properties initialized
    const emptyTask: IProjectTask = {
      task_id: '', // Will be generated on save
      task_name: '',
      description: '',
      phase_id: selectedPhase.phase_id,
      wbs_code: selectedPhase.wbs_code + '.1', // Default WBS code
      project_status_mapping_id: status.project_status_mapping_id,
      assigned_to: null,
      due_date: null,
      estimated_hours: 0,
      actual_hours: 0,
      created_at: new Date(),
      updated_at: new Date(),
      checklist_items: [], // Empty checklist for new task
      ticket_links: [], // Empty ticket links for new task
      resources: [] // Empty resources for new task
    };
    
    // Log that we're using the cached project tree data
    console.log('Using cached project tree data for new task dialog');
    
    setIsAddingTask(true);
    setDefaultStatus(status);
    setCurrentPhase(selectedPhase);
    setSelectedTask(emptyTask); // Pass the empty task with all properties initialized
    setShowQuickAdd(true);
  }, [selectedPhase]);

  const handleTaskUpdated = useCallback(async (updatedTask: IProjectTask | null) => {
    if (updatedTask) {
      try {
        const checklistItems = await getTaskChecklistItems(updatedTask.task_id);
        const taskWithChecklist = { ...updatedTask, checklist_items: checklistItems };
        
        setProjectTasks((prevTasks) =>
          prevTasks.map((task): IProjectTask => 
            task.task_id === updatedTask.task_id ? taskWithChecklist : task
          )
        );
        toast.success('Task updated successfully!');
      } catch (error) {
        console.error('Error updating task:', error);
        toast.error('Failed to update task');
      }
    } else {
      setProjectTasks((prevTasks) =>
        prevTasks.filter((task) => task.task_id !== selectedTask?.task_id)
      );
      toast.success('Task deleted successfully!');
    }
    setShowQuickAdd(false);
    setSelectedTask(null);
  }, [selectedTask]);

  const handleTaskSelected = useCallback((task: IProjectTask) => {
    // Log that we're using the cached project tree data for editing
    console.log('Using cached project tree data for edit task dialog');
    
    setSelectedTask(task);
    setCurrentPhase(phases.find(phase => phase.phase_id === task.phase_id) || null);
    setShowQuickAdd(true);
  }, [phases]);

  const handleAssigneeChange = async (taskId: string, newAssigneeId: string, newTaskName?: string) => {
    try {
      const task = projectTasks.find(t => t.task_id === taskId);
      if (!task) {
        throw new Error('Task not found');
      }
  
      const updatedTask = await updateTaskWithChecklist(taskId, {
        ...task,
        assigned_to: newAssigneeId === 'unassigned' || newAssigneeId === '' ? null : newAssigneeId,
        task_name: newTaskName || task.task_name,
        estimated_hours: Number(task.estimated_hours) || 0,
        actual_hours: Number(task.actual_hours) || 0,
        checklist_items: task.checklist_items
      });
  
      if (updatedTask) {
        const checklistItems = await getTaskChecklistItems(taskId);
        const taskWithChecklist = { ...updatedTask, checklist_items: checklistItems };
        
        setProjectTasks(prevTasks =>
          prevTasks.map((task): IProjectTask =>
            task.task_id === taskId ? taskWithChecklist : task
          )
        );
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
        start_date: editingStartDate || null,
        end_date: editingEndDate || null
      });
  
      setProjectPhases(prevPhases =>
        prevPhases.map((p): IProjectPhase =>
          p.phase_id === phase.phase_id
            ? { 
                ...p, 
                phase_name: editingPhaseName,
                start_date: updatedPhase.start_date,
                end_date: updatedPhase.end_date
              }
            : p
        )
      );
      
      setEditingPhaseId(null);
      setEditingPhaseName('');
      setEditingStartDate(undefined);
      setEditingEndDate(undefined);
      toast.success('Phase updated successfully!');
    } catch (error) {
      console.error('Error updating phase name:', error);
      toast.error('Failed to update phase name. Please try again.');
    }
  };

  const handleCancelEdit = () => {
    setEditingPhaseId(null);
    setEditingPhaseName('');
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

  const renderContent = () => {
    if (!selectedPhase) {
      return (
        <div className="flex items-center justify-center h-64 bg-gray-100 rounded-lg">
          <p className="text-xl text-gray-600">Please select a phase to view the Kanban board.</p>
        </div>
      );
    }

    const completionPercentage = (completedTasksCount / filteredTasks.length) * 100 || 0;

    return (
      <div className="flex flex-col h-full">
        <div className="mb-4">
          <div className="grid grid-cols-12 gap-4 items-center mb-4">
            {/* Section 1: Kanban Board Title (6/12) */}
            <div className="col-span-6">
              <h2 className="text-xl font-bold">Kanban Board: {selectedPhase.phase_name}</h2>
            </div>
            
            {/* Section 2: Donut Chart (6/12) */}
            <div className="col-span-6 flex items-center justify-end space-x-2">
              <DonutChart 
                percentage={completionPercentage} 
                tooltipContent={`Shows the percentage of completed tasks for the selected phase "${selectedPhase.phase_name}" only`}
              />
              <span className="text-sm font-semibold text-gray-600">
                {completedTasksCount} / {filteredTasks.length} Done
              </span>
            </div>
          </div>
        </div>
        <div className={styles.kanbanWrapper}>
          <KanbanBoard
            tasks={projectTasks} // Pass all tasks for cross-status moves
            phaseTasks={filteredTasks} // Tasks for the current phase
            users={users}
            statuses={projectStatuses}
            isAddingTask={isAddingTask}
            selectedPhase={!!selectedPhase}
            ticketLinks={projectTasks.reduce((acc, task) => {
              if (task.ticket_links) {
                acc[task.task_id] = task.ticket_links;
              }
              return acc;
            }, {} as { [taskId: string]: IProjectTicketLinkWithDetails[] })}
            taskResources={projectTasks.reduce((acc, task) => {
              if (task.resources) {
                acc[task.task_id] = task.resources;
              }
              return acc;
            }, {} as { [taskId: string]: any[] })}
            projectTreeData={projectTreeData} // Pass project tree data
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onAddCard={handleAddCard}
            onTaskSelected={handleTaskSelected}
            onAssigneeChange={handleAssigneeChange}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onReorderTasks={handleReorderTasks}
          />
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
          <div className={styles.phasesList}>
            <ProjectPhases
              phases={projectPhases}
              selectedPhase={selectedPhase}
              isAddingTask={isAddingTask}
              editingPhaseId={editingPhaseId}
              editingPhaseName={editingPhaseName}
              editingStartDate={editingStartDate}
              editingEndDate={editingEndDate}
              dragOverPhaseId={dragOverPhaseId}
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
              onEditingStartDateChange={setEditingStartDate}
              onEditingEndDateChange={setEditingEndDate}
              onDragOver={handlePhaseDragOver}
              onDragLeave={handlePhaseDragLeave}
              onDrop={handlePhaseDropZone}
            />
          </div>
          <div className={styles.kanbanContainer}>
            {renderContent()}
          </div>
        </div>
      </div>

      {(showQuickAdd && (currentPhase || selectedPhase)) && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
          <div className="bg-white p-6 rounded-lg shadow-lg relative">
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
                task={selectedTask || undefined} // Pass the empty task object or undefined
                projectTreeData={projectTreeData} // Pass the project tree data
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
    </div>
  );
}
