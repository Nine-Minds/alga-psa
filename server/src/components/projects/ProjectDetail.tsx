'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { IProject, IProjectPhase, IProjectTask, IProjectTicketLink, ProjectStatus } from '@/interfaces/project.interfaces';
import { IUserWithRoles } from '@/interfaces/auth.interfaces';
import { useDrawer } from '@/context/DrawerContext';
import TaskQuickAdd from './TaskQuickAdd';
import TaskEdit from './TaskEdit';
import PhaseQuickAdd from './PhaseQuickAdd';
import { 
  updateTaskStatus, 
  getProjectTaskStatuses, 
  reorderTasksInStatus,
  updatePhase, 
  moveTaskToPhase, 
  updateTaskWithChecklist, 
  deletePhase,
  getTaskChecklistItems 
} from '@/lib/actions/projectActions';
import styles from './ProjectDetail.module.css';
import { Toaster, toast } from 'react-hot-toast';
import { ConfirmationDialog } from '@/components/ui/ConfirmationDialog';
import ProjectPhases from './ProjectPhases';
import KanbanBoard from './KanbanBoard';
import DonutChart from './DonutChart';

interface ProjectDetailProps {
  project: IProject;
  phases: IProjectPhase[];
  tasks: IProjectTask[];
  ticketLinks: IProjectTicketLink[];
  statuses: ProjectStatus[];
  users: IUserWithRoles[];
}

export default function ProjectDetail({ 
  project, 
  phases, 
  tasks: initialTasks, 
  ticketLinks: _ticketLinks, 
  statuses: initialStatuses, 
  users
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

  useEffect(() => {
    return () => {
      if (scrollInterval) {
        clearInterval(scrollInterval);
      }
    };
  }, [scrollInterval]);

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

  const handleDrop = async (e: React.DragEvent, projectStatusMappingId: string) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('text');
    try {
      const updatedTask = await updateTaskStatus(taskId, projectStatusMappingId);
      const checklistItems = await getTaskChecklistItems(taskId);
      const taskWithChecklist = { ...updatedTask, checklist_items: checklistItems };
      
      setProjectTasks(prevTasks =>
        prevTasks.map((task): IProjectTask => 
          task.task_id === taskId ? taskWithChecklist : task
        )
      );
    } catch (error) {
      console.error('Error updating task status:', error);
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
    
    console.log('Drop zone data:', {
      taskId,
      task,
      sourcePhase,
      targetPhase
    });
    
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

      console.log('Moving task:', {
        taskId: moveConfirmation.taskId,
        targetPhaseId: moveConfirmation.targetPhase.phase_id,
        currentStatusMappingId: task.project_status_mapping_id
      });

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
    setIsAddingTask(true);
    setDefaultStatus(status);
    setCurrentPhase(selectedPhase);
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
  };

  const handleSavePhase = async (phase: IProjectPhase) => {
    try {
      if (!editingPhaseName.trim()) {
        toast.error('Phase name cannot be empty');
        return;
      }
  
      await updatePhase(phase.phase_id, {
        phase_name: editingPhaseName
      });
  
      setProjectPhases(prevPhases =>
        prevPhases.map((p): IProjectPhase =>
          p.phase_id === phase.phase_id
            ? { ...p, phase_name: editingPhaseName }
            : p
        )
      );
      
      setEditingPhaseId(null);
      setEditingPhaseName('');
      toast.success('Phase name updated successfully!');
    } catch (error) {
      console.error('Error updating phase name:', error);
      toast.error('Failed to update phase name. Please try again.');
    }
  };

  const handleCancelEdit = () => {
    setEditingPhaseId(null);
    setEditingPhaseName('');
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
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Kanban Board: {selectedPhase.phase_name}</h2>
          <div className="flex items-center space-x-2">
            <DonutChart percentage={completionPercentage} />
            <span className="text-sm font-semibold text-gray-600">
              {completedTasksCount} / {filteredTasks.length} Done
            </span>
          </div>
        </div>
        <div className={styles.kanbanWrapper}>
          <KanbanBoard
            tasks={filteredTasks}
            users={users}
            statuses={projectStatuses}
            isAddingTask={isAddingTask}
            selectedPhase={!!selectedPhase}
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
