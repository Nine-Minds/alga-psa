'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import { Input } from 'server/src/components/ui/Input';
import { TextArea } from 'server/src/components/ui/TextArea';
import { Button } from 'server/src/components/ui/Button';
import { Label } from 'server/src/components/ui/Label';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import UserPicker from 'server/src/components/ui/UserPicker';
import MultiUserPicker from 'server/src/components/ui/MultiUserPicker';
import { TaskTypeSelector } from 'server/src/components/projects/TaskTypeSelector';
import {
  IProjectTemplateTask,
  IProjectTemplateStatusMapping,
  IProjectTemplateTaskAssignment,
} from 'server/src/interfaces/projectTemplate.interfaces';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { ITaskType } from 'server/src/interfaces/project.interfaces';
import { IService } from 'server/src/interfaces/billing.interfaces';
import { getServices } from 'server/src/lib/actions/serviceActions';

interface TemplateTaskFormProps {
  open: boolean;
  onClose: () => void;
  onSave: (taskData: Partial<IProjectTemplateTask>, additionalAgents?: string[]) => void;
  task: IProjectTemplateTask | null;
  taskAssignments?: IProjectTemplateTaskAssignment[];
  statusMappings: IProjectTemplateStatusMapping[];
  priorities: Array<{ priority_id: string; priority_name: string }>;
  users: IUserWithRoles[];
  taskTypes: ITaskType[];
  /** Initial status mapping ID for new tasks (e.g., when clicking + on a status column) */
  initialStatusMappingId?: string | null;
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
}: TemplateTaskFormProps) {
  const [taskName, setTaskName] = useState('');
  const [description, setDescription] = useState('');
  const [estimatedHours, setEstimatedHours] = useState<string>('');
  const [durationDays, setDurationDays] = useState<string>('');
  const [taskTypeKey, setTaskTypeKey] = useState('');
  const [priorityId, setPriorityId] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [additionalAgents, setAdditionalAgents] = useState<string[]>([]);
  const [statusMappingId, setStatusMappingId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [availableServices, setAvailableServices] = useState<IService[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // Reset form when dialog opens/closes or task changes
  useEffect(() => {
    if (open) {
      if (task) {
        setTaskName(task.task_name || '');
        setDescription(task.description || '');
        setEstimatedHours(task.estimated_hours?.toString() || '');
        setDurationDays(task.duration_days?.toString() || '');
        setTaskTypeKey(task.task_type_key || '');
        setPriorityId(task.priority_id || '');
        setAssignedTo(task.assigned_to || '');
        // Get additional agents for this task from taskAssignments
        const taskAdditionalAgents = taskAssignments
          .filter(a => a.template_task_id === task.template_task_id)
          .map(a => a.user_id);
        setAdditionalAgents(taskAdditionalAgents);
        setStatusMappingId(task.template_status_mapping_id || statusMappings[0]?.template_status_mapping_id || '');
        setServiceId(task.service_id || '');
      } else {
        // New task - use initialStatusMappingId if provided (e.g., when clicking + on a status column)
        setTaskName('');
        setDescription('');
        setEstimatedHours('');
        setDurationDays('');
        setTaskTypeKey('');
        setPriorityId('');
        setAssignedTo('');
        setAdditionalAgents([]);
        setStatusMappingId(initialStatusMappingId || statusMappings[0]?.template_status_mapping_id || '');
        setServiceId('');
      }
      setError(null);
    }
  }, [open, task, taskAssignments, statusMappings, initialStatusMappingId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!taskName.trim()) {
      setError('Task name is required');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await onSave({
        task_name: taskName.trim(),
        description: description.trim() || undefined,
        estimated_hours: estimatedHours ? parseFloat(estimatedHours) : undefined,
        duration_days: durationDays ? parseInt(durationDays) : undefined,
        task_type_key: taskTypeKey || undefined,
        priority_id: priorityId || undefined,
        assigned_to: assignedTo || undefined,
        template_status_mapping_id: statusMappingId || undefined,
        service_id: serviceId || null,
      }, additionalAgents);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save task');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      isOpen={open}
      onClose={onClose}
      title={task ? 'Edit Task' : 'Add Task'}
      className="max-w-2xl"
      id="template-task-form-dialog"
      allowOverflow
    >
      <DialogContent>
        <form onSubmit={handleSubmit} id="template-task-form">
          <div className="space-y-4">
            {/* Task Name */}
            <div>
              <Label htmlFor="task-name" className="block text-sm font-medium text-gray-700 mb-1">
                Task Name *
              </Label>
              <Input
                id="task-name"
                value={taskName}
                onChange={(e) => {
                  setTaskName(e.target.value);
                  setError(null);
                }}
                placeholder="Enter task name"
                autoFocus
                disabled={isSubmitting}
                className={error ? 'border-red-500' : ''}
              />
              {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
            </div>

            {/* Description */}
            <div>
              <Label htmlFor="task-description" className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </Label>
              <TextArea
                id="task-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Task description (optional)"
                rows={3}
                disabled={isSubmitting}
              />
            </div>

            {/* Service (for time entry prefill) - right under description */}
            <div>
              <Label htmlFor="task-service" className="block text-sm font-medium text-gray-700 mb-1">
                Service (for time entries)
              </Label>
              <CustomSelect
                id="template-task-service-select"
                value={serviceId}
                onValueChange={setServiceId}
                options={[
                  { value: '', label: 'No service' },
                  ...availableServices.map((s) => ({
                    value: s.service_id,
                    label: s.service_name,
                  })),
                ]}
                disabled={isSubmitting}
              />
              <p className="text-xs text-gray-500 mt-1">
                When set, this service will be automatically selected when creating time entries from tasks created using this template.
              </p>
            </div>

            {/* Status Column */}
            <div>
              <Label htmlFor="task-status" className="block text-sm font-medium text-gray-700 mb-1">
                Status Column
              </Label>
              <CustomSelect
                value={statusMappingId}
                onValueChange={setStatusMappingId}
                options={[
                  { value: '', label: 'Select status...' },
                  ...statusMappings.map((s) => ({
                    value: s.template_status_mapping_id,
                    label: s.status_name || s.custom_status_name || 'Status',
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
                  Estimated Hours
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
                  Duration (days)
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
                  Task Type
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
                  Priority
                </Label>
                <CustomSelect
                  value={priorityId}
                  onValueChange={setPriorityId}
                  options={[
                    { value: '', label: 'Select priority...' },
                    ...priorities.map((p) => ({
                      value: p.priority_id,
                      label: p.priority_name,
                    })),
                  ]}
                  disabled={isSubmitting}
                />
              </div>
            </div>

            {/* Assigned To */}
            <div>
              <Label htmlFor="assigned-to" className="block text-sm font-medium text-gray-700 mb-1">
                Primary Agent
              </Label>
              <UserPicker
                id="assigned-to"
                value={assignedTo}
                onValueChange={(value) => {
                  setAssignedTo(value);
                  // Remove from additional agents if selected as primary
                  if (value && additionalAgents.includes(value)) {
                    setAdditionalAgents(additionalAgents.filter(id => id !== value));
                  }
                }}
                users={users}
                placeholder="Select primary agent (optional)"
                disabled={isSubmitting}
                buttonWidth="full"
              />
              <p className="text-xs text-gray-500 mt-1">
                This user will be assigned when the template is applied
              </p>
            </div>

            {/* Additional Agents */}
            <div>
              <Label className="block text-sm font-medium text-gray-700 mb-1">
                Additional Agents
              </Label>
              {!assignedTo ? (
                <div className="text-sm text-gray-500 italic p-2 bg-gray-50 rounded border">
                  Please assign a primary agent first.
                </div>
              ) : (
                <MultiUserPicker
                  values={additionalAgents}
                  onValuesChange={setAdditionalAgents}
                  users={users.filter(u => u.user_id !== assignedTo)}
                />
              )}
              <p className="text-xs text-gray-500 mt-1">
                Additional team members to assign to this task
              </p>
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button
              id="cancel-task-form"
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button id="save-task-form" type="submit" disabled={isSubmitting || !taskName.trim()}>
              {isSubmitting ? 'Saving...' : task ? 'Update Task' : 'Add Task'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
