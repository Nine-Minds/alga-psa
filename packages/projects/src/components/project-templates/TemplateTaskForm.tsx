'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Button } from '@alga-psa/ui/components/Button';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import UserAndTeamPicker from '@alga-psa/ui/components/UserAndTeamPicker';
import MultiUserPicker from '@alga-psa/ui/components/MultiUserPicker';
import MultiUserAndTeamPicker from '@alga-psa/ui/components/MultiUserAndTeamPicker';
import { getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { getTeams, getTeamAvatarUrlsBatchAction } from '@alga-psa/teams/actions';
import type { ITeam } from '@alga-psa/types';
import TeamAvatar from '@alga-psa/ui/components/TeamAvatar';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { TaskTypeSelector } from '../TaskTypeSelector';
import { ListChecks, Link2, Plus, Trash2, Ban, GitBranch } from 'lucide-react';
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
  const { enabled: teamsV2Enabled } = useFeatureFlag('teams-v2', { defaultValue: false });
  const [teams, setTeams] = useState<ITeam[]>([]);
  const [taskName, setTaskName] = useState('');
  const [description, setDescription] = useState('');
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
    description: string;
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

  // Fetch teams when teams-v2 is enabled
  useEffect(() => {
    if (!teamsV2Enabled) {
      setTeams([]);
      return;
    }
    const fetchTeams = async () => {
      try {
        const fetchedTeams = await getTeams();
        setTeams(fetchedTeams);
      } catch (err) {
        console.error('Failed to fetch teams:', err);
      }
    };
    fetchTeams();
  }, [teamsV2Enabled]);

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
        const descriptionVal = task.description || '';
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
        setDescription(descriptionVal);
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
          description: descriptionVal,
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
        setDescription('');
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
          description: '',
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

      await onSave(
        {
          task_name: taskName.trim(),
          description: description.trim() || undefined,
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
  const addChecklistItem = () => {
    const newItem: LocalChecklistItem = {
      id: `temp_${Date.now()}`,
      item_name: '',
      completed: false,
      order_number: localChecklistItems.length,
      isNew: true,
    };
    setLocalChecklistItems([...localChecklistItems, newItem]);
    setIsEditingChecklist(true);
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
    if (description !== initialValues.description) return true;
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
              <TextArea
                id="task-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('templates.taskForm.descriptionPlaceholder', 'Task description (optional)')}
                rows={3}
                disabled={isSubmitting}
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
              {teamsV2Enabled ? (
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
              ) : (
                <UserPicker
                  id="assigned-to"
                  value={assignedTo}
                  onValueChange={(value) => {
                    setAssignedTo(value);
                    if (value && additionalAgents.includes(value)) {
                      setAdditionalAgents(additionalAgents.filter(id => id !== value));
                    }
                  }}
                  users={users}
                  getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
                  placeholder={t('templates.taskForm.primaryAgentPlaceholder', 'Select primary agent (optional)')}
                  disabled={isSubmitting}
                  buttonWidth="full"
                />
              )}
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
              {teamsV2Enabled ? (
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
              ) : (
                <MultiUserPicker
                  values={additionalAgents}
                  onValuesChange={setAdditionalAgents}
                  users={users.filter(u => u.user_id !== assignedTo)}
                  getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
                />
              )}
              <p className="text-xs text-gray-500 mt-1">
                {t('templates.taskForm.additionalAgentsHelp', 'Additional team members to assign to this task')}
              </p>
            </div>
            </div>

            {/* Checklist Items - Same pattern as projects */}
            {/* Note: Items with "temp_" prefix ids are client-generated temporary ids for new items */}
            <div className="border-t pt-4">
              <div className="flex items-center gap-2 mb-2">
                <h3 className="font-semibold">{t('templates.taskForm.checklist', 'Checklist')}</h3>
                <button
                  id="toggle-checklist-edit"
                  type="button"
                  onClick={() => setIsEditingChecklist(!isEditingChecklist)}
                  className="text-gray-500 hover:text-gray-700"
                  title={isEditingChecklist
                    ? t('templates.taskForm.doneEditing', 'Done editing')
                    : t('templates.taskForm.editChecklist', 'Edit checklist')}
                >
                  <ListChecks className="h-5 w-5" />
                </button>
              </div>

              <div className="flex flex-col space-y-2 mb-3">
                {localChecklistItems
                  .sort((a, b) => a.order_number - b.order_number)
                  .map((item, index) => (
                    <div key={item.id} className="flex items-center gap-2 w-full">
                      {isEditingChecklist ? (
                        <>
                          <Checkbox
                            id={`checklist-item-${index}-completed`}
                            checked={item.completed}
                            onChange={(e) => updateChecklistItem(item.id, 'completed', e.target.checked)}
                            className="flex-none"
                          />
                          <div className="flex-1">
                            <TextArea
                              id={`checklist-item-${index}-name`}
                              value={item.item_name}
                              onChange={(e) => updateChecklistItem(item.id, 'item_name', e.target.value)}
                              onBlur={() => {
                                // Remove empty items on blur
                                if (!item.item_name.trim()) {
                                  removeChecklistItem(item.id);
                                }
                              }}
                              placeholder={t('templates.taskForm.checklistItemPlaceholder', 'Checklist item')}
                              className={`w-full ${item.completed ? 'line-through text-gray-500' : ''}`}
                              rows={1}
                              autoFocus={item.isNew && !item.item_name}
                            />
                          </div>
                          <button
                            id={`checklist-item-${index}-remove`}
                            type="button"
                            onClick={() => removeChecklistItem(item.id)}
                            className="text-destructive flex-none"
                            onMouseDown={(e) => e.preventDefault()}
                          >
                            {t('common:actions.remove', 'Remove')}
                          </button>
                        </>
                      ) : (
                        <>
                          <Checkbox
                            id={`checklist-item-${index}-completed`}
                            checked={item.completed}
                            onChange={(e) => updateChecklistItem(item.id, 'completed', e.target.checked)}
                            className="flex-none"
                          />
                          <span
                            className={`flex-1 whitespace-pre-wrap cursor-pointer ${item.completed ? 'line-through text-gray-500' : ''}`}
                            onClick={() => setIsEditingChecklist(true)}
                          >
                            {item.item_name || <span className="text-gray-400 italic">{t('templates.taskForm.emptyChecklistItem', 'Empty item')}</span>}
                          </span>
                        </>
                      )}
                    </div>
                  ))}
              </div>

              {isEditingChecklist && (
                <Button
                  id="add-checklist-item"
                  type="button"
                  variant="soft"
                  onClick={addChecklistItem}
                >
                  {t('templates.taskForm.addChecklistItem', 'Add an item')}
                </Button>
              )}
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

          <DialogFooter className="mt-6">
            <Button
              id="cancel-task-form"
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isSubmitting}
            >
              {t('common:actions.cancel', 'Cancel')}
            </Button>
            <Button id="save-task-form" type="submit" disabled={isSubmitting || !taskName.trim()}>
              {isSubmitting
                ? t('templates.taskForm.saving', 'Saving...')
                : task
                  ? t('templates.taskForm.updateAction', 'Update Task')
                  : t('templates.taskForm.addAction', 'Add Task')}
            </Button>
          </DialogFooter>
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
