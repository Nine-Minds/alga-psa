// server/src/lib/actions/projectActions.ts
'use server'

import ProjectModel from '../models/project';
import { IProject, IProjectPhase, IProjectTask, IProjectTicketLink, IStatus, IProjectStatusMapping, IStandardStatus, ItemType, ITaskChecklistItem, IProjectTicketLinkWithDetails } from '@/interfaces/project.interfaces';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import { IUser, IUserWithRoles } from '@/interfaces/auth.interfaces';
import { hasPermission } from '@/lib/auth/rbac';
import { getAllUsers } from './user-actions/userActions';
import { validateData, validateArray } from '../utils/validation';
import { 
    createProjectSchema, 
    updateProjectSchema, 
    createTaskSchema, 
    updateTaskSchema, 
    createChecklistItemSchema, 
    updateChecklistItemSchema,
    projectPhaseSchema 
} from '../schemas/project.schemas';
import { createTenantKnex } from '@/lib/db';

// Define a new type that combines IStatus or IStandardStatus with additional properties
export type ProjectStatus = {
    project_status_mapping_id: string;
    status_id: string;
    name: string;
    custom_name: string | null;
    is_visible: boolean;
    display_order: number;
    is_standard: boolean;
    is_closed: boolean;
    item_type?: ItemType;
    status_type?: ItemType;
};

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

export async function getProjectPhases(projectId: string): Promise<IProjectPhase[]> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }
        await checkPermission(currentUser, 'project', 'read');
        return await ProjectModel.getPhases(projectId);
    } catch (error) {
        console.error('Error fetching project phases:', error);
        throw error;
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

export async function moveTaskToPhase(
    taskId: string, 
    newPhaseId: string,
    newProjectId?: string,
    newStatusId?: string
): Promise<IProjectTask> {
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

        // Get the new phase to access its WBS code
        const newPhase = await ProjectModel.getPhaseById(newPhaseId);
        if (!newPhase) {
            throw new Error('Target phase not found');
        }

        // Generate new WBS code for the task using the proper method
        const newWbsCode = await ProjectModel.generateNextWbsCode(newPhase.wbs_code);

        // If moving to a different project, update ticket links
        if (newProjectId && newProjectId !== newPhase.project_id) {
            const {knex: db} = await createTenantKnex();
            await db('project_ticket_links')
                .where('task_id', taskId)
                .update({
                    project_id: newProjectId,
                    updated_at: db.fn.now()
                });
        }

        // Update task with new phase and WBS code
        const updatedTask = await ProjectModel.updateTask(taskId, {
            phase_id: newPhaseId,
            wbs_code: newWbsCode,
            // Preserve other important fields but NOT the old wbs_code
            task_name: existingTask.task_name,
            description: existingTask.description,
            assigned_to: existingTask.assigned_to,
            estimated_hours: existingTask.estimated_hours,
            actual_hours: existingTask.actual_hours,
            project_status_mapping_id: newStatusId || existingTask.project_status_mapping_id,
            due_date: existingTask.due_date
        });

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

        // Get the project's phases to determine the next order number and WBS code
        const phases = await ProjectModel.getPhases(phaseData.project_id);
        const nextOrderNumber = phases.length + 1;
        const wbsCode = `${nextOrderNumber}`;

        const phaseWithDefaults = {
            ...validatedData,
            order_number: nextOrderNumber,
            wbs_code: wbsCode,
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

        // Validate task data and checklist items
        const validatedTaskData = validateData(createTaskSchema, taskData);
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
        const project = await ProjectModel.getById(projectId);
        if (project == null) {
            throw new Error('Project not found');
        }
        const phases = await ProjectModel.getPhases(projectId);
        const tasks = await ProjectModel.getTasks(projectId);
        // Get all ticket links for all tasks in the project
        const ticketLinks = await Promise.all(
            tasks.map((task: IProjectTask): Promise<IProjectTicketLinkWithDetails[]> => ProjectModel.getTaskTicketLinks(task.task_id))
        ).then(links => links.flat());
        const statuses = await getProjectTaskStatuses(projectId);
        const users = await getAllUsers();
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
        const statuses = await Promise.all(statusMappings.map(async (mapping: IProjectStatusMapping): Promise<ProjectStatus> => {
            if (mapping.is_standard && mapping.standard_status_id) {
                const standardStatus = await ProjectModel.getStandardStatus(mapping.standard_status_id);
                return {
                    ...standardStatus,
                    project_status_mapping_id: mapping.project_status_mapping_id,
                    status_id: standardStatus!.standard_status_id,
                    custom_name: mapping.custom_name,
                    display_order: mapping.display_order,
                    is_visible: mapping.is_visible,
                    is_standard: true,
                    is_closed: standardStatus?.is_closed
                } as ProjectStatus;
            } else if (mapping.status_id) {
                const customStatus = await ProjectModel.getCustomStatus(mapping.status_id);
                return {
                    ...customStatus,
                    project_status_mapping_id: mapping.project_status_mapping_id,
                    status_id: customStatus!.status_id,
                    custom_name: mapping.custom_name,
                    display_order: mapping.display_order,
                    is_visible: mapping.is_visible,
                    is_standard: false,
                    is_closed: customStatus!.is_closed
                } as ProjectStatus;
            } else {
                throw new Error('Invalid status mapping');
            }
        }));
        return statuses;
    } catch (error) {
        console.error('Error fetching project statuses:', error);
        throw new Error('Failed to fetch project statuses');
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

export async function addTicketLinkAction(projectId: string, taskId: string | null, ticketId: string): Promise<IProjectTicketLink> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }

        await checkPermission(currentUser, 'project', 'update');
        return await ProjectModel.addTaskTicketLink(projectId, taskId, ticketId);
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
