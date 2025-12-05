'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from 'server/src/components/ui/Button';
import { Card } from 'server/src/components/ui/Card';
import { Badge } from 'server/src/components/ui/Badge';
import { Input } from 'server/src/components/ui/Input';
import { TextArea } from 'server/src/components/ui/TextArea';
import {
  ArrowLeft,
  Circle,
  Trash,
  FileText,
  Rocket,
  Plus,
  Pencil,
  GripVertical,
  Save,
  X,
  Settings,
  CheckSquare,
  Bug,
  Sparkles,
  TrendingUp,
  Flag,
  BookOpen,
  Users,
  MoreVertical,
  Clock,
} from 'lucide-react';
import {
  IProjectTemplateWithDetails,
  IProjectTemplateTask,
  IProjectTemplatePhase,
  IProjectTemplateStatusMapping,
  IProjectTemplateTaskAssignment,
} from 'server/src/interfaces/projectTemplate.interfaces';
import {
  deleteTemplate,
  updateTemplate,
  addTemplatePhase,
  updateTemplatePhase,
  deleteTemplatePhase,
  reorderTemplatePhase,
  addTemplateTask,
  updateTemplateTask,
  deleteTemplateTask,
  updateTemplateTaskStatus,
  addTemplateStatusMapping,
  removeTemplateStatusMapping,
  reorderTemplateStatusMappings,
  setTaskAdditionalAgents,
} from 'server/src/lib/actions/project-actions/projectTemplateActions';
import { getTenantProjectStatuses } from 'server/src/lib/actions/project-actions/projectTaskStatusActions';
import { getTaskTypes } from 'server/src/lib/actions/project-actions/projectTaskActions';
import { getAllPriorities } from 'server/src/lib/actions/priorityActions';
import { getAllUsers } from 'server/src/lib/actions/user-actions/userActions';
import { ITaskType } from 'server/src/interfaces/project.interfaces';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { toast } from 'react-hot-toast';
import { ApplyTemplateDialog } from './ApplyTemplateDialog';
import { TemplateTaskForm } from './TemplateTaskForm';
import { TemplateStatusManager } from './TemplateStatusManager';
import styles from '../ProjectDetail.module.css';
import { generateKeyBetween } from 'fractional-indexing';
import UserPicker from 'server/src/components/ui/UserPicker';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from 'server/src/components/ui/DropdownMenu';

// Task type icons mapping (fallback icons when database doesn't specify)
const taskTypeIcons: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  task: CheckSquare,
  bug: Bug,
  feature: Sparkles,
  improvement: TrendingUp,
  epic: Flag,
  story: BookOpen,
  milestone: Flag,
  deliverable: FileText,
};

interface TemplateEditorProps {
  template: IProjectTemplateWithDetails;
  onTemplateUpdated: () => void;
}

export default function TemplateEditor({ template: initialTemplate, onTemplateUpdated }: TemplateEditorProps) {
  const router = useRouter();

  // Core state
  const [template, setTemplate] = useState<IProjectTemplateWithDetails>(initialTemplate);
  const [phases, setPhases] = useState<IProjectTemplatePhase[]>(initialTemplate.phases || []);
  const [tasks, setTasks] = useState<IProjectTemplateTask[]>(initialTemplate.tasks || []);
  const [statusMappings, setStatusMappings] = useState<IProjectTemplateStatusMapping[]>(
    initialTemplate.status_mappings || []
  );
  const [taskAssignments, setTaskAssignments] = useState<IProjectTemplateTaskAssignment[]>(
    initialTemplate.task_assignments || []
  );

  // Selection state
  const [selectedPhase, setSelectedPhase] = useState<IProjectTemplatePhase | null>(
    initialTemplate.phases?.[0] || null
  );

  // UI state
  const [isDeleting, setIsDeleting] = useState(false);
  const [showApplyDialog, setShowApplyDialog] = useState(false);
  const [showStatusManager, setShowStatusManager] = useState(false);

  // Phase editing state
  const [editingPhaseId, setEditingPhaseId] = useState<string | null>(null);
  const [editingPhaseName, setEditingPhaseName] = useState('');
  const [editingPhaseDescription, setEditingPhaseDescription] = useState('');
  const [editingPhaseDuration, setEditingPhaseDuration] = useState<number | undefined>();
  const [editingPhaseOffset, setEditingPhaseOffset] = useState<number>(0);

  // Task form state
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [editingTask, setEditingTask] = useState<IProjectTemplateTask | null>(null);
  const [newTaskStatusMappingId, setNewTaskStatusMappingId] = useState<string | null>(null);

  // Drag state
  const [draggedPhaseId, setDraggedPhaseId] = useState<string | null>(null);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [phaseDropTarget, setPhaseDropTarget] = useState<string | null>(null);

  // Reference data
  const [availableStatuses, setAvailableStatuses] = useState<
    Array<{ status_id: string; name: string; color?: string; is_closed?: boolean }>
  >([]);
  const [priorities, setPriorities] = useState<Array<{ priority_id: string; priority_name: string; color?: string }>>([]);
  const [users, setUsers] = useState<IUserWithRoles[]>([]);
  const [taskTypes, setTaskTypes] = useState<ITaskType[]>([]);

  // Load reference data
  useEffect(() => {
    const loadReferenceData = async () => {
      try {
        const [statuses, priorityList, userList, taskTypeList] = await Promise.all([
          getTenantProjectStatuses(),
          getAllPriorities('project_task'),
          getAllUsers(true, 'internal'),
          getTaskTypes(),
        ]);
        setAvailableStatuses(
          statuses.map((s) => ({
            status_id: s.status_id,
            name: s.name,
            color: s.color || undefined,
            is_closed: s.is_closed,
          }))
        );
        setPriorities(
          priorityList.map((p) => ({
            priority_id: p.priority_id,
            priority_name: p.priority_name,
            color: p.color,
          }))
        );
        setUsers(userList);
        setTaskTypes(taskTypeList);
      } catch (error) {
        console.error('Failed to load reference data:', error);
      }
    };
    loadReferenceData();
  }, []);

  // Helper to lighten hex color (for background)
  const lightenColor = (hex: string, percent: number) => {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, Math.floor((num >> 16) + (255 - (num >> 16)) * percent));
    const g = Math.min(255, Math.floor(((num >> 8) & 0x00ff) + (255 - ((num >> 8) & 0x00ff)) * percent));
    const b = Math.min(255, Math.floor((num & 0x0000ff) + (255 - (num & 0x0000ff)) * percent));
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  };

  // ============================================================
  // TEMPLATE ACTIONS
  // ============================================================

  async function handleDeleteTemplate() {
    if (!confirm('Are you sure you want to delete this template?')) {
      return;
    }

    try {
      setIsDeleting(true);
      await deleteTemplate(template.template_id);
      toast.success('Template deleted successfully');
      router.push('/msp/projects/templates');
    } catch (error) {
      toast.error('Failed to delete template');
      console.error('Error deleting template:', error);
    } finally {
      setIsDeleting(false);
    }
  }

  // ============================================================
  // PHASE ACTIONS
  // ============================================================

  const handleAddPhase = async () => {
    try {
      const newPhase = await addTemplatePhase(template.template_id, {
        phase_name: '',
        description: '',
        duration_days: undefined,
        start_offset_days: 0,
      });
      setPhases((prev) => [...prev, newPhase]);
      setSelectedPhase(newPhase);
      // Start editing immediately with empty name
      setEditingPhaseId(newPhase.template_phase_id);
      setEditingPhaseName('');
      setEditingPhaseDescription('');
      setEditingPhaseDuration(undefined);
      setEditingPhaseOffset(0);
    } catch (error) {
      toast.error('Failed to add phase');
      console.error(error);
    }
  };

  const handleEditPhase = (phase: IProjectTemplatePhase) => {
    setEditingPhaseId(phase.template_phase_id);
    setEditingPhaseName(phase.phase_name);
    setEditingPhaseDescription(phase.description || '');
    setEditingPhaseDuration(phase.duration_days || undefined);
    setEditingPhaseOffset(phase.start_offset_days || 0);
  };

  const handleSavePhase = async (phase: IProjectTemplatePhase) => {
    try {
      const updated = await updateTemplatePhase(phase.template_phase_id, {
        phase_name: editingPhaseName,
        description: editingPhaseDescription || undefined,
        duration_days: editingPhaseDuration,
        start_offset_days: editingPhaseOffset,
      });
      setPhases((prev) =>
        prev.map((p) => (p.template_phase_id === phase.template_phase_id ? updated : p))
      );
      if (selectedPhase?.template_phase_id === phase.template_phase_id) {
        setSelectedPhase(updated);
      }
      setEditingPhaseId(null);
      toast.success('Phase updated');
    } catch (error) {
      toast.error('Failed to update phase');
      console.error(error);
    }
  };

  const handleDeletePhase = async (phase: IProjectTemplatePhase) => {
    if (!confirm(`Delete phase "${phase.phase_name}" and all its tasks?`)) {
      return;
    }
    try {
      await deleteTemplatePhase(phase.template_phase_id);
      setPhases((prev) => prev.filter((p) => p.template_phase_id !== phase.template_phase_id));
      setTasks((prev) => prev.filter((t) => t.template_phase_id !== phase.template_phase_id));
      if (selectedPhase?.template_phase_id === phase.template_phase_id) {
        setSelectedPhase(phases.find((p) => p.template_phase_id !== phase.template_phase_id) || null);
      }
      toast.success('Phase deleted');
    } catch (error) {
      toast.error('Failed to delete phase');
      console.error(error);
    }
  };

  // ============================================================
  // PHASE DRAG AND DROP
  // ============================================================

  const handlePhaseDragStart = (e: React.DragEvent, phaseId: string) => {
    setDraggedPhaseId(phaseId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/json', JSON.stringify({ type: 'phase', phaseId }));
  };

  const handlePhaseDragOver = (e: React.DragEvent, targetPhaseId: string) => {
    e.preventDefault();
    // Accept both phase drag and task drag
    if ((draggedPhaseId && draggedPhaseId !== targetPhaseId) || draggedTaskId) {
      setPhaseDropTarget(targetPhaseId);
    }
  };

  const handlePhaseDragLeave = () => {
    setPhaseDropTarget(null);
  };

  const handlePhaseDrop = async (e: React.DragEvent, targetPhase: IProjectTemplatePhase) => {
    e.preventDefault();
    setPhaseDropTarget(null);

    // Handle task drop - move task to another phase
    if (draggedTaskId) {
      const task = tasks.find((t) => t.template_task_id === draggedTaskId);
      if (!task || task.template_phase_id === targetPhase.template_phase_id) {
        setDraggedTaskId(null);
        return;
      }

      try {
        // Move task to the target phase
        const updated = await updateTemplateTask(draggedTaskId, {
          template_phase_id: targetPhase.template_phase_id,
        });
        setTasks((prev) =>
          prev.map((t) => (t.template_task_id === draggedTaskId ? updated : t))
        );
        toast.success(`Task moved to "${targetPhase.phase_name}"`);
      } catch (error) {
        toast.error('Failed to move task');
        console.error(error);
      } finally {
        setDraggedTaskId(null);
        document.body.classList.remove('dragging-task');
      }
      return;
    }

    // Handle phase reorder
    if (!draggedPhaseId || draggedPhaseId === targetPhase.template_phase_id) {
      setDraggedPhaseId(null);
      return;
    }

    try {
      // Sort phases to find positions
      const sortedPhases = [...phases].sort((a, b) => (a.order_key || '').localeCompare(b.order_key || ''));
      const targetIndex = sortedPhases.findIndex((p) => p.template_phase_id === targetPhase.template_phase_id);
      const draggedIndex = sortedPhases.findIndex((p) => p.template_phase_id === draggedPhaseId);

      // Determine before/after phase IDs
      let beforePhaseId: string | null = null;
      let afterPhaseId: string | null = null;

      if (draggedIndex < targetIndex) {
        // Moving down
        beforePhaseId = targetPhase.template_phase_id;
        afterPhaseId = sortedPhases[targetIndex + 1]?.template_phase_id || null;
      } else {
        // Moving up
        beforePhaseId = sortedPhases[targetIndex - 1]?.template_phase_id || null;
        afterPhaseId = targetPhase.template_phase_id;
      }

      const updated = await reorderTemplatePhase(draggedPhaseId, beforePhaseId, afterPhaseId);

      setPhases((prev) =>
        prev.map((p) => (p.template_phase_id === draggedPhaseId ? updated : p))
      );
    } catch (error) {
      toast.error('Failed to reorder phase');
      console.error(error);
    } finally {
      setDraggedPhaseId(null);
    }
  };

  const handlePhaseDragEnd = () => {
    setDraggedPhaseId(null);
    setPhaseDropTarget(null);
  };

  // ============================================================
  // TASK ACTIONS
  // ============================================================

  const handleAddTask = (statusMappingId?: string) => {
    if (!selectedPhase) {
      toast.error('Please select a phase first');
      return;
    }
    setEditingTask(null);
    setNewTaskStatusMappingId(statusMappingId || statusMappings[0]?.template_status_mapping_id || null);
    setShowTaskForm(true);
  };

  const handleEditTask = (task: IProjectTemplateTask) => {
    setEditingTask(task);
    setShowTaskForm(true);
  };

  const handleSaveTask = async (taskData: Partial<IProjectTemplateTask>, additionalAgents?: string[]) => {
    try {
      let taskId: string;

      if (editingTask) {
        // Update existing task
        const updated = await updateTemplateTask(editingTask.template_task_id, taskData);
        setTasks((prev) =>
          prev.map((t) => (t.template_task_id === editingTask.template_task_id ? updated : t))
        );
        taskId = editingTask.template_task_id;
        toast.success('Task updated');
      } else if (selectedPhase) {
        // Create new task - use newTaskStatusMappingId if set, otherwise from taskData or first status
        const statusMappingIdToUse = taskData.template_status_mapping_id || newTaskStatusMappingId || statusMappings[0]?.template_status_mapping_id;
        const newTask = await addTemplateTask(selectedPhase.template_phase_id, {
          task_name: taskData.task_name || 'New Task',
          description: taskData.description,
          estimated_hours: taskData.estimated_hours,
          duration_days: taskData.duration_days,
          task_type_key: taskData.task_type_key,
          priority_id: taskData.priority_id,
          assigned_to: taskData.assigned_to,
          template_status_mapping_id: statusMappingIdToUse,
          service_id: taskData.service_id,
        });
        setTasks((prev) => [...prev, newTask]);
        taskId = newTask.template_task_id;
        toast.success('Task created');
      } else {
        return;
      }

      // Save additional agents if provided
      if (additionalAgents !== undefined) {
        await setTaskAdditionalAgents(taskId, additionalAgents);
        // Update local state
        setTaskAssignments((prev) => {
          // Remove old assignments for this task
          const filtered = prev.filter((a) => a.template_task_id !== taskId);
          // Add new assignments
          const newAssignments = additionalAgents.map((userId) => ({
            template_assignment_id: `temp-${taskId}-${userId}`,
            template_task_id: taskId,
            user_id: userId,
            tenant: template.tenant,
            is_primary: false,
          }));
          return [...filtered, ...newAssignments];
        });
      }

      setShowTaskForm(false);
      setEditingTask(null);
    } catch (error) {
      toast.error('Failed to save task');
      console.error(error);
    }
  };

  const handleDeleteTask = async (task: IProjectTemplateTask) => {
    if (!confirm(`Delete task "${task.task_name}"?`)) {
      return;
    }
    try {
      await deleteTemplateTask(task.template_task_id);
      setTasks((prev) => prev.filter((t) => t.template_task_id !== task.template_task_id));
      toast.success('Task deleted');
    } catch (error) {
      toast.error('Failed to delete task');
      console.error(error);
    }
  };

  // ============================================================
  // TASK DRAG AND DROP
  // ============================================================

  const handleTaskDragStart = (e: React.DragEvent, taskId: string) => {
    setDraggedTaskId(taskId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', taskId);
  };

  const handleTaskDragEnd = () => {
    setDraggedTaskId(null);
  };

  const handleTaskDrop = async (
    e: React.DragEvent,
    targetStatusMappingId: string,
    beforeTaskId: string | null,
    afterTaskId: string | null
  ) => {
    e.preventDefault();

    if (!draggedTaskId) return;

    const task = tasks.find((t) => t.template_task_id === draggedTaskId);
    if (!task) return;

    // Only update if status changed or position changed
    if (task.template_status_mapping_id === targetStatusMappingId && !beforeTaskId && !afterTaskId) {
      setDraggedTaskId(null);
      return;
    }

    try {
      const updated = await updateTemplateTaskStatus(draggedTaskId, targetStatusMappingId, beforeTaskId, afterTaskId);
      setTasks((prev) =>
        prev.map((t) => (t.template_task_id === draggedTaskId ? updated : t))
      );
    } catch (error) {
      toast.error('Failed to move task');
      console.error(error);
    } finally {
      setDraggedTaskId(null);
    }
  };

  const handleAssigneeChange = async (taskId: string, assigneeId: string | null) => {
    try {
      const updated = await updateTemplateTask(taskId, { assigned_to: assigneeId });
      setTasks((prev) => prev.map((t) => (t.template_task_id === taskId ? updated : t)));
    } catch (error) {
      toast.error('Failed to update assignee');
      console.error(error);
    }
  };

  // ============================================================
  // STATUS MANAGEMENT
  // ============================================================

  const handleStatusAdded = (newMapping: IProjectTemplateStatusMapping) => {
    setStatusMappings((prev) => [...prev, newMapping]);
  };

  const handleStatusRemoved = (mappingId: string) => {
    setStatusMappings((prev) => prev.filter((m) => m.template_status_mapping_id !== mappingId));
    // Clear status from tasks that used this mapping
    setTasks((prev) =>
      prev.map((t) =>
        t.template_status_mapping_id === mappingId ? { ...t, template_status_mapping_id: undefined } : t
      )
    );
  };

  const handleStatusReordered = (orderedMappingIds: string[]) => {
    setStatusMappings((prev) => {
      const mappingMap = new Map(prev.map((m) => [m.template_status_mapping_id, m]));
      return orderedMappingIds
        .map((id, index) => {
          const mapping = mappingMap.get(id);
          return mapping ? { ...mapping, display_order: index } : null;
        })
        .filter((m): m is IProjectTemplateStatusMapping => m !== null);
    });
  };

  // ============================================================
  // RENDER
  // ============================================================

  const sortedPhases = [...phases].sort((a, b) => (a.order_key || '').localeCompare(b.order_key || ''));
  const sortedStatusMappings = [...statusMappings].sort((a, b) => a.display_order - b.display_order);

  const phaseTasks = selectedPhase
    ? tasks.filter((task) => task.template_phase_id === selectedPhase.template_phase_id)
    : [];

  return (
    <>
      <ApplyTemplateDialog
        open={showApplyDialog}
        onClose={() => setShowApplyDialog(false)}
        onSuccess={(projectId) => {
          setShowApplyDialog(false);
          router.push(`/msp/projects/${projectId}`);
        }}
        initialTemplateId={template.template_id}
      />

      {showTaskForm && (
        <TemplateTaskForm
          open={showTaskForm}
          onClose={() => {
            setShowTaskForm(false);
            setEditingTask(null);
            setNewTaskStatusMappingId(null);
          }}
          onSave={handleSaveTask}
          task={editingTask}
          taskAssignments={taskAssignments}
          statusMappings={statusMappings}
          priorities={priorities}
          users={users}
          taskTypes={taskTypes}
          initialStatusMappingId={newTaskStatusMappingId}
        />
      )}

      {showStatusManager && (
        <TemplateStatusManager
          open={showStatusManager}
          onClose={() => setShowStatusManager(false)}
          templateId={template.template_id}
          statusMappings={statusMappings}
          availableStatuses={availableStatuses}
          onStatusAdded={handleStatusAdded}
          onStatusRemoved={handleStatusRemoved}
          onStatusReordered={handleStatusReordered}
        />
      )}

      <div className={styles.pageContainer}>
        {/* Template Header */}
        <div className="border-b px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                id="back-to-templates"
                variant="soft"
                onClick={() => router.push('/msp/projects/templates')}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <div className="flex items-center gap-3">
                <Badge variant="secondary" className="flex items-center gap-1">
                  <FileText className="h-3 w-3" />
                  Template
                </Badge>
                <h1 className="text-2xl font-bold">{template.template_name}</h1>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                id="manage-statuses"
                variant="outline"
                onClick={() => setShowStatusManager(true)}
              >
                <Settings className="h-4 w-4 mr-2" />
                Status Columns
              </Button>
              <Button id="use-template" onClick={() => setShowApplyDialog(true)}>
                <Rocket className="h-4 w-4 mr-2" />
                Use Template
              </Button>
              <Button
                id="delete-template"
                variant="outline"
                onClick={handleDeleteTemplate}
                disabled={isDeleting}
              >
                <Trash className="h-4 w-4 mr-2" />
                Delete
              </Button>
            </div>
          </div>

          {/* Template metadata */}
          <div className="mt-4 flex gap-6 text-sm text-gray-600">
            {template.description && (
              <div>
                <span className="font-medium">Description:</span> {template.description}
              </div>
            )}
            {template.category && (
              <div>
                <span className="font-medium">Category:</span> {template.category}
              </div>
            )}
            <div>
              <span className="font-medium">Used:</span> {template.use_count} times
            </div>
          </div>
        </div>

        <div className={styles.mainContent}>
          <div className={styles.contentWrapper}>
            {/* Phases List - Left Side */}
            <div className={styles.phasesList}>
              <Card className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-700">Project Phases</h3>
                  <Button id="add-phase" variant="ghost" size="sm" onClick={handleAddPhase}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <div className="space-y-1">
                  {sortedPhases.length === 0 ? (
                    <div className="text-sm text-gray-500 text-center py-4">
                      No phases yet.
                      <br />
                      <button
                        className="text-purple-600 hover:underline mt-1"
                        onClick={handleAddPhase}
                      >
                        Add your first phase
                      </button>
                    </div>
                  ) : (
                    sortedPhases.map((phase) => {
                      const isDropTarget = phaseDropTarget === phase.template_phase_id;
                      const isTaskDrop = isDropTarget && draggedTaskId;
                      const isPhaseDrop = isDropTarget && draggedPhaseId;
                      const isCurrentPhaseForTask = draggedTaskId &&
                        tasks.find((t) => t.template_task_id === draggedTaskId)?.template_phase_id === phase.template_phase_id;

                      return (
                      <div
                        key={phase.template_phase_id}
                        draggable={editingPhaseId !== phase.template_phase_id}
                        onDragStart={(e) => handlePhaseDragStart(e, phase.template_phase_id)}
                        onDragOver={(e) => handlePhaseDragOver(e, phase.template_phase_id)}
                        onDragLeave={handlePhaseDragLeave}
                        onDrop={(e) => handlePhaseDrop(e, phase)}
                        onDragEnd={handlePhaseDragEnd}
                        className={`${styles.phaseItem} group relative px-3 py-2 rounded-lg transition-all cursor-pointer ${
                          selectedPhase?.template_phase_id === phase.template_phase_id
                            ? 'bg-purple-100 text-purple-900'
                            : 'hover:bg-gray-100 text-gray-700'
                        } ${draggedPhaseId === phase.template_phase_id ? 'opacity-50' : ''} ${
                          isPhaseDrop ? styles.dragOver + ' ring-2 ring-purple-400' : ''
                        } ${
                          isTaskDrop && !isCurrentPhaseForTask
                            ? 'ring-2 ring-blue-400 bg-blue-50 scale-[1.02]'
                            : ''
                        }`}
                        onClick={() => {
                          if (editingPhaseId !== phase.template_phase_id) {
                            setSelectedPhase(phase);
                          }
                        }}
                      >
                        {editingPhaseId === phase.template_phase_id ? (
                          <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                            <Input
                              value={editingPhaseName}
                              onChange={(e) => setEditingPhaseName(e.target.value)}
                              placeholder="Phase name"
                              autoFocus
                            />
                            <TextArea
                              value={editingPhaseDescription}
                              onChange={(e) => setEditingPhaseDescription(e.target.value)}
                              placeholder="Description (optional)"
                              rows={2}
                            />
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-xs text-gray-500">Duration (days)</label>
                                <Input
                                  type="number"
                                  value={editingPhaseDuration || ''}
                                  onChange={(e) =>
                                    setEditingPhaseDuration(e.target.value ? parseInt(e.target.value) : undefined)
                                  }
                                  placeholder="Days"
                                />
                              </div>
                              <div>
                                <label className="text-xs text-gray-500">Start offset</label>
                                <Input
                                  type="number"
                                  value={editingPhaseOffset}
                                  onChange={(e) => setEditingPhaseOffset(parseInt(e.target.value) || 0)}
                                  placeholder="Days"
                                />
                              </div>
                            </div>
                            <div className="flex justify-end gap-2">
                              <Button
                                id="cancel-edit-phase"
                                variant="ghost"
                                size="sm"
                                onClick={() => setEditingPhaseId(null)}
                              >
                                Cancel
                              </Button>
                              <Button id="save-edit-phase" size="sm" onClick={() => handleSavePhase(phase)}>
                                Save
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <GripVertical className="w-4 h-4 text-gray-400 opacity-0 group-hover:opacity-100 cursor-grab" />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">{phase.phase_name}</div>
                              {phase.duration_days && (
                                <div className="text-xs text-gray-500">{phase.duration_days} days</div>
                              )}
                            </div>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleEditPhase(phase);
                                }}
                                className="p-1 rounded hover:bg-gray-200"
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeletePhase(phase);
                                }}
                                className="p-1 rounded hover:bg-red-100 text-red-600"
                              >
                                <Trash className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                      );
                    })
                  )}
                </div>
              </Card>
            </div>

            {/* Kanban Board - Right Side */}
            <div className={styles.kanbanContainer}>
              {!selectedPhase ? (
                <div className="flex items-center justify-center h-64 bg-gray-100 rounded-lg">
                  <div className="text-center">
                    <p className="text-xl text-gray-600">
                      {phases.length === 0
                        ? 'Add a phase to get started'
                        : 'Select a phase to view tasks'}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col h-full">
                  {/* Phase Header */}
                  <div className="mb-4">
                    <div className="flex justify-between items-center gap-4">
                      <div>
                        <h2 className="text-xl font-bold mb-1">Phase: {selectedPhase.phase_name}</h2>
                        {selectedPhase.description && (
                          <p className="text-sm text-gray-600">{selectedPhase.description}</p>
                        )}
                        <div className="text-sm text-gray-500 mt-1">
                          {selectedPhase.duration_days && `Duration: ${selectedPhase.duration_days} days`}
                          {selectedPhase.start_offset_days > 0 &&
                            ` | Start: +${selectedPhase.start_offset_days} days`}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Kanban Board */}
                  <div className={styles.kanbanWrapper}>
                    {sortedStatusMappings.length === 0 ? (
                      <div className="text-center py-8 text-gray-500">
                        <p>No status columns defined</p>
                        <Button
                          id="add-status-columns-empty"
                          variant="outline"
                          className="mt-4"
                          onClick={() => setShowStatusManager(true)}
                        >
                          <Settings className="h-4 w-4 mr-2" />
                          Add Status Columns
                        </Button>
                      </div>
                    ) : (
                      <div className={styles.kanbanBoard}>
                        {sortedStatusMappings.map((statusMapping, index) => {
                          const isFirstColumn = index === 0;
                          const statusTasks = phaseTasks.filter(
                            (task) =>
                              task.template_status_mapping_id ===
                                statusMapping.template_status_mapping_id ||
                              (isFirstColumn && !task.template_status_mapping_id)
                          );

                          const displayName =
                            statusMapping.status_name || statusMapping.custom_status_name || 'Status';
                          const statusColor = statusMapping.color || '#6B7280';

                          return (
                            <StatusColumn
                              key={statusMapping.template_status_mapping_id}
                              statusMapping={statusMapping}
                              displayName={displayName}
                              statusColor={statusColor}
                              tasks={statusTasks}
                              lightenColor={lightenColor}
                              onTaskDragStart={handleTaskDragStart}
                              onTaskDragEnd={handleTaskDragEnd}
                              onTaskDrop={handleTaskDrop}
                              onEditTask={handleEditTask}
                              onDeleteTask={handleDeleteTask}
                              onAddTask={handleAddTask}
                              onAssigneeChange={handleAssigneeChange}
                              draggedTaskId={draggedTaskId}
                              users={users}
                              priorities={priorities}
                              taskAssignments={taskAssignments}
                              taskTypes={taskTypes}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ============================================================
// STATUS COLUMN COMPONENT
// ============================================================

interface StatusColumnProps {
  statusMapping: IProjectTemplateStatusMapping;
  displayName: string;
  statusColor: string;
  tasks: IProjectTemplateTask[];
  lightenColor: (hex: string, percent: number) => string;
  onTaskDragStart: (e: React.DragEvent, taskId: string) => void;
  onTaskDragEnd: () => void;
  onTaskDrop: (
    e: React.DragEvent,
    statusMappingId: string,
    beforeTaskId: string | null,
    afterTaskId: string | null
  ) => void;
  onEditTask: (task: IProjectTemplateTask) => void;
  onDeleteTask: (task: IProjectTemplateTask) => void;
  onAddTask: (statusMappingId: string) => void;
  onAssigneeChange: (taskId: string, assigneeId: string | null) => void;
  draggedTaskId: string | null;
  users: IUserWithRoles[];
  priorities: Array<{ priority_id: string; priority_name: string; color?: string }>;
  taskAssignments: IProjectTemplateTaskAssignment[];
  taskTypes: ITaskType[];
}

function StatusColumn({
  statusMapping,
  displayName,
  statusColor,
  tasks,
  lightenColor,
  onTaskDragStart,
  onTaskDragEnd,
  onTaskDrop,
  onEditTask,
  onDeleteTask,
  onAddTask,
  onAssigneeChange,
  draggedTaskId,
  users,
  priorities,
  taskAssignments,
  taskTypes,
}: StatusColumnProps) {
  const [dropIndicatorPosition, setDropIndicatorPosition] = useState<number | null>(null);
  const [isDraggedOver, setIsDraggedOver] = useState(false);

  const sortedTasks = [...tasks].sort((a, b) => (a.order_key || '').localeCompare(b.order_key || ''));

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();

    if (!isDraggedOver) {
      setIsDraggedOver(true);
    }

    // Find drop position
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;

    // Find the task closest to the cursor
    let position = sortedTasks.length;
    const taskElements = Array.from(e.currentTarget.querySelectorAll('[data-task-id]'));

    for (let i = 0; i < taskElements.length; i++) {
      const taskRect = taskElements[i].getBoundingClientRect();
      const taskMiddle = taskRect.top + taskRect.height / 2 - rect.top;
      if (y < taskMiddle) {
        position = i;
        break;
      }
    }

    setDropIndicatorPosition(position);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Check if we're leaving to a child element or outside the column
    const relatedTarget = e.relatedTarget as Node | null;
    if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
      setDropIndicatorPosition(null);
      setIsDraggedOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();

    const currentDropPosition = dropIndicatorPosition;
    setDropIndicatorPosition(null);
    setIsDraggedOver(false);

    if (!draggedTaskId) return;

    // Calculate before/after task IDs based on position
    let beforeTaskId: string | null = null;
    let afterTaskId: string | null = null;

    if (currentDropPosition !== null) {
      beforeTaskId = sortedTasks[currentDropPosition - 1]?.template_task_id || null;
      afterTaskId = sortedTasks[currentDropPosition]?.template_task_id || null;
    }

    onTaskDrop(e, statusMapping.template_status_mapping_id, beforeTaskId, afterTaskId);
  };

  return (
    <div
      className={`${styles.kanbanColumn} rounded-lg transition-all duration-200 border-2 ${
        isDraggedOver && draggedTaskId ? 'border-purple-500 ' + styles.dragOver : 'border-transparent'
      }`}
      style={{ backgroundColor: lightenColor(statusColor, 0.85) }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Status Column Header */}
      <div className="font-bold text-sm p-3 rounded-t-lg flex items-center justify-between relative">
        <div
          className="flex rounded-[20px] border-2 shadow-sm items-center ps-3 py-3 pe-4"
          style={{
            backgroundColor: lightenColor(statusColor, 0.7),
            borderColor: lightenColor(statusColor, 0.4),
          }}
        >
          <Circle className="w-4 h-4 mr-2" fill={statusColor} stroke={statusColor} />
          <span className="ml-2">{displayName}</span>
        </div>
        <div className={styles.statusHeader}>
          <Button
            id={`add-task-${statusMapping.template_status_mapping_id}`}
            variant="default"
            size="sm"
            onClick={() => onAddTask(statusMapping.template_status_mapping_id)}
            tooltipText="Add Task"
            className="!w-6 !h-6 !p-0 !min-w-0"
          >
            <Plus className="w-4 h-4 text-white" />
          </Button>
          <div className={styles.taskCount}>{sortedTasks.length}</div>
        </div>
      </div>

      {/* Tasks in this status */}
      <div className={styles.kanbanTasks}>
        <div className="space-y-2">
          {sortedTasks.map((task, index) => (
            <div key={task.template_task_id}>
              {/* Drop placeholder before task */}
              <div
                className={`${styles.dropPlaceholder} ${
                  dropIndicatorPosition === index && draggedTaskId ? styles.visible : ''
                }`}
              />
              <TaskCard
                task={task}
                onDragStart={onTaskDragStart}
                onDragEnd={onTaskDragEnd}
                onEdit={onEditTask}
                onDelete={onDeleteTask}
                onAssigneeChange={onAssigneeChange}
                isDragging={draggedTaskId === task.template_task_id}
                users={users}
                priorities={priorities}
                taskAssignments={taskAssignments.filter(
                  (a) => a.template_task_id === task.template_task_id
                )}
                taskType={taskTypes.find((t) => t.type_key === task.task_type_key)}
              />
            </div>
          ))}
          {/* Drop placeholder at end */}
          <div
            className={`${styles.dropPlaceholder} ${
              dropIndicatorPosition === sortedTasks.length && draggedTaskId ? styles.visible : ''
            }`}
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================
// TASK CARD COMPONENT
// ============================================================

interface TaskCardProps {
  task: IProjectTemplateTask;
  onDragStart: (e: React.DragEvent, taskId: string) => void;
  onDragEnd: () => void;
  onEdit: (task: IProjectTemplateTask) => void;
  onDelete: (task: IProjectTemplateTask) => void;
  onAssigneeChange: (taskId: string, assigneeId: string | null) => void;
  isDragging: boolean;
  users: IUserWithRoles[];
  priorities: Array<{ priority_id: string; priority_name: string; color?: string }>;
  taskAssignments: IProjectTemplateTaskAssignment[];
  taskType?: ITaskType;
}

function TaskCard({
  task,
  onDragStart,
  onDragEnd,
  onEdit,
  onDelete,
  onAssigneeChange,
  isDragging,
  users,
  priorities,
  taskAssignments,
  taskType,
}: TaskCardProps) {
  const handleDragStart = (e: React.DragEvent) => {
    document.body.classList.add('dragging-task');
    onDragStart(e, task.template_task_id);
  };

  const handleDragEnd = () => {
    document.body.classList.remove('dragging-task');
    onDragEnd();
  };

  // Get task type icon and color from database, with fallback
  const taskTypeKey = task.task_type_key || 'task';
  const Icon = taskTypeIcons[taskTypeKey] || CheckSquare;
  const iconColor = taskType?.color || '#6B7280';

  // Get priority info
  const priority = priorities.find((p) => p.priority_id === task.priority_id);

  // Get additional agents count
  const additionalAgentsCount = taskAssignments.length;

  return (
    <div
      data-task-id={task.template_task_id}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={() => onEdit(task)}
      className={`${styles.taskCard} relative bg-white border border-gray-200 rounded-lg p-3 shadow-sm transition-all duration-200 flex flex-col gap-1 cursor-pointer hover:border-gray-300 ${
        isDragging ? styles.dragging : ''
      }`}
    >
      {/* Task type indicator */}
      <div className="absolute top-2 left-2" title={taskType?.type_name || taskTypeKey}>
        <Icon className="w-4 h-4" style={{ color: iconColor }} />
      </div>

      {/* Action Menu Button */}
      <div className="absolute top-1 right-1 z-10">
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button
              id={`task-actions-${task.template_task_id}`}
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
            >
              <MoreVertical className="h-4 w-4" />
              <span className="sr-only">Task Actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onSelect={() => onEdit(task)}>
              <Pencil className="mr-2 h-4 w-4" />
              <span>Edit Task</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => onDelete(task)}
              className="text-red-600 focus:text-red-700 focus:bg-red-50"
            >
              <Trash className="mr-2 h-4 w-4" />
              <span>Delete Task</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Task name and priority */}
      <div className="flex items-center gap-2 mb-1 w-full px-1 mt-5">
        <div className="font-semibold text-sm flex-1 truncate">{task.task_name}</div>
        {priority && (
          <div className="flex items-center gap-1 shrink-0">
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: priority.color || '#6B7280' }}
              title={`${priority.priority_name} priority`}
            />
          </div>
        )}
      </div>

      {/* Description */}
      {task.description && (
        <p className="text-xs text-gray-600 mb-1 line-clamp-2 px-1">{task.description}</p>
      )}

      {/* Assignee picker */}
      <div className="flex items-center gap-2 px-1" onClick={(e) => e.stopPropagation()}>
        <UserPicker
          value={task.assigned_to || ''}
          onValueChange={(newAssigneeId: string) =>
            onAssigneeChange(task.template_task_id, newAssigneeId || null)
          }
          size="sm"
          users={users}
        />
        {additionalAgentsCount > 0 && (
          <div
            className="flex items-center gap-1 text-gray-500 bg-primary-100 px-1.5 py-0.5 rounded-md"
            title={`${additionalAgentsCount} additional agent${additionalAgentsCount > 1 ? 's' : ''}`}
          >
            <Users className="w-3 h-3" />
            <span className="text-xs">+{additionalAgentsCount}</span>
          </div>
        )}
      </div>

      {/* Bottom row: estimated hours, duration */}
      <div className="flex items-center justify-between text-xs text-gray-500 px-1 mt-1">
        <div className="flex items-center gap-2">
          {task.estimated_hours && (
            <span className="flex items-center gap-1 bg-gray-100 px-1.5 py-0.5 rounded">
              <Clock className="w-3 h-3" />
              {Number(task.estimated_hours) / 60}h
            </span>
          )}
          {task.duration_days && (
            <span className="bg-gray-100 px-1.5 py-0.5 rounded">{task.duration_days}d</span>
          )}
        </div>
      </div>
    </div>
  );
}
