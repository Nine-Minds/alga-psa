'use server';

import { Knex } from 'knex';
import ProjectModel from '../models/project';
import { IProject, IProjectPhase, IProjectTask, IProjectTicketLink, IStatus, IProjectStatusMapping, IStandardStatus, ItemType, ITaskChecklistItem, IProjectTicketLinkWithDetails, ProjectStatus } from '@/interfaces/project.interfaces';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import { IUser, IUserWithRoles } from '@/interfaces/auth.interfaces';
import { hasPermission } from '@/lib/auth/rbac';
import { getAllUsers } from './user-actions/userActions';
import { validateData, validateArray } from '../utils/validation';
import { createTenantKnex } from '@/lib/db';
import { 
    createProjectSchema, 
    updateProjectSchema, 
    createTaskSchema, 
    updateTaskSchema, 
    createChecklistItemSchema, 
    updateChecklistItemSchema,
    projectPhaseSchema 
} from '../schemas/project.schemas';

async function checkPermission(user: IUser, resource: string, action: string): Promise<void> {
    const hasPermissionResult = await hasPermission(user, resource, action);
    if (!hasPermissionResult) {
        throw new Error(`Permission denied: Cannot ${action} ${resource}`);
    }
}

export async function getProjects(): Promise<IProject[]> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }
        await checkPermission(currentUser, 'project', 'read');
        return await ProjectModel.getAll(true);
    } catch (error) {
        console.error('Error fetching projects:', error);
        throw error;
    }
}

export async function getProjectPhase(phaseId: string): Promise<IProjectPhase | null> {
    try {
        const phase = await ProjectModel.getPhaseById(phaseId);
        return phase;
    } catch (error) {
        console.error('Error fetching project phase:', error);
        throw new Error('Failed to fetch project phase');
    }
}

export async function getProjectTreeData(projectId?: string) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error("user not found");
    }

    await checkPermission(currentUser, 'project', 'read');
    
    // Get all projects if no specific projectId is provided
    const projects = projectId ? 
      [await ProjectModel.getById(projectId)] : 
      await ProjectModel.getAll(true);
    
    // Filter out null projects and ensure we have valid projects
    const validProjects = projects.filter((p): p is IProject => p !== null);
    
    if (validProjects.length === 0) {
      throw new Error('No projects found');
    }
    
    // Transform projects into tree structure
    const treeData = await Promise.all(validProjects.map(async (project): Promise<{
      label: string;
      value: string;
      type: 'project';
      children: {
        label: string;
        value: string;
        type: 'phase';
        children: {
          label: string;
          value: string;
          type: 'status';
        }[];
      }[];
    } | null> => {
      try {
        // Get phases and status mappings concurrently
        const [phases, statusMappings] = await Promise.all([
          ProjectModel.getPhases(project.project_id),
          ProjectModel.getProjectStatusMappings(project.project_id)
        ]);

        // If no status mappings exist, create default ones
        if (!statusMappings || statusMappings.length === 0) {
          const standardStatuses = await ProjectModel.getStandardStatusesByType('project_task');
          await Promise.all(standardStatuses.map((status): Promise<IProjectStatusMapping> => 
            ProjectModel.addProjectStatusMapping(project.project_id, {
              standard_status_id: status.standard_status_id,
              is_standard: true,
              custom_name: null,
              display_order: status.display_order,
              is_visible: true,
            })
          ));
        }

        // Get the statuses (including any newly created ones)
        const statuses = await getProjectTaskStatuses(project.project_id);

        // Create a serializable tree structure
        return {
          label: project.project_name,
          value: project.project_id,
          type: 'project' as const,
          children: phases.map((phase): {
            label: string;
            value: string;
            type: 'phase';
            children: {
              label: string;
              value: string;
              type: 'status';
            }[];
          } => ({
            label: phase.phase_name,
            value: phase.phase_id,
            type: 'phase' as const,
            children: statuses.map((status): {
                label: string;
                value: string;
                type: 'status';
              } => ({
              label: status.custom_name || status.name,
              value: status.project_status_mapping_id,
              type: 'status' as const
            }))
          }))
        };
      } catch (error) {
        console.error(`Error processing project ${project.project_id}:`, error);
        return null;
      }
    }));

    // Filter out any failed project data and ensure projects have phases
    const validTreeData = treeData
      .filter((data): data is NonNullable<typeof data> =>
        data !== null && 
        data.children && 
        data.children.length > 0
      );
    
    if (validTreeData.length === 0) {
      throw new Error('No projects available with valid phases');
    }
    
    // Return a clean copy of the data
    return validTreeData;
  } catch (error) {
    console.error('Error fetching project tree data:', error);
    throw new Error('Failed to fetch project tree data');
  }
}

export async function updatePhase(phaseId: string, phaseData: Partial<IProjectPhase>): Promise<IProjectPhase> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }

        await checkPermission(currentUser, 'project', 'update');

        // Validate phase data
        const validatedData = validateData(projectPhaseSchema.partial(), phaseData);
        
        const updatedPhase = await ProjectModel.updatePhase(phaseId, validatedData);
        return updatedPhase;
    } catch (error) {
        console.error('Error updating project phase:', error);
        throw error;
    }
}

export async function deletePhase(phaseId: string): Promise<void> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }

        await checkPermission(currentUser, 'project', 'delete');
        await ProjectModel.deletePhase(phaseId);
    } catch (error) {
        console.error('Error deleting project phase:', error);
        throw error;
    }
}

export async function moveTaskToPhase(taskId: string, newPhaseId: string, newStatusMappingId?: string): Promise<IProjectTask> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }

        await checkPermission(currentUser, 'project', 'update');

        // Get the existing task to preserve its data
        const existingTask = await ProjectModel.getTaskById(taskId);
        if (!existingTask) {
            throw new Error('Task not found');
        }

        // Get the new phase to access its project and WBS code
        const newPhase = await ProjectModel.getPhaseById(newPhaseId);
        if (!newPhase) {
            throw new Error('Target phase not found');
        }

        // Get the current phase to check if this is a cross-project move
        const currentPhase = await ProjectModel.getPhaseById(existingTask.phase_id);
        if (!currentPhase) {
            throw new Error('Current phase not found');
        }

        // Always use the provided status mapping ID if it exists
        let finalStatusMappingId = newStatusMappingId || existingTask.project_status_mapping_id;

        // If moving to a different project and no specific status mapping is provided
        if (currentPhase.project_id !== newPhase.project_id && !newStatusMappingId) {
            // Get current status mapping
            const currentMapping = await ProjectModel.getProjectStatusMapping(existingTask.project_status_mapping_id);
            if (!currentMapping) {
                throw new Error('Current status mapping not found');
            }

            // Get all status mappings for the new project
            const newProjectMappings = await ProjectModel.getProjectStatusMappings(newPhase.project_id);
            
            // If no mappings exist in the target project, create default ones
            if (!newProjectMappings || newProjectMappings.length === 0) {
                const standardStatuses = await ProjectModel.getStandardStatusesByType('project_task');
                for (const status of standardStatuses) {
                    await ProjectModel.addProjectStatusMapping(newPhase.project_id, {
                        standard_status_id: status.standard_status_id,
                        is_standard: true,
                        custom_name: null,
                        display_order: status.display_order,
                        is_visible: true,
                    });
                }
                // Fetch the newly created mappings
                const updatedMappings = await ProjectModel.getProjectStatusMappings(newPhase.project_id);
                if (!updatedMappings || updatedMappings.length === 0) {
                    throw new Error('Failed to create status mappings for target project');
                }
                finalStatusMappingId = updatedMappings[0].project_status_mapping_id;
            } else {
                let equivalentMapping: IProjectStatusMapping | undefined;

                if (currentMapping.is_standard && currentMapping.standard_status_id) {
                    // If it's a standard status, find mapping with same standard_status_id
                    equivalentMapping = newProjectMappings.find(m => 
                        m.is_standard && m.standard_status_id === currentMapping.standard_status_id
                    );
                } else if (currentMapping.status_id) {
                    // For custom status, try to match by custom name
                    const currentStatus = await ProjectModel.getCustomStatus(currentMapping.status_id);
                    if (currentStatus) {
                        equivalentMapping = newProjectMappings.find(m => 
                            !m.is_standard && m.custom_name === currentMapping.custom_name
                        );
                    }
                }

                if (!equivalentMapping) {
                    // If no equivalent found, use first available status
                    equivalentMapping = newProjectMappings[0];
                }

                if (!equivalentMapping) {
                    throw new Error('No valid status mapping found in target project');
                }

                finalStatusMappingId = equivalentMapping.project_status_mapping_id;
            }
        }

        // Generate new WBS code for the task
        const newWbsCode = await ProjectModel.generateNextWbsCode(newPhase.wbs_code);

        // Update task with new phase, project, and WBS code
        const updatedTask = await ProjectModel.updateTask(taskId, {
            phase_id: newPhaseId,
            wbs_code: newWbsCode,
            project_status_mapping_id: finalStatusMappingId,
            // Preserve other important fields
            task_name: existingTask.task_name,
            description: existingTask.description,
            assigned_to: existingTask.assigned_to,
            estimated_hours: existingTask.estimated_hours,
            actual_hours: existingTask.actual_hours,
            due_date: existingTask.due_date
        });

        // If this is a cross-project move, update ticket links
        if (currentPhase.project_id !== newPhase.project_id) {
            const ticketLinks = await ProjectModel.getTaskTicketLinks(taskId);
            for (const link of ticketLinks) {
                await ProjectModel.updateTaskTicketLink(link.link_id, {
                    project_id: newPhase.project_id,
                    phase_id: newPhaseId
                });
            }
        }

        return updatedTask;
    } catch (error) {
        console.error('Error moving task to new phase:', error);
        throw error;
    }
}

export async function addProjectPhase(phaseData: Omit<IProjectPhase, 'phase_id' | 'created_at' | 'updated_at' | 'tenant'>): Promise<IProjectPhase> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }

        await checkPermission(currentUser, 'project', 'update');

        // Validate phase data
        const validatedData = validateData(projectPhaseSchema.omit({ 
            phase_id: true,
            created_at: true,
            updated_at: true,
            tenant: true
        }), phaseData);

        // Get the project's phases to determine the next order number
        const phases = await ProjectModel.getPhases(phaseData.project_id);
        const nextOrderNumber = phases.length + 1;

        // Find the highest existing WBS code number
        const existingWbsCodes = phases.map((phase): number => parseInt(phase.wbs_code));
        const maxWbsCode = existingWbsCodes.length > 0 ? Math.max(...existingWbsCodes) : 0;
        const newWbsCode = (maxWbsCode + 1).toString();

        const phaseWithDefaults = {
            ...validatedData,
            order_number: nextOrderNumber,
            wbs_code: newWbsCode,
        };

        return await ProjectModel.addPhase(phaseWithDefaults);
    } catch (error) {
        console.error('Error adding project phase:', error);
        throw error;
    }
}

export async function getProject(projectId: string): Promise<IProject | null> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }
        await checkPermission(currentUser, 'project', 'read');
        return await ProjectModel.getById(projectId);
    } catch (error) {
        console.error('Error fetching project:', error);
        throw error;
    }
}

async function getStandardProjectTaskStatuses(): Promise<IStandardStatus[]> {
    try {
        return await ProjectModel.getStandardStatusesByType('project_task');
    } catch (error) {
        console.error('Error fetching standard project task statuses:', error);
        throw new Error('Failed to fetch standard project task statuses');
    }
}

async function getProjectStatuses(): Promise<IStatus[]> {
  try {
    return await ProjectModel.getStatusesByType('project');
  } catch (error) {
    console.error('Error fetching project statuses:', error);
    throw new Error('Failed to fetch project statuses');
  }
}

export async function createProject(projectData: Omit<IProject, 'project_id' | 'created_at' | 'updated_at'>): Promise<IProject> {
    try {
        const [standardTaskStatuses, projectStatuses] = await Promise.all([
            getStandardProjectTaskStatuses(),
            getProjectStatuses()
        ]);

        if (projectStatuses.length === 0) {
            throw new Error('No project statuses found');
        }

        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }
        await checkPermission(currentUser, 'project', 'create');

        // Validate project data
        const validatedData = validateData(createProjectSchema, projectData);

        // Set initial project status to first available status
        const initialStatus = projectStatuses[0];
        const projectDataWithStatus = {
            ...validatedData,
            status: initialStatus.status_id
        };

        const newProject = await ProjectModel.create(projectDataWithStatus);

        // Add task status mappings
        for (const status of standardTaskStatuses) {
            await ProjectModel.addProjectStatusMapping(newProject.project_id, {
                standard_status_id: status.standard_status_id,
                is_standard: true,
                custom_name: null,
                display_order: status.display_order,
                is_visible: true,
            });
        }

        return newProject;
    } catch (error) {
        console.error('Error creating project:', error);
        throw error;
    }
}

export async function updateTaskWithChecklist(
    taskId: string,
    taskData: Partial<IProjectTask>
): Promise<IProjectTask | null> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }

        await checkPermission(currentUser, 'project', 'update');

        // Get existing task to preserve checklist items
        const existingTask = await ProjectModel.getTaskById(taskId);
        if (!existingTask) {
            throw new Error("Task not found");
        }

        // Extract checklist items from taskData and remove them from the task update
        const { checklist_items, ...taskUpdateData } = taskData;

        // Validate task data
        const validatedTaskData = validateData(updateTaskSchema, taskUpdateData);

        // Update task
        const updatedTask = await ProjectModel.updateTask(taskId, validatedTaskData);

        // If checklist items were provided, update them
        if (checklist_items) {
            // Delete existing checklist items
            await ProjectModel.deleteChecklistItems(taskId);
            
            // Add new checklist items
            for (const item of checklist_items) {
                await ProjectModel.addChecklistItem(taskId, item);
            }
        }
        
        // Return task with current checklist items
        return await ProjectModel.getTaskById(taskId);
    } catch (error) {
        console.error('Error updating task:', error);
        throw error;
    }
}

export async function addTaskToPhase(
    phaseId: string, 
    taskData: Omit<IProjectTask, 'task_id' | 'phase_id' | 'created_at' | 'updated_at' | 'tenant'>,
    checklistItems: Omit<ITaskChecklistItem, 'checklist_item_id' | 'task_id' | 'created_at' | 'updated_at' | 'tenant'>[]
): Promise<IProjectTask|null> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }

        await checkPermission(currentUser, 'project', 'update');

        // Get the phase to find its project
        const phase = await ProjectModel.getPhaseById(phaseId);
        if (!phase) {
            throw new Error("Phase not found");
        }

        // Get project status mappings
        const statusMappings = await ProjectModel.getProjectStatusMappings(phase.project_id);
        if (!statusMappings || statusMappings.length === 0) {
            throw new Error("No status mappings found for project");
        }

        // Prepare task data with status mapping
        const finalTaskData = { ...taskData };

        // If project_status_mapping_id is provided, validate it
        if (taskData.project_status_mapping_id) {
            const isValidStatus = statusMappings.some(
                mapping => mapping.project_status_mapping_id === taskData.project_status_mapping_id
            );
            if (!isValidStatus) {
                throw new Error("Invalid project_status_mapping_id provided");
            }
        } else {
            // If no status is provided, use the first one as default
            finalTaskData.project_status_mapping_id = statusMappings[0].project_status_mapping_id;
        }

        // Validate task data and checklist items
        const validatedTaskData = validateData(createTaskSchema, finalTaskData);
        const validatedChecklistItems = validateArray(createChecklistItemSchema, checklistItems);

        const newTask = await ProjectModel.addTask(phaseId, validatedTaskData);

        // Add checklist items to the new task
        for (const item of validatedChecklistItems) {
            await ProjectModel.addChecklistItem(newTask.task_id, item);
        }

        // Fetch the task again to include the checklist items
        const taskWithChecklist = await ProjectModel.getTaskById(newTask.task_id);
        return taskWithChecklist;
    } catch (error) {
        console.error('Error adding task to phase:', error);
        throw error;
    }
}

export async function updateProject(projectId: string, projectData: Partial<IProject>): Promise<IProject> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }

        await checkPermission(currentUser, 'project', 'update');

        // Validate project data
        const validatedData = validateData(updateProjectSchema, projectData);
        
        const updatedProject = await ProjectModel.update(projectId, validatedData);
        return updatedProject;
    } catch (error) {
        console.error('Error updating project:', error);
        throw error;
    }
}

export async function deleteProject(projectId: string): Promise<void> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }

        await checkPermission(currentUser, 'project', 'delete');
        await ProjectModel.delete(projectId);
    } catch (error) {
        console.error('Error deleting project:', error);
        throw error;
    }
}

export async function getProjectDetails(projectId: string): Promise<{
    project: IProject;
    phases: IProjectPhase[];
    tasks: IProjectTask[];
    ticketLinks: IProjectTicketLinkWithDetails[];
    statuses: ProjectStatus[];
    users: IUserWithRoles[];
}> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }

        await checkPermission(currentUser, 'project', 'read');
        
        const [project, phases, rawTasks, statuses, users, checklistItemsMap, ticketLinksMap] = await Promise.all([
            ProjectModel.getById(projectId),
            ProjectModel.getPhases(projectId),
            ProjectModel.getTasks(projectId),
            getProjectTaskStatuses(projectId),
            getAllUsers(),
            ProjectModel.getAllTaskChecklistItems(projectId),
            ProjectModel.getAllTaskTicketLinks(projectId)
        ]);

        if (!project) {
            throw new Error('Project not found');
        }

        const tasks = rawTasks.map((task): IProjectTask & { checklist_items: ITaskChecklistItem[] } => ({
            ...task,
            checklist_items: checklistItemsMap[task.task_id] || []
        }));

        // Flatten ticket links for backward compatibility
        const ticketLinks = Object.values(ticketLinksMap).flat();

        return { project, phases, tasks, ticketLinks, statuses, users };
    } catch (error) {
        console.error('Error fetching project details:', error);
        throw error;
    }
}

export async function updateProjectStructure(projectId: string, updates: { phases: Partial<IProjectPhase>[]; tasks: Partial<IProjectTask>[] }): Promise<void> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }

        await checkPermission(currentUser, 'project', 'update');
        await ProjectModel.updateStructure(projectId, updates);
    } catch (error) {
        console.error('Error updating project structure:', error);
        throw error;
    }
}

export async function updateTaskStatus(taskId: string, projectStatusMappingId: string): Promise<IProjectTask> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }

        await checkPermission(currentUser, 'project', 'update');
        return await ProjectModel.updateTaskStatus(taskId, projectStatusMappingId);
    } catch (error) {
        console.error('Error updating task status:', error);
        throw error;
    }
}

export async function getProjectTaskStatuses(projectId: string): Promise<ProjectStatus[]> {
    try {
        const statusMappings = await ProjectModel.getProjectStatusMappings(projectId);
        if (!statusMappings || statusMappings.length === 0) {
            console.warn(`No status mappings found for project ${projectId}`);
            return [];
        }

        const statuses = await Promise.all(statusMappings.map(async (mapping: IProjectStatusMapping): Promise<ProjectStatus | null> => {
            try {
                if (mapping.is_standard && mapping.standard_status_id) {
                    const standardStatus = await ProjectModel.getStandardStatus(mapping.standard_status_id);
                    if (!standardStatus) {
                        console.warn(`Standard status not found for mapping ${mapping.project_status_mapping_id}`);
                        return null;
                    }
                    return {
                        ...standardStatus,
                        project_status_mapping_id: mapping.project_status_mapping_id,
                        status_id: standardStatus.standard_status_id,
                        custom_name: mapping.custom_name,
                        display_order: mapping.display_order,
                        is_visible: mapping.is_visible,
                        is_standard: true,
                        is_closed: standardStatus.is_closed
                    } as ProjectStatus;
                } else if (mapping.status_id) {
                    const customStatus = await ProjectModel.getCustomStatus(mapping.status_id);
                    if (!customStatus) {
                        console.warn(`Custom status not found for mapping ${mapping.project_status_mapping_id}`);
                        return null;
                    }
                    return {
                        ...customStatus,
                        project_status_mapping_id: mapping.project_status_mapping_id,
                        status_id: customStatus.status_id,
                        custom_name: mapping.custom_name,
                        display_order: mapping.display_order,
                        is_visible: mapping.is_visible,
                        is_standard: false,
                        is_closed: customStatus.is_closed
                    } as ProjectStatus;
                }
                console.warn(`Invalid status mapping ${mapping.project_status_mapping_id}: missing both standard_status_id and status_id`);
                return null;
            } catch (error) {
                console.error(`Error processing status mapping ${mapping.project_status_mapping_id}:`, error);
                return null;
            }
        }));

        // Filter out any null values from failed status fetches
        const validStatuses = statuses.filter((status): status is ProjectStatus => status !== null);
        
        if (validStatuses.length === 0) {
            console.warn(`No valid statuses found for project ${projectId}`);
            return [];
        }

        return validStatuses;
    } catch (error) {
        console.error('Error fetching project statuses:', error);
        // Return empty array instead of throwing to prevent cascade failures
        return [];
    }
}

export async function addStatusToProject(
    projectId: string,
    statusData: Omit<IStatus, 'status_id' | 'created_at' | 'updated_at'>
): Promise<IStatus> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }

        await checkPermission(currentUser, 'project', 'update');
        return await ProjectModel.addStatusToProject(projectId, statusData);
    } catch (error) {
        console.error('Error adding status to task:', error);
        throw error;
    }
}

export async function updateProjectStatus(
    statusId: string,
    statusData: Partial<IStatus>,
    mappingData: Partial<IProjectStatusMapping>
): Promise<IStatus> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }

        await checkPermission(currentUser, 'project', 'update');
        return await ProjectModel.updateProjectStatus(statusId, statusData, mappingData);
    } catch (error) {
        console.error('Error updating project status:', error);
        throw new Error('Failed to update project status');
    }
}

export async function deleteProjectStatus(statusId: string): Promise<void> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }

        await checkPermission(currentUser, 'project', 'delete');
        await ProjectModel.deleteProjectStatus(statusId);
    } catch (error) {
        console.error('Error deleting project status:', error);
        throw new Error('Failed to delete project status');
    }
}

export async function addChecklistItemToTask(
    taskId: string,
    itemData: Omit<ITaskChecklistItem, 'checklist_item_id' | 'task_id' | 'created_at' | 'updated_at'>
): Promise<ITaskChecklistItem> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }

        await checkPermission(currentUser, 'project', 'update');
        
        // Validate checklist item data
        const validatedData = validateData(createChecklistItemSchema, itemData);
        
        return await ProjectModel.addChecklistItem(taskId, validatedData);
    } catch (error) {
        console.error('Error adding checklist item to task:', error);
        throw error;
    }
}

export async function updateChecklistItem(
    checklistItemId: string,
    itemData: Partial<ITaskChecklistItem>
): Promise<ITaskChecklistItem> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }

        await checkPermission(currentUser, 'project', 'update');
        
        // Validate checklist item data
        const validatedData = validateData(updateChecklistItemSchema, itemData);
        
        return await ProjectModel.updateChecklistItem(checklistItemId, validatedData);
    } catch (error) {
        console.error('Error updating checklist item:', error);
        throw error;
    }
}

export async function deleteChecklistItem(checklistItemId: string): Promise<void> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }

        await checkPermission(currentUser, 'project', 'delete');
        await ProjectModel.deleteChecklistItem(checklistItemId);
    } catch (error) {
        console.error('Error deleting checklist item:', error);
        throw error;
    }
}

export async function getTaskChecklistItems(taskId: string): Promise<ITaskChecklistItem[]> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }

        await checkPermission(currentUser, 'project', 'read');
        return await ProjectModel.getChecklistItems(taskId);
    } catch (error) {
        console.error('Error fetching task checklist items:', error);
        throw error;
    }
}

export async function deleteTask(taskId: string): Promise<void> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }

        await checkPermission(currentUser, 'project', 'delete');

        const ticketLinks = await ProjectModel.getTaskTicketLinks(taskId);
        
        for (const link of ticketLinks) {
            await ProjectModel.deleteTaskTicketLink(link.link_id);
        }

        await ProjectModel.deleteChecklistItems(taskId);

        await ProjectModel.deleteTask(taskId);
    } catch (error) {
        console.error('Error deleting task:', error);
        throw error;
    }
}

export async function addTicketLinkAction(projectId: string, taskId: string | null, ticketId: string, phaseId: string): Promise<IProjectTicketLink> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }

        await checkPermission(currentUser, 'project', 'update');
        return await ProjectModel.addTaskTicketLink(projectId, taskId, ticketId, phaseId);
    } catch (error) {
        console.error('Error adding ticket link:', error);
        throw error;
    }
}

export async function getTaskTicketLinksAction(taskId: string): Promise<IProjectTicketLinkWithDetails[]> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }

        await checkPermission(currentUser, 'project', 'read');
        return await ProjectModel.getTaskTicketLinks(taskId);
    } catch (error) {
        console.error('Error getting task ticket links:', error);
        throw error;
    }
}

export async function addTaskResourceAction(taskId: string, userId: string, role?: string): Promise<void> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }

        await checkPermission(currentUser, 'project', 'update');
        await ProjectModel.addTaskResource(taskId, userId, role);
    } catch (error) {
        console.error('Error adding task resource:', error);
        throw error;
    }
}

export async function removeTaskResourceAction(assignmentId: string): Promise<void> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }

        await checkPermission(currentUser, 'project', 'update');
        await ProjectModel.removeTaskResource(assignmentId);
    } catch (error) {
        console.error('Error removing task resource:', error);
        throw error;
    }
}

export async function getTaskResourcesAction(taskId: string): Promise<any[]> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }

        await checkPermission(currentUser, 'project', 'read');
        return await ProjectModel.getTaskResources(taskId);
    } catch (error) {
        console.error('Error getting task resources:', error);
        throw error;
    }
}

export async function deleteTaskTicketLinkAction(linkId: string): Promise<void> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }

        await checkPermission(currentUser, 'project', 'update');
        await ProjectModel.deleteTaskTicketLink(linkId);
    } catch (error) {
        console.error('Error deleting ticket link:', error);
        throw error;
    }
}

export async function reorderTasksInStatus(tasks: { taskId: string, newWbsCode: string }[]): Promise<void> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }

        await checkPermission(currentUser, 'project', 'update');

        const {knex: db} = await createTenantKnex();
        await db.transaction(async (trx: Knex.Transaction) => {
            // Verify tasks exist and are in the same phase
            const taskRecords = await trx('project_tasks')
                .whereIn('task_id', tasks.map(t => t.taskId))
                .select('task_id', 'phase_id');

            if (taskRecords.length !== tasks.length) {
                throw new Error('Some tasks not found');
            }

            const phaseId = taskRecords[0].phase_id;
            if (!taskRecords.every(t => t.phase_id === phaseId)) {
                throw new Error('All tasks must be in the same phase');
            }

            // Update all tasks with their new WBS codes
            await Promise.all(tasks.map(({taskId, newWbsCode}) =>
                trx('project_tasks')
                    .where('task_id', taskId)
                    .update({
                        wbs_code: newWbsCode,
                        updated_at: trx.fn.now()
                    })
            ));
        });
    } catch (error) {
        console.error('Error reordering tasks:', error);
        throw error;
    }
}
