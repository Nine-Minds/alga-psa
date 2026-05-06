'use client';

import { useState, useEffect, useRef } from 'react';
import {
  parseTaskRichTextContent,
  serializeTaskRichTextContent,
  serializeTaskDescriptions,
  isTaskRichTextEmpty,
} from '../../lib/taskRichText';
import { TextEditor } from '@alga-psa/ui/editor';
import type { BlockNoteEditor, PartialBlock } from '@blocknote/core';
import { searchUsersForMentions } from '@alga-psa/user-composition/actions';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Button } from '@alga-psa/ui/components/Button';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import UserAndTeamPicker from '@alga-psa/ui/components/UserAndTeamPicker';
import MultiUserAndTeamPicker from '@alga-psa/ui/components/MultiUserAndTeamPicker';
import { getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import { getTeams, getTeamAvatarUrlsBatchAction } from '@alga-psa/teams/actions';
import type { ITeam } from '@alga-psa/types';
import TeamAvatar from '@alga-psa/ui/components/TeamAvatar';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { TaskTypeSelector } from '../TaskTypeSelector';
import { ListChecks, Link2, Pencil, Plus, Trash2, Ban, GitBranch, GripVertical } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Badge } from '@alga-psa/ui/components/Badge';
import {
  IProjectTemplateTask,
  IProjectTemplateStatusMapping,
  IProjectTemplateTaskAssignment,
  IProjectTemplateChecklistItem,
  IProjectTemplateDependency,
} from '@alga-psa/types';
import { DependencyType } from '@alga-psa/types';
import { IUserWithRoles } from '@alga-psa/types';
import { ITaskType } from '@alga-psa/types';
import { IService } from '@alga-psa/types';
import { getServices } from '@alga-psa/projects/actions/serviceCatalogActions';
import { useTranslation } from 'react-i18next';
import checklistDnd from '../ChecklistDragDrop.module.css';

/**
 * Local checklist item - unified type for both new and existing items.
 * Used for local state management before saving to the database.
 */
export interface LocalChecklistItem {
  /**
   * Item identifier:
   * - For existing items: the actual `template_checklist_id` UUID from the database
   * - For new items: a client-generated temporary id with "temp_" prefix (e.g., "temp_1234567890")
   *   These temp ids are NOT real UUIDs and are replaced with actual UUIDs when saved to the database.
   */
  id: string;
  item_name: string;
  description?: string;
  completed: boolean;
  order_number: number;
  /** True for items created in this editing session (not yet saved to DB) */
  isNew?: boolean;
}

/** Local dependency for tracking changes before save */
interface LocalDependency {
  id: string;
  predecessorTaskId: string;
  predecessorTaskName: string;
  dependencyType: DependencyType;
  isNew: boolean;
}

interface TemplateTaskFormProps {
  open: boolean;
  onClose: () => void;
  onSave: (
    taskData: Partial<IProjectTemplateTask>,
    additionalAgents?: string[],
    checklistItems?: LocalChecklistItem[],
    dependencyChanges?: {
      added: Array<{ predecessorTaskId: string; dependencyType: DependencyType }>;
      removed: string[];
    }
  ) => void;
  task: IProjectTemplateTask | null;
  taskAssignments?: IProjectTemplateTaskAssignment[];
  statusMappings: IProjectTemplateStatusMapping[];
  priorities: Array<{ priority_id: string; priority_name: string }>;
  users: IUserWithRoles[];
  taskTypes: ITaskType[];
  /** Initial status mapping ID for new tasks (e.g., when clicking + on a status column) */
  initialStatusMappingId?: string | null;
  /** Checklist items for the task being edited */
  checklistItems?: IProjectTemplateChecklistItem[];
  /** All tasks in the template (for dependency selection) */
  allTasks?: IProjectTemplateTask[];
  /** Current dependencies where this task is the successor */
  dependencies?: IProjectTemplateDependency[];
  /** Tenant for fetching avatar URLs */
  tenant?: string;
}

export function TemplateTaskForm({
  open,
  onClose,
  onSave,
  task,
  taskAssignments = [],
  statusMappings,
  priorities,
  users,
  taskTypes,
  initialStatusMappingId,
  checklistItems = [],
  allTasks = [],
  dependencies = [],
  tenant,
}: TemplateTaskFormProps) {
  const { t } = useTranslation(['features/projects', 'common']);
  const [teams, setTeams] = useState<ITeam[]>([]);
  const [taskName, setTaskName] = useState('');
  const [descriptionContent, setDescriptionContent] = useState<PartialBlock[]>(() =>
    parseTaskRichTextContent(null)
  );
  const [descriptionEditorKey, setDescriptionEditorKey] = useState(0);
  // Live BlockNote editor instance — used so dirty checks read the normalized
  // document and don't false-positive when BlockNote adds default props/IDs.
  const blockNoteEditorRef = useRef<BlockNoteEditor<any, any, any> | null>(null);
  // Serialized baseline captured after editor normalization completes.
  const initialDescriptionSerializedRef = useRef<string | null>(null);
  const [estimatedHours, setEstimatedHours] = useState<string>('');
  const [durationDays, setDurationDays] = useState<string>('');
  const [taskTypeKey, setTaskTypeKey] = useState('');
  const [priorityId, setPriorityId] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [assignedTeamId, setAssignedTeamId] = useState<string | null>(null);
  const [additionalAgents, setAdditionalAgents] = useState<string[]>([]);
  const [statusMappingId, setStatusMappingId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [availableServices, setAvailableServices] = useState<IService[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Checklist state - unified approach like projects
  const [localChecklistItems, setLocalChecklistItems] = useState<LocalChecklistItem[]>([]);
  const [isEditingChecklist, setIsEditingChecklist] = useState(false);
  const [editingChecklistItemId, setEditingChecklistItemId] = useState<string | null>(null);
  const [draggedChecklistId, setDraggedChecklistId] = useState<string | null>(null);
  const [dragOverChecklistId, setDragOverChecklistId] = useState<string | null>(null);
  const [checklistDropPosition, setChecklistDropPosition] = useState<'before' | 'after' | null>(null);
  const [recentlyDroppedChecklistId, setRecentlyDroppedChecklistId] = useState<string | null>(null);
  // Tracks whether the latest mousedown landed inside a checklist drag handle.
  // dragstart fires on the wrapper (the draggable element) and its e.target is
  // the wrapper, not the original mousedown target — so we capture that origin
  // here on mousedown and use it to gate dragstart.
  const checklistDragOriginIsHandleRef = useRef(false);

  // Dependency state
  const [localDependencies, setLocalDependencies] = useState<LocalDependency[]>([]);
  const [removedDependencyIds, setRemovedDependencyIds] = useState<string[]>([]);
  const [newDependencyTask, setNewDependencyTask] = useState('');
  const [newDependencyType, setNewDependencyType] = useState<DependencyType>('blocked_by');

  // Confirmation dialog for unsaved changes
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // Track initial values for dirty state checking
  const [initialValues, setInitialValues] = useState<{
    taskName: string;
    descriptionSerialized: string;
    estimatedHours: string;
    durationDays: string;
    taskTypeKey: string;
    priorityId: string;
    assignedTo: string;
    assignedTeamId: string | null;
    additionalAgents: string[];
    statusMappingId: string;
    serviceId: string;
    checklistItems: LocalChecklistItem[];
    dependencies: LocalDependency[];
  } | null>(null);

  // Fetch services on mount
  useEffect(() => {
    const fetchServices = async () => {
      try {
        const response = await getServices(1, 999);
        setAvailableServices(response.services);
      } catch (err) {
        console.error('Failed to fetch services:', err);
      }
    };
    fetchServices();
  }, []);

  // Fetch teams
  useEffect(() => {
    const fetchTeams = async () => {
      try {
        const fetchedTeams = await getTeams();
        setTeams(fetchedTeams);
      } catch (err) {
        console.error('Failed to fetch teams:', err);
      }
    };
    fetchTeams();
  }, []);

  // Fetch team avatar URL when assigned team changes
  const [teamAvatarUrl, setTeamAvatarUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!assignedTeamId || !tenant) {
      setTeamAvatarUrl(null);
      return;
    }
    const fetchTeamAvatar = async () => {
      try {
        const result = await getTeamAvatarUrlsBatchAction([assignedTeamId], tenant);
        const urls: Map<string, string | null> = result instanceof Map ? result : new Map(Object.entries(result) as [string, string | null][]);
        setTeamAvatarUrl(urls.get(assignedTeamId) ?? null);
      } catch {
        setTeamAvatarUrl(null);
      }
    };
    fetchTeamAvatar();
  }, [assignedTeamId, tenant]);

  // Reset form when dialog opens/closes or task changes
  useEffect(() => {
    if (open) {
      let formValues: typeof initialValues;

      if (task) {
        const taskNameVal = task.task_name || '';
        const descriptionBlocks = parseTaskRichTextContent(task.description_rich_text ?? task.description);
        const descriptionSerializedVal = isTaskRichTextEmpty(descriptionBlocks)
          ? ''
          : serializeTaskRichTextContent(descriptionBlocks);
        const estimatedHoursVal = task.estimated_hours ? (Number(task.estimated_hours) / 60).toString() : '';
        const durationDaysVal = task.duration_days?.toString() || '';
        const taskTypeKeyVal = task.task_type_key || '';
        const priorityIdVal = task.priority_id || '';
        const assignedToVal = task.assigned_to || '';
        const assignedTeamIdVal = task.assigned_team_id || null;
        const taskAdditionalAgents = taskAssignments
          .filter(a => a.template_task_id === task.template_task_id)
          .map(a => a.user_id);
        const statusMappingIdVal = task.template_status_mapping_id || statusMappings[0]?.template_status_mapping_id || '';
        const serviceIdVal = task.service_id || '';
        const checklistItemsVal = checklistItems.map(item => ({
          id: item.template_checklist_id,
          item_name: item.item_name,
          description: item.description,
          completed: item.completed,
          order_number: item.order_number,
          isNew: false,
        }));
        const dependenciesVal = dependencies.map(dep => {
          const predTask = allTasks.find(t => t.template_task_id === dep.predecessor_task_id);
          return {
            id: dep.template_dependency_id,
            predecessorTaskId: dep.predecessor_task_id,
            predecessorTaskName: predTask?.task_name || t('templates.editor.unknownTask', 'Unknown task'),
            dependencyType: dep.dependency_type,
            isNew: false,
          };
        });

        setTaskName(taskNameVal);
        setDescriptionContent(descriptionBlocks);
        setDescriptionEditorKey(prev => prev + 1);
        setEstimatedHours(estimatedHoursVal);
        setDurationDays(durationDaysVal);
        setTaskTypeKey(taskTypeKeyVal);
        setPriorityId(priorityIdVal);
        setAssignedTo(assignedToVal);
        setAssignedTeamId(assignedTeamIdVal);
        setAdditionalAgents(taskAdditionalAgents);
        setStatusMappingId(statusMappingIdVal);
        setServiceId(serviceIdVal);
        setLocalChecklistItems(checklistItemsVal);
        setLocalDependencies(dependenciesVal);
        setRemovedDependencyIds([]);

        formValues = {
          taskName: taskNameVal,
          descriptionSerialized: descriptionSerializedVal,
          estimatedHours: estimatedHoursVal,
          durationDays: durationDaysVal,
          taskTypeKey: taskTypeKeyVal,
          priorityId: priorityIdVal,
          assignedTo: assignedToVal,
          assignedTeamId: assignedTeamIdVal,
          additionalAgents: [...taskAdditionalAgents],
          statusMappingId: statusMappingIdVal,
          serviceId: serviceIdVal,
          checklistItems: checklistItemsVal,
          dependencies: dependenciesVal,
        };
      } else {
        // New task
        const statusMappingIdVal = initialStatusMappingId || statusMappings[0]?.template_status_mapping_id || '';

        setTaskName('');
        setDescriptionContent(parseTaskRichTextContent(null));
        setDescriptionEditorKey(prev => prev + 1);
        setEstimatedHours('');
        setDurationDays('');
        setTaskTypeKey('');
        setPriorityId('');
        setAssignedTo('');
        setAssignedTeamId(null);
        setAdditionalAgents([]);
        setStatusMappingId(statusMappingIdVal);
        setServiceId('');
        setLocalChecklistItems([]);
        setLocalDependencies([]);
        setRemovedDependencyIds([]);

        formValues = {
          taskName: '',
          descriptionSerialized: '',
          estimatedHours: '',
          durationDays: '',
          taskTypeKey: '',
          priorityId: '',
          assignedTo: '',
          assignedTeamId: null,
          additionalAgents: [],
          statusMappingId: statusMappingIdVal,
          serviceId: '',
          checklistItems: [],
          dependencies: [],
        };
      }

      setInitialValues(formValues);
      setError(null);
      setIsEditingChecklist(false);
      setNewDependencyTask('');
      setNewDependencyType('blocked_by');
      setShowCancelConfirm(false);
    }
  }, [open, task, taskAssignments, statusMappings, initialStatusMappingId, checklistItems, dependencies, allTasks]);

  // Capture the BlockNote-normalized description as the dirty-check baseline
  // after the editor initializes. Without this, opening a task and changing
  // nothing can flag "unsaved changes" because BlockNote adds block IDs /
  // default props on load and parseTaskRichTextContent's output doesn't match.
  useEffect(() => {
    if (!open) return;
    initialDescriptionSerializedRef.current = null;
    let frameId: number | null = null;
    const capture = () => {
      const editor = blockNoteEditorRef.current;
      if (editor) {
        const blocks = editor.document as PartialBlock[];
        initialDescriptionSerializedRef.current = isTaskRichTextEmpty(blocks)
          ? ''
          : serializeTaskRichTextContent(blocks);
        frameId = null;
        return;
      }
      frameId = requestAnimationFrame(capture);
    };
    frameId = requestAnimationFrame(capture);
    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, [open, task?.template_task_id, descriptionEditorKey]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!taskName.trim()) {
      setError(t('templates.taskForm.taskNameRequired', 'Task name is required'));
      return;
    }

    if (additionalAgents.length > 0 && !assignedTo) {
      toast.error(t('templates.taskForm.primaryAgentRequired', 'Primary agent is required when additional agents are assigned'));
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Filter out empty items before saving
      const validChecklistItems = localChecklistItems.filter(item => item.item_name.trim());

      // Build dependency changes
      const addedDependencies = localDependencies
        .filter(d => d.isNew)
        .map(d => ({
          predecessorTaskId: d.predecessorTaskId,
          dependencyType: d.dependencyType,
        }));

      // Serialize the rich-text description. Prefer the live editor document
      // (which has BlockNote's normalized form) so saves preserve what the
      // user actually sees.
      const liveBlocks = (blockNoteEditorRef.current?.document as PartialBlock[] | undefined) ?? descriptionContent;
      const { description: descriptionMd, description_rich_text: descriptionRichText } =
        serializeTaskDescriptions(liveBlocks);

      await onSave(
        {
          task_name: taskName.trim(),
          description: descriptionMd ?? undefined,
          description_rich_text: descriptionRichText ?? undefined,
          // Convert from hours (display) to minutes (storage)
          estimated_hours: estimatedHours ? Math.round(parseFloat(estimatedHours) * 60) : undefined,
          duration_days: durationDays ? parseInt(durationDays) : undefined,
          task_type_key: taskTypeKey || undefined,
          priority_id: priorityId || undefined,
          assigned_to: assignedTo || undefined,
          assigned_team_id: assignedTeamId || null,
          template_status_mapping_id: statusMappingId || undefined,
          service_id: serviceId || null,
        },
        additionalAgents,
        validChecklistItems,
        {
          added: addedDependencies,
          removed: removedDependencyIds,
        }
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t('templates.taskForm.saveFailed', 'Failed to save task'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Checklist handlers - direct state updates like projects
  const addChecklistItem = (insertAtIndex?: number): string => {
    const newId = `temp_${Date.now()}`;
    const newItem: LocalChecklistItem = {
      id: newId,
      item_name: '',
      completed: false,
      order_number: 0, // recomputed below
      isNew: true,
    };
    setLocalChecklistItems(prev => {
      const sorted = [...prev].sort((a, b) => a.order_number - b.order_number);
      const at = insertAtIndex === undefined
        ? sorted.length
        : Math.max(0, Math.min(insertAtIndex, sorted.length));
      sorted.splice(at, 0, newItem);
      return sorted.map((it, i) => ({ ...it, order_number: i }));
    });
    setIsEditingChecklist(true);
    return newId;
  };

  const handleTemplateChecklistKeyDown = (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    index: number
  ) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const newId = addChecklistItem(index + 1);
      setEditingChecklistItemId(newId);
    }
  };

  const updateChecklistItem = (id: string, field: keyof LocalChecklistItem, value: string | boolean) => {
    setLocalChecklistItems(prev =>
      prev.map(item =>
        item.id === id ? { ...item, [field]: value } : item
      )
    );
  };

  const removeChecklistItem = (id: string) => {
    setLocalChecklistItems(prev => prev.filter(item => item.id !== id));
  };

  const resetChecklistDragState = () => {
    setDraggedChecklistId(null);
    setDragOverChecklistId(null);
    setChecklistDropPosition(null);
  };

  const handleChecklistDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    // Defer the state update past the dragstart frame. Updating React state
    // synchronously here mutates the wrapper's DOM children (e.g. removing
    // the insertZone via the !isAnyDragging condition) and that mutation
    // cancels the drag in some browsers / for items deeper in a scroll
    // container — symptoms: only the first few items appeared draggable.
    requestAnimationFrame(() => setDraggedChecklistId(id));
  };

  const handleChecklistDragOver = (e: React.DragEvent, id: string) => {
    if (!draggedChecklistId || draggedChecklistId === id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const position: 'before' | 'after' =
      e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    if (dragOverChecklistId !== id || checklistDropPosition !== position) {
      setDragOverChecklistId(id);
      setChecklistDropPosition(position);
    }
  };

  const handleChecklistDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const fromId = draggedChecklistId;
    const position = checklistDropPosition;
    resetChecklistDragState();
    if (!fromId || fromId === targetId || position === null) return;

    let didMove = false;
    setLocalChecklistItems(prev => {
      const sorted = [...prev].sort((a, b) => a.order_number - b.order_number);
      const fromIndex = sorted.findIndex(i => i.id === fromId);
      const targetIndex = sorted.findIndex(i => i.id === targetId);
      if (fromIndex === -1 || targetIndex === -1) return prev;

      let insertAt = position === 'after' ? targetIndex + 1 : targetIndex;
      if (fromIndex < insertAt) insertAt -= 1;
      if (insertAt === fromIndex) return prev;

      const [moved] = sorted.splice(fromIndex, 1);
      sorted.splice(insertAt, 0, moved);
      didMove = true;
      return sorted.map((it, i) => ({ ...it, order_number: i }));
    });

    if (didMove) {
      setRecentlyDroppedChecklistId(fromId);
      window.setTimeout(
        () => setRecentlyDroppedChecklistId((curr) => (curr === fromId ? null : curr)),
        400
      );
    }
  };

  // Dependency handlers
  const addDependency = () => {
    if (!newDependencyTask) return;

    // Check for duplicates
    if (localDependencies.some(d => d.predecessorTaskId === newDependencyTask)) {
      return;
    }

    const predTask = allTasks.find(t => t.template_task_id === newDependencyTask);
    if (!predTask) return;

    const newDep: LocalDependency = {
      id: `temp_${Date.now()}`,
      predecessorTaskId: newDependencyTask,
      predecessorTaskName: predTask.task_name,
      dependencyType: newDependencyType,
      isNew: true,
    };

    setLocalDependencies(prev => [...prev, newDep]);
    setNewDependencyTask('');
    setNewDependencyType('blocked_by');
  };

  const removeDependency = (dep: LocalDependency) => {
    setLocalDependencies(prev => prev.filter(d => d.id !== dep.id));
    if (!dep.isNew) {
      setRemovedDependencyIds(prev => [...prev, dep.id]);
    }
  };

  // Get dependency type icon and label
  const getDependencyTypeInfo = (type: DependencyType) => {
    switch (type) {
      case 'blocks':
        return { icon: <Ban className="h-4 w-4 text-destructive" />, label: t('taskDependencies.blocks', 'Blocks') };
      case 'blocked_by':
        return { icon: <Ban className="h-4 w-4 text-orange-500" />, label: t('taskDependencies.blockedBy', 'Blocked by') };
      case 'related_to':
        return { icon: <GitBranch className="h-4 w-4 text-blue-500" />, label: t('taskDependencies.relatedTo', 'Related to') };
      default:
        return { icon: <Link2 className="h-4 w-4 text-gray-500" />, label: type };
    }
  };

  // Filter available tasks (exclude current task and already selected)
  const availableTasksForDependency = allTasks.filter(
    t => t.template_task_id !== task?.template_task_id &&
         !localDependencies.some(d => d.predecessorTaskId === t.template_task_id)
  );

  // Check if any changes have been made
  const hasChanges = (): boolean => {
    if (!initialValues) return false;

    // Compare simple values
    if (taskName !== initialValues.taskName) return true;
    // Read current description from the live editor when available so both
    // sides of the comparison use BlockNote's normalized form (same pattern
    // as TaskForm). Fall back to the React state when the editor isn't
    // attached yet (very early dirty-checks before first paint).
    const liveBlocks = (blockNoteEditorRef.current?.document as PartialBlock[] | undefined) ?? descriptionContent;
    const currentDescriptionSerialized = isTaskRichTextEmpty(liveBlocks)
      ? ''
      : serializeTaskRichTextContent(liveBlocks);
    const baselineDescriptionSerialized = initialDescriptionSerializedRef.current ?? initialValues.descriptionSerialized;
    if (currentDescriptionSerialized !== baselineDescriptionSerialized) return true;
    if (estimatedHours !== initialValues.estimatedHours) return true;
    if (durationDays !== initialValues.durationDays) return true;
    if (taskTypeKey !== initialValues.taskTypeKey) return true;
    if (priorityId !== initialValues.priorityId) return true;
    if (assignedTo !== initialValues.assignedTo) return true;
    if (assignedTeamId !== initialValues.assignedTeamId) return true;
    if (statusMappingId !== initialValues.statusMappingId) return true;
    if (serviceId !== initialValues.serviceId) return true;

    // Compare additional agents array
    if (additionalAgents.length !== initialValues.additionalAgents.length) return true;
    const sortedCurrent = [...additionalAgents].sort();
    const sortedInitial = [...initialValues.additionalAgents].sort();
    if (sortedCurrent.some((id, i) => id !== sortedInitial[i])) return true;

    // Compare checklist items
    if (localChecklistItems.length !== initialValues.checklistItems.length) return true;
    for (let i = 0; i < localChecklistItems.length; i++) {
      const current = localChecklistItems[i];
      const initial = initialValues.checklistItems[i];
      if (!initial) return true;
      if (current.item_name !== initial.item_name) return true;
      if (current.completed !== initial.completed) return true;
    }

    // Compare dependencies (check for added or removed)
    if (localDependencies.length !== initialValues.dependencies.length) return true;
    if (removedDependencyIds.length > 0) return true;
    if (localDependencies.some(d => d.isNew)) return true;

    return false;
  };

  // Handle close with dirty state check
  const handleClose = () => {
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

  const footer = (
    <div className="flex justify-end gap-2">
      <Button
        id="cancel-task-form"
        type="button"
        variant="outline"
        onClick={handleClose}
        disabled={isSubmitting}
      >
        {t('common:actions.cancel', 'Cancel')}
      </Button>
      <Button
        id="save-task-form"
        type="button"
        disabled={isSubmitting || !taskName.trim()}
        onClick={() => (document.getElementById('template-task-form') as HTMLFormElement | null)?.requestSubmit()}
      >
        {isSubmitting
          ? t('templates.taskForm.saving', 'Saving...')
          : task
            ? t('templates.taskForm.updateAction', 'Update Task')
            : t('templates.taskForm.addAction', 'Add Task')}
      </Button>
    </div>
  );

  return (
    <>
    <Dialog
      isOpen={open}
      onClose={handleClose}
      title={task
        ? t('templates.taskForm.editTitle', 'Edit Task')
        : t('templates.taskForm.addTitle', 'Add Task')}
      className="max-w-2xl"
      id="template-task-form-dialog"
      footer={footer}
    >
      <DialogContent>
        <form onSubmit={handleSubmit} id="template-task-form">
          <div className="space-y-4">
            {/* Task Name */}
            <div>
              <Label htmlFor="task-name" className="block text-sm font-medium text-gray-700 mb-1">
                {t('templates.wizard.tasks.taskName', 'Task Name *')}
              </Label>
              <Input
                id="task-name"
                value={taskName}
                onChange={(e) => {
                  setTaskName(e.target.value);
                  setError(null);
                }}
                placeholder={t('templates.taskForm.taskNamePlaceholder', 'Enter task name')}
                autoFocus
                disabled={isSubmitting}
                className={error ? 'border-destructive' : ''}
              />
              {error && <p className="text-sm text-destructive mt-1">{error}</p>}
            </div>

            {/* Description */}
            <div>
              <Label htmlFor="task-description" className="block text-sm font-medium text-gray-700 mb-1">
                {t('fields.description', 'Description')}
              </Label>
              <TextEditor
                key={descriptionEditorKey}
                id={`template-task-description-${task?.template_task_id || 'new'}`}
                initialContent={descriptionContent}
                onContentChange={setDescriptionContent}
                editorRef={blockNoteEditorRef}
                searchMentions={searchUsersForMentions}
                placeholder={t('templates.taskForm.descriptionPlaceholder', 'Task description (optional)')}
              />
            </div>

            {/* Service (for time entry prefill) - right under description */}
            <div>
              <Label htmlFor="task-service" className="block text-sm font-medium text-gray-700 mb-1">
                {t('templates.taskForm.serviceLabel', 'Service (for time entries)')}
              </Label>
              <CustomSelect
                id="template-task-service-select"
                value={serviceId}
                onValueChange={setServiceId}
                options={[
                  { value: '', label: t('templates.taskForm.noService', 'No service') },
                  ...availableServices.map((s) => ({
                    value: s.service_id,
                    label: s.service_name,
                  })),
                ]}
                disabled={isSubmitting}
              />
              <p className="text-xs text-gray-500 mt-1">
                {t('templates.taskForm.serviceHint', 'When set, this service will be automatically selected when creating time entries from tasks created using this template.')}
              </p>
            </div>

            {/* Status Column */}
            <div>
              <Label htmlFor="task-status" className="block text-sm font-medium text-gray-700 mb-1">
                {t('templates.taskForm.statusColumnLabel', 'Status Column')}
              </Label>
              <CustomSelect
                value={statusMappingId}
                onValueChange={setStatusMappingId}
                options={[
                  { value: '', label: t('templates.wizard.tasks.statusPlaceholder', 'Select status column') },
                  ...statusMappings.map((s) => ({
                    value: s.template_status_mapping_id,
                    label: s.status_name || s.custom_status_name || t('templates.editor.statusFallback', 'Status'),
                  })),
                ]}
                disabled={isSubmitting}
              />
            </div>

            {/* Two-column layout for smaller fields */}
            <div className="grid grid-cols-2 gap-4">
              {/* Estimated Hours */}
              <div>
                <Label htmlFor="estimated-hours" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('templates.taskForm.estimatedHoursLabel', 'Estimated Hours')}
                </Label>
                <Input
                  id="estimated-hours"
                  type="number"
                  step="0.5"
                  min="0"
                  value={estimatedHours}
                  onChange={(e) => setEstimatedHours(e.target.value)}
                  placeholder="0"
                  disabled={isSubmitting}
                />
              </div>

              {/* Duration Days */}
              <div>
                <Label htmlFor="duration-days" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('templates.taskForm.durationLabel', 'Duration (days)')}
                </Label>
                <Input
                  id="duration-days"
                  type="number"
                  min="0"
                  value={durationDays}
                  onChange={(e) => setDurationDays(e.target.value)}
                  placeholder="0"
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Task Type */}
              <div>
                <Label htmlFor="task-type" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('templates.taskForm.taskTypeLabel', 'Task Type')}
                </Label>
                <TaskTypeSelector
                  value={taskTypeKey}
                  taskTypes={taskTypes}
                  onChange={setTaskTypeKey}
                  disabled={isSubmitting}
                />
              </div>

              {/* Priority */}
              <div>
                <Label htmlFor="task-priority" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('templates.taskForm.priorityLabel', 'Priority')}
                </Label>
                <CustomSelect
                  value={priorityId}
                  onValueChange={setPriorityId}
                  options={[
                    { value: '', label: t('taskForm.selectPriorityPlaceholder', 'Select priority') },
                    ...priorities.map((p) => ({
                      value: p.priority_id,
                      label: p.priority_name,
                    })),
                  ]}
                  disabled={isSubmitting}
                />
              </div>
            </div>

            {/* Assigned To + Additional Agents */}
            <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="assigned-to" className="block text-sm font-medium text-gray-700 mb-1">
                {t('templates.taskForm.primaryAgentLabel', 'Primary Agent')}
              </Label>
              <UserAndTeamPicker
                id="assigned-to"
                value={assignedTo}
                onValueChange={(value) => {
                  setAssignedTo(value);
                  setAssignedTeamId(null);
                  if (value && additionalAgents.includes(value)) {
                    setAdditionalAgents(additionalAgents.filter(id => id !== value));
                  }
                }}
                onTeamSelect={(teamId) => {
                  const team = teams.find(t => t.team_id === teamId);
                  const leadId = team?.manager_id || team?.members?.find(m => m.role === 'lead')?.user_id;
                  if (leadId) {
                    setAssignedTo(leadId);
                  }
                  setAssignedTeamId(teamId);
                  // Populate additional agents with team members
                  if (team?.members) {
                    const memberIds = team.members
                      .map(m => m.user_id)
                      .filter(id => id !== leadId);
                    setAdditionalAgents(prev => {
                      const combined = new Set([...prev, ...memberIds]);
                      return Array.from(combined);
                    });
                  }
                }}
                users={users}
                teams={teams}
                getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
                getTeamAvatarUrlsBatch={getTeamAvatarUrlsBatchAction}
                placeholder={t('templates.taskForm.primaryAgentPlaceholder', 'Select primary agent (optional)')}
                disabled={isSubmitting}
                buttonWidth="full"
              />
              {/* Team indicator */}
              {assignedTeamId && (() => {
                const assignedTeam = teams.find(t => t.team_id === assignedTeamId);
                return assignedTeam ? (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <TeamAvatar
                      teamId={assignedTeam.team_id}
                      teamName={assignedTeam.team_name}
                      avatarUrl={teamAvatarUrl}
                      size="xs"
                    />
                    <span className="text-xs text-gray-500 truncate">{assignedTeam.team_name}</span>
                  </div>
                ) : null;
              })()}
              <p className="text-xs text-gray-500 mt-1">
                {t('templates.taskForm.assignedWhenApplied', 'This user will be assigned when the template is applied')}
              </p>
            </div>

            {/* Additional Agents */}
            <div>
              <Label className="block text-sm font-medium text-gray-700 mb-1">
                {t('templates.taskForm.additionalAgentsLabel', 'Additional Agents')}
              </Label>
              <MultiUserAndTeamPicker
                values={additionalAgents}
                onValuesChange={(newValues) => {
                  setError(null);
                  setAdditionalAgents(newValues);
                }}
                onTeamValuesChange={(selectedTeamIds) => {
                  for (const teamId of selectedTeamIds) {
                    const selectedTeam = teams.find(t => t.team_id === teamId);
                    if (!selectedTeam?.members) continue;
                    // Assign the team so the team badge appears
                    setAssignedTeamId(teamId);
                    const leadId = selectedTeam.manager_id || selectedTeam.members.find(m => m.role === 'lead')?.user_id;
                    if (!assignedTo && leadId) {
                      setAssignedTo(leadId);
                    }
                    const primaryId = assignedTo || leadId;
                    const newMembers = selectedTeam.members
                      .map(m => m.user_id)
                      .filter(id => id !== primaryId);
                    setAdditionalAgents(prev => {
                      const combined = new Set([...prev, ...newMembers]);
                      return Array.from(combined);
                    });
                  }
                }}
                users={users.filter(u => u.user_id !== assignedTo)}
                teams={teams}
                getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
                getTeamAvatarUrlsBatch={getTeamAvatarUrlsBatchAction}
              />
              <p className="text-xs text-gray-500 mt-1">
                {t('templates.taskForm.additionalAgentsHelp', 'Additional team members to assign to this task')}
              </p>
            </div>
            </div>

            {/* Checklist Items - Same pattern as projects */}
            {/* Note: Items with "temp_" prefix ids are client-generated temporary ids for new items */}
            <div className="border-t pt-4">
              <div className="flex items-center gap-2 mb-2">
                <ListChecks className="h-5 w-5 text-gray-500" />
                <h3 className="font-semibold">{t('templates.taskForm.checklist', 'Checklist')}</h3>
                <Button
                  id="add-checklist-item-header"
                  type="button"
                  variant="soft"
                  size="sm"
                  onClick={() => {
                    const newId = addChecklistItem();
                    setEditingChecklistItemId(newId);
                  }}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex flex-col space-y-2">
                {[...localChecklistItems]
                  .sort((a, b) => a.order_number - b.order_number)
                  .map((item, index) => {
                    const isItemEditing = isEditingChecklist || editingChecklistItemId === item.id;
                    const isDragging = draggedChecklistId === item.id;
                    const isDropTarget = dragOverChecklistId === item.id && draggedChecklistId !== item.id;
                    const isEntering = recentlyDroppedChecklistId === item.id;
                    const isAnyDragging = draggedChecklistId !== null;
                    return (
                    <div
                      key={item.id}
                      draggable
                      onMouseDown={(e) => {
                        const target = e.target as HTMLElement | null;
                        checklistDragOriginIsHandleRef.current =
                          !!target && !!target.closest(`.${checklistDnd.dragHandle}`);
                      }}
                      onDragStart={(e) => {
                        if (!checklistDragOriginIsHandleRef.current) {
                          e.preventDefault();
                          return;
                        }
                        handleChecklistDragStart(e, item.id);
                      }}
                      onDragOver={(e) => handleChecklistDragOver(e, item.id)}
                      onDrop={(e) => handleChecklistDrop(e, item.id)}
                      onDragEnd={() => {
                        checklistDragOriginIsHandleRef.current = false;
                        resetChecklistDragState();
                      }}
                    >
                      {isEditingChecklist && (
                        <Tooltip content={t('templates.taskForm.insertChecklistItem', 'Insert item here')}>
                          <div
                            className={`${checklistDnd.insertZone} ${isAnyDragging ? checklistDnd.insertZoneHidden : ''}`}
                            role="button"
                            tabIndex={-1}
                            aria-label={t('templates.taskForm.insertChecklistItem', 'Insert item here')}
                            onClick={(e) => {
                              e.stopPropagation();
                              const newId = addChecklistItem(index);
                              setEditingChecklistItemId(newId);
                            }}
                          >
                            <div className={checklistDnd.insertZoneLine} />
                            <div className={checklistDnd.insertZoneButton}>
                              <Plus className="h-3 w-3" />
                            </div>
                          </div>
                        </Tooltip>
                      )}
                      {isDropTarget && checklistDropPosition === 'before' && (
                        <div className={`${checklistDnd.dropPlaceholder} ${checklistDnd.visible}`} />
                      )}
                      <div
                        className={`flex items-center gap-2 w-full ${checklistDnd.row} ${
                          isDragging ? checklistDnd.dragging : ''
                        } ${isEntering ? checklistDnd.entering : ''}`}
                      >
                        <Tooltip content={t('templates.taskForm.reorderChecklistItem', 'Drag to reorder')}>
                          <div
                            className={`${checklistDnd.dragHandle} cursor-grab text-gray-400 flex-none`}
                            aria-label={t('templates.taskForm.reorderChecklistItem', 'Drag to reorder')}
                          >
                            <GripVertical className="h-4 w-4" />
                          </div>
                        </Tooltip>
                        <Checkbox
                          id={`checklist-item-${index}-completed`}
                          checked={item.completed}
                          onChange={(e) => updateChecklistItem(item.id, 'completed', e.target.checked)}
                          className="flex-none"
                          containerClassName=""
                        />
                        {isItemEditing ? (
                          <div className="flex-1">
                            <TextArea
                              id={`checklist-item-${index}-name`}
                              value={item.item_name}
                              onChange={(e) => updateChecklistItem(item.id, 'item_name', e.target.value)}
                              placeholder={t('templates.taskForm.checklistItemPlaceholder', 'Checklist item')}
                              className="w-full"
                              wrapperClassName="!mb-0 !px-0"
                              rows={1}
                              onBlur={() => setEditingChecklistItemId(null)}
                              autoFocus={editingChecklistItemId === item.id || (item.isNew && !item.item_name)}
                              onKeyDown={(e) => handleTemplateChecklistKeyDown(e, index)}
                            />
                          </div>
                        ) : (
                          <span
                            className={`flex-1 whitespace-pre-wrap cursor-text ${item.completed ? 'line-through text-gray-500' : ''}`}
                            onClick={() => setEditingChecklistItemId(item.id)}
                          >
                            {item.item_name}
                          </span>
                        )}
                        <div className="flex items-center gap-1 shrink-0">
                          {!isItemEditing && (
                            <Tooltip content={t('templates.taskForm.editChecklistItem', 'Edit checklist item')}>
                              <Button
                                id={`edit-checklist-${item.id}`}
                                type="button"
                                variant="icon"
                                size="icon"
                                onClick={() => setEditingChecklistItemId(item.id)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            </Tooltip>
                          )}
                          <Tooltip content={t('templates.taskForm.removeChecklistItem', 'Remove checklist item')}>
                            <Button
                              id={`remove-checklist-${item.id}`}
                              type="button"
                              variant="icon"
                              size="icon"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                removeChecklistItem(item.id);
                              }}
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </Tooltip>
                        </div>
                      </div>
                      {isDropTarget && checklistDropPosition === 'after' && (
                        <div className={`${checklistDnd.dropPlaceholder} ${checklistDnd.visible}`} />
                      )}
                    </div>
                    );
                  })}
                {isEditingChecklist && localChecklistItems.length > 0 && draggedChecklistId === null && (
                  <Tooltip content={t('templates.taskForm.insertChecklistItem', 'Insert item here')}>
                    <div
                      className={checklistDnd.insertZone}
                      role="button"
                      tabIndex={-1}
                      aria-label={t('templates.taskForm.insertChecklistItem', 'Insert item here')}
                      onClick={(e) => {
                        e.stopPropagation();
                        const newId = addChecklistItem(localChecklistItems.length);
                        setEditingChecklistItemId(newId);
                      }}
                    >
                      <div className={checklistDnd.insertZoneLine} />
                      <div className={checklistDnd.insertZoneButton}>
                        <Plus className="h-3 w-3" />
                      </div>
                    </div>
                  </Tooltip>
                )}
              </div>
            </div>

            {/* Dependencies Section - Only show when editing existing task */}
            {task && (
              <div className="border-t pt-4">
                <div className="flex items-center gap-2 mb-3">
                  <Link2 className="h-5 w-5 text-gray-500" />
                  <h3 className="font-semibold">{t('templates.taskForm.dependenciesLabel', 'Dependencies')}</h3>
                </div>

                {/* Existing dependencies list */}
                {localDependencies.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {localDependencies.map(dep => {
                      const typeInfo = getDependencyTypeInfo(dep.dependencyType);
                      return (
                        <div
                          key={dep.id}
                          className="flex items-center justify-between p-2 bg-gray-50 rounded-lg"
                        >
                          <div className="flex items-center gap-2">
                            {typeInfo.icon}
                            <span className="text-sm text-gray-600">{typeInfo.label}</span>
                            <span className="text-sm font-medium">{dep.predecessorTaskName}</span>
                            {dep.isNew && (
                              <Badge variant="success" size="sm">
                                New
                              </Badge>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => removeDependency(dep)}
                            className="text-destructive hover:text-destructive p-1"
                            title={t('templates.taskForm.removeDependency', 'Remove dependency')}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Add new dependency */}
                {availableTasksForDependency.length > 0 && (
                  <div className="flex items-center gap-2">
                    <CustomSelect
                      value={newDependencyType}
                      onValueChange={(v) => setNewDependencyType(v as DependencyType)}
                      options={[
                        { value: 'blocked_by', label: t('taskDependencies.blockedBy', 'Blocked by') },
                        { value: 'blocks', label: t('taskDependencies.blocks', 'Blocks') },
                        { value: 'related_to', label: t('taskDependencies.relatedTo', 'Related to') },
                      ]}
                      className="w-32"
                    />
                    <CustomSelect
                      value={newDependencyTask}
                      onValueChange={setNewDependencyTask}
                      options={[
                        { value: '', label: t('templates.taskForm.selectTaskPlaceholder', 'Select task...') },
                        ...availableTasksForDependency.map(t => ({
                          value: t.template_task_id,
                          label: t.task_name,
                        })),
                      ]}
                      className="flex-1"
                      placeholder={t('templates.taskForm.selectTaskPlaceholder', 'Select task...')}
                    />
                    <Button
                      id="add-dependency"
                      type="button"
                      variant="soft"
                      size="sm"
                      onClick={addDependency}
                      disabled={!newDependencyTask}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                )}

                {availableTasksForDependency.length === 0 && localDependencies.length === 0 && (
                  <p className="text-sm text-gray-500 italic">
                    {t('taskDependencies.noOtherTasks', 'No other tasks available for dependencies')}
                  </p>
                )}

                <p className="text-xs text-gray-500 mt-2">
                  {t('templates.taskForm.dependenciesHelp', 'Define task dependencies to control execution order when project is created')}
                </p>
              </div>
            )}
          </div>

        </form>
      </DialogContent>
    </Dialog>

    <ConfirmationDialog
      isOpen={showCancelConfirm}
      onClose={handleCancelDismiss}
      onConfirm={handleCancelConfirm}
      title={t('templates.taskForm.cancelEditTitle', 'Cancel Edit')}
      message={t('templates.taskForm.cancelEditMessage', 'Are you sure you want to cancel? Any unsaved changes will be lost.')}
      confirmLabel={t('templates.taskForm.discardChanges', 'Discard changes')}
      cancelLabel={t('templates.taskForm.continueEditing', 'Continue editing')}
    />
    </>
  );
}
