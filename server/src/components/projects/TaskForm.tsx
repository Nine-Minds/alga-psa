'use client';

import React, { useState, useEffect } from 'react';
import { IProjectPhase, IProjectTask, ITaskChecklistItem, ProjectStatus, IProjectTicketLinkWithDetails } from '@/interfaces/project.interfaces';
import { IUserWithRoles } from '@/interfaces/auth.interfaces';
import AvatarIcon from '@/components/ui/AvatarIcon';
import { 
  updateTaskWithChecklist, 
  addTaskToPhase, 
  getTaskChecklistItems, 
  moveTaskToPhase, 
  deleteTask,
  getProjectTreeData,
  addTaskResourceAction,
  removeTaskResourceAction,
  getTaskResourcesAction,
  addTicketLinkAction
} from '@/lib/actions/projectActions';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/Button';
import { TextArea } from '@/components/ui/TextArea';
import EditableText from '@/components/ui/EditableText';
import { ListChecks, UserPlus, Trash2 } from 'lucide-react';
import UserPicker from '@/components/ui/UserPicker';
import { ConfirmationDialog } from '@/components/ui/ConfirmationDialog';
import { Input } from '@/components/ui/Input';
import { toast } from 'react-hot-toast';
import TaskTicketLinks from './TaskTicketLinks';
import TreeSelect, { TreeSelectOption, TreeSelectPath } from '@/components/ui/TreeSelect';
import { Checkbox } from '@/components/ui/Checkbox';

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
  onPhaseChange
}: TaskFormProps): JSX.Element {
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [taskName, setTaskName] = useState(task?.task_name || '');
  const [description, setDescription] = useState(task?.description || '');
  const [projectTreeOptions, setProjectTreeOptions] = useState<Array<TreeSelectOption<'project' | 'phase' | 'status'>>>([]);
  const [selectedPhaseId, setSelectedPhaseId] = useState<string>(phase.phase_id);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checklistItems, setChecklistItems] = useState<Omit<ITaskChecklistItem, 'tenant'>[]>(task?.checklist_items || []);
  const [isEditingChecklist, setIsEditingChecklist] = useState(false);
  const [assignedUser, setAssignedUser] = useState<string>(task?.assigned_to || '');
  const [selectedPhase, setSelectedPhase] = useState<IProjectPhase>(phase);
  const [showMoveConfirmation, setShowMoveConfirmation] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [tempTaskId] = useState<string>(`temp-${Date.now()}`);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [estimatedHours, setEstimatedHours] = useState<number>(Number(task?.estimated_hours) || 0);
  const [actualHours, setActualHours] = useState<number>(Number(task?.actual_hours) || 0);
  const [taskResources, setTaskResources] = useState<any[]>(task?.task_id ? [] : []);
  const [tempTaskResources, setTempTaskResources] = useState<any[]>([]);
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [pendingTicketLinks, setPendingTicketLinks] = useState<IProjectTicketLinkWithDetails[]>(task?.ticket_links || []);

  const [selectedStatusId, setSelectedStatusId] = useState<string>(
    task?.project_status_mapping_id || 
    defaultStatus?.project_status_mapping_id || 
    projectStatuses[0]?.project_status_mapping_id
  );

  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const user = await getCurrentUser();
        if (user) {
          setCurrentUserId(user.user_id);
        }

        if (task?.task_id) {
          const [existingChecklistItems, resources] = await Promise.all([
            getTaskChecklistItems(task.task_id),
            getTaskResourcesAction(task.task_id)
          ]);
          setChecklistItems(existingChecklistItems);
          setTaskResources(resources);
        }
      } catch (error) {
        console.error('Error fetching initial data:', error);
      }
    };
    fetchInitialData();
  }, [task]);

  useEffect(() => {
    const fetchProjectsData = async () => {
      if (mode === 'edit') {
        try {
          const treeData = await getProjectTreeData();
          if (treeData && treeData.length > 0) {
            setProjectTreeOptions(treeData);
          } else {
            toast.error('No projects available with valid phases and statuses');
          }
        } catch (error) {
          console.error('Error fetching projects:', error);
          toast.error('Error loading project data. Please try again.');
        }
      }
    };

    fetchProjectsData();
  }, [mode]);

  const handleTreeSelectChange = async (
    value: string, 
    type: ProjectTreeTypes,
    excluded: boolean,
    path?: TreeSelectPath
  ) => {
    if (!path) return;

    // Get IDs from the path
    const phaseId = path['phase'];
    const statusId = path['status'];
    
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
    
    // Update status ID based on the following priority:
    // 1. Status from path (if provided)
    // 2. Current task's status (if valid in new project)
    // 3. Default status for the project
    // 4. First available status
    if (statusId) {
      setSelectedStatusId(statusId);
    } else {
      // Try to keep current status if it exists in the new project
      const currentStatusId = task?.project_status_mapping_id;
      const currentStatusValid = currentStatusId && projectStatuses.some(s => s.project_status_mapping_id === currentStatusId);
      
      if (currentStatusValid) {
        setSelectedStatusId(currentStatusId);
      } else if (defaultStatus?.project_status_mapping_id) {
        setSelectedStatusId(defaultStatus.project_status_mapping_id);
      } else if (projectStatuses.length > 0) {
        setSelectedStatusId(projectStatuses[0].project_status_mapping_id);
      }
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
      // Move the task to the new phase with both phase and status
      const movedTask = await moveTaskToPhase(task.task_id, selectedPhaseId, selectedStatusId);
      
      if (movedTask) {
        // Update task with all fields preserved
        const taskData: Partial<IProjectTask> = {
          task_name: taskName,
          description: description,
          assigned_to: assignedUser || currentUserId,
          estimated_hours: estimatedHours,
          actual_hours: actualHours,
          due_date: task.due_date,
          checklist_items: checklistItems,
          // Always include these IDs to ensure they're properly updated
          phase_id: selectedPhaseId,
          project_status_mapping_id: selectedStatusId
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (taskName.trim() === '') return;

    setIsSubmitting(true);

    try {
      let resultTask: IProjectTask | null = null;

      if (mode === 'edit' && task) {
        // Edit mode logic remains the same
        const movedTask = await moveTaskToPhase(task.task_id, selectedPhaseId, selectedStatusId);
        
        if (movedTask) {
          const taskData: Partial<IProjectTask> = {
            task_name: taskName,
            description: description,
            assigned_to: assignedUser || currentUserId,
            estimated_hours: estimatedHours,
            actual_hours: actualHours,
            due_date: task.due_date,
            checklist_items: checklistItems,
            project_status_mapping_id: selectedStatusId // Ensure status mapping is updated
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
          assigned_to: assignedUser || currentUserId,
          estimated_hours: estimatedHours,
          actual_hours: actualHours,
          due_date: new Date(),
          phase_id: phase.phase_id
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
    if (mode === 'create') return true; // Always confirm for new tasks
    
    // Compare all form fields with their original values
    if (!task) return false;

    if (taskName !== task.task_name) return true;
    if (description !== task.description) return true;
    if (selectedPhaseId !== task.phase_id) return true;
    if (selectedStatusId !== task.project_status_mapping_id) return true;
    if (estimatedHours !== Number(task.estimated_hours)) return true;
    if (actualHours !== Number(task.actual_hours)) return true;
    if (assignedUser !== task.assigned_to) return true;

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
    const currentTicketIds = new Set(pendingTicketLinks.map(link => link.ticket_id));
    const originalTicketIds = new Set(task.ticket_links?.map(link => link.ticket_id) || []);
    
    if (currentTicketIds.size !== originalTicketIds.size) return true;
    for (const id of currentTicketIds) {
      if (!originalTicketIds.has(id)) return true;
    }

    return false;
  };

  const handleCancelClick = (e?: React.MouseEvent) => {
    e?.preventDefault();
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

  return (
    <>
      <Dialog.Root open={true} onOpenChange={handleDialogClose}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black bg-opacity-50" />
          <Dialog.Content 
            className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white p-6 rounded-lg shadow-lg w-[600px] max-h-[90vh] overflow-y-auto"
          >
            <Dialog.Title className="text-xl font-semibold mb-4">
              {mode === 'edit' ? 'Edit Task' : 'Add New Task'}
            </Dialog.Title>
            <form onSubmit={handleSubmit} className="flex flex-col">
              <div className="space-y-4">
                <EditableText
                  value={taskName}
                  onChange={setTaskName}
                  placeholder="Title..."
                  className="w-full text-lg font-semibold"
                />

                {mode === 'edit' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Move to</label>
              <TreeSelect<ProjectTreeTypes>
                value={selectedPhaseId}
                onValueChange={handleTreeSelectChange}
                options={projectTreeOptions}
                placeholder="Select destination..."
                className="w-full"
                multiSelect={false}
                showExclude={false}
                showReset={false}
                allowEmpty={false}
              />
                  </div>
                )}
                <TextArea
                  value={description}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
                  placeholder="Description"
                  className="w-full max-w-4xl p-2 border border-gray-300 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 whitespace-pre-wrap break-words"
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
                <div className="space-y-4">
                  <UserPicker
                    label="Assigned To"
                    value={assignedUser}
                    onValueChange={setAssignedUser}
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
                      {isEditingChecklist ? (
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
                          <span className={`flex-1 whitespace-pre-wrap ${item.completed ? 'line-through text-gray-500' : ''}`}>
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

            <TaskTicketLinks
              taskId={task?.task_id || undefined}
              phaseId={phase.phase_id}
              projectId={phase.project_id}
              initialLinks={task?.ticket_links}
              users={users}
              onLinksChange={setPendingTicketLinks}
            />

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
                      variant="destructive"
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
          message={`Are you sure you want to move task "${taskName}" to phase "${selectedPhase.phase_name}"?`}
          confirmLabel="Move"
          cancelLabel="Cancel"
        />
      )}

      <Dialog.Root open={showAgentPicker} onOpenChange={setShowAgentPicker}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black bg-opacity-50" />
          <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white p-4 rounded-lg shadow-lg w-[400px]">
            <Dialog.Title className="text-lg font-semibold mb-4">Add Additional Agent</Dialog.Title>
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
                <Button variant="ghost" onClick={() => setShowAgentPicker(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
