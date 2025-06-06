'use server';

import { Knex } from 'knex';
import ProjectTaskModel from 'server/src/lib/models/projectTask';
import ProjectModel from 'server/src/lib/models/project';
import { publishEvent } from 'server/src/lib/eventBus/publishers';
import { IProjectTask, IProjectTicketLink, IProjectStatusMapping, ITaskChecklistItem, IProjectTicketLinkWithDetails, IProjectPhase } from 'server/src/interfaces/project.interfaces';
import { IUser, IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { validateData, validateArray } from 'server/src/lib/utils/validation';
import { createTenantKnex } from 'server/src/lib/db';
import { withTransaction } from '@shared/db';
import { omit } from 'lodash';
import { 
    createTaskSchema, 
    updateTaskSchema, 
    createChecklistItemSchema, 
    updateChecklistItemSchema
} from 'server/src/lib/schemas/project.schemas';
import { OrderingService } from '../../services/orderingService';
import { validateAndFixOrderKeys } from './regenerateOrderKeys';

async function checkPermission(user: IUser, resource: string, action: string): Promise<void> {
    const hasPermissionResult = await hasPermission(user, resource, action);
    if (!hasPermissionResult) {
        throw new Error(`Permission denied: Cannot ${action} ${resource}`);
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
        if (!currentUser.tenant) {
            throw new Error("tenant context not found");
        }

        await checkPermission(currentUser, 'project', 'update');

        const {knex: db} = await createTenantKnex();
        const existingTask = await ProjectTaskModel.getTaskById(db, taskId);
        if (!existingTask) {
            throw new Error("Task not found");
        }

        // Remove tenant field if present in taskData
        const { checklist_items, tenant: _, ...taskUpdateData } = taskData;
        const validatedTaskData = validateData(updateTaskSchema, taskUpdateData);

        const updatedTask = await ProjectTaskModel.updateTask(db, taskId, validatedTaskData);

        // If assigned_to was updated, publish event
        if ('assigned_to' in taskData && updatedTask.assigned_to) {
            const phase = await ProjectModel.getPhaseById(db, updatedTask.phase_id);
            if (phase) {
                // Ensure tenant exists before publishing event
                if (!currentUser.tenant) {
                    throw new Error("tenant context required for event publishing");
                }

                await publishEvent({
                    eventType: 'PROJECT_TASK_ASSIGNED',
                    payload: {
                        tenantId: currentUser.tenant,
                        projectId: phase.project_id,
                        taskId: taskId,
                        userId: currentUser.user_id,
                        assignedTo: updatedTask.assigned_to,
                        additionalUsers: [], // No additional users in this case
                        timestamp: new Date().toISOString()
                    }
                });
            }
        }

        if (checklist_items) {
            await ProjectTaskModel.deleteChecklistItems(db, taskId);
            
            for (const item of checklist_items) {
                await ProjectTaskModel.addChecklistItem(db, taskId, item);
            }
        }
        
        const finalTask = await ProjectTaskModel.getTaskById(db, taskId);
        if (!finalTask) {
            throw new Error('Task not found after update');
        }
        return finalTask;
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
        if (!currentUser.tenant) {
            throw new Error("tenant context not found");
        }

        await checkPermission(currentUser, 'project', 'update');

        const {knex: db} = await createTenantKnex();
        const newTask = await ProjectTaskModel.addTask(db, phaseId, taskData);

        // If task is assigned to someone, publish event
        if (taskData.assigned_to) {
            const phase = await ProjectModel.getPhaseById(db, phaseId);
            if (phase) {
                await publishEvent({
                    eventType: 'PROJECT_TASK_ASSIGNED',
                    payload: {
                        tenantId: currentUser.tenant,
                        projectId: phase.project_id,
                        taskId: newTask.task_id,
                        userId: currentUser.user_id,
                        assignedTo: taskData.assigned_to,
                        additionalUsers: [], // No additional users in initial creation
                        timestamp: new Date().toISOString()
                    }
                });
            }
        }

        for (const item of checklistItems) {
            await ProjectTaskModel.addChecklistItem(db, newTask.task_id, item);
        }

        const taskWithChecklist = await ProjectTaskModel.getTaskById(db, newTask.task_id);
        return taskWithChecklist;
    } catch (error) {
        console.error('Error adding task to phase:', error);
        throw error;
    }
}

export async function updateTaskStatus(
    taskId: string, 
    projectStatusMappingId: string,
    beforeTaskId?: string | null,
    afterTaskId?: string | null
): Promise<IProjectTask> {
    
    const {knex: db, tenant} = await createTenantKnex();
    
    return await withTransaction(db, async (trx: Knex.Transaction) => {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }

        await checkPermission(currentUser, 'project', 'update');
        
        try {
            // Get the current task to preserve its phase_id
            const task = await trx<IProjectTask>('project_tasks')
                .where('task_id', taskId)
                .andWhere('tenant', tenant!)
                .first();
            if (!task) {
                throw new Error('Task not found');
            }

            // Validate the target status exists in the same project
            const targetStatus = await trx('project_status_mappings')
                .where('project_status_mapping_id', projectStatusMappingId)
                .andWhere('tenant', tenant!)
                .first();
            
            if (!targetStatus) {
                throw new Error('Target status not found');
            }

            // Get order keys for positioning
            let beforeKey: string | null = null;
            let afterKey: string | null = null;
            
            if (beforeTaskId) {
                const beforeTask = await trx('project_tasks')
                    .where({ task_id: beforeTaskId, tenant })
                    .select('order_key')
                    .first();
                beforeKey = beforeTask?.order_key || null;
                console.log('Before task:', beforeTaskId, 'key:', beforeKey);
            }
            
            if (afterTaskId) {
                const afterTask = await trx('project_tasks')
                    .where({ task_id: afterTaskId, tenant })
                    .select('order_key')
                    .first();
                afterKey = afterTask?.order_key || null;
                console.log('After task:', afterTaskId, 'key:', afterKey);
            }
            
            // If no position specified (checking for both null and undefined), add to end of target status
            if ((beforeKey === null || beforeKey === undefined) && (afterKey === null || afterKey === undefined)) {
                const lastTask = await trx('project_tasks')
                    .where({ 
                        phase_id: task.phase_id,
                        project_status_mapping_id: projectStatusMappingId,
                        tenant 
                    })
                    .orderBy('order_key', 'desc')
                    .first();
                beforeKey = lastTask?.order_key || null;
                console.log('No position specified, adding to end. Last task key:', beforeKey);
            }
            
            const newOrderKey = OrderingService.generateKeyForPosition(beforeKey, afterKey);
            console.log('Generated new order key:', newOrderKey, 'between:', beforeKey, 'and', afterKey);

            // Update the task
            await trx('project_tasks')
                .where('task_id', taskId)
                .andWhere('tenant', tenant!)
                .update({
                    project_status_mapping_id: projectStatusMappingId,
                    order_key: newOrderKey,
                    updated_at: trx.fn.now()
                });

            const updatedTask = await trx<IProjectTask>('project_tasks')
                .where('task_id', taskId)
                .andWhere('tenant', tenant!)
                .first();
            if (!updatedTask) {
                throw new Error('Task not found after status update');
            }
            
            return updatedTask;
        } catch (error) {
            console.error('Error in updateTaskStatus transaction:', error);
            throw error;
        }
    });
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
        
        const validatedData = validateData(createChecklistItemSchema, itemData);
        
        const {knex: db} = await createTenantKnex();
        return await ProjectTaskModel.addChecklistItem(db, taskId, validatedData);
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
        
        const validatedData = validateData(updateChecklistItemSchema, itemData);
        
        const {knex: db} = await createTenantKnex();
        return await ProjectTaskModel.updateChecklistItem(db, checklistItemId, validatedData);
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
        const {knex: db} = await createTenantKnex();
        await ProjectTaskModel.deleteChecklistItem(db, checklistItemId);
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
        const {knex: db} = await createTenantKnex();
        return await ProjectTaskModel.getChecklistItems(db, taskId);
    } catch (error) {
        console.error('Error fetching task checklist items:', error);
        throw error;
    }
}

export async function deleteTask(taskId: string): Promise<void> {
    const {knex: db, tenant} = await createTenantKnex(); // Get Knex instance and tenant
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }

        await checkPermission(currentUser, 'project', 'delete');
 
        // Check for associated time entries before proceeding
        const timeEntryCount = await db('time_entries')
            .where({
                work_item_id: taskId,
                work_item_type: 'project_task',
                tenant: tenant!
            })
            .count('* as count')
            .first();
 
        if (timeEntryCount && Number(timeEntryCount.count) > 0) {
            throw new Error(`Cannot delete task: ${timeEntryCount.count} associated time entries exist.`);
        }

        const ticketLinks = await ProjectTaskModel.getTaskTicketLinks(db, taskId);
        
        for (const link of ticketLinks) {
            await ProjectTaskModel.deleteTaskTicketLink(db, link.link_id);
        }

        await ProjectTaskModel.deleteChecklistItems(db, taskId);

        await ProjectTaskModel.deleteTask(db, taskId);
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
        const {knex: db} = await createTenantKnex();
        return await ProjectTaskModel.addTaskTicketLink(db, projectId, taskId, ticketId, phaseId);
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
        const {knex: db} = await createTenantKnex();
        return await ProjectTaskModel.getTaskTicketLinks(db, taskId);
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
        const {knex: db} = await createTenantKnex();
        await ProjectTaskModel.addTaskResource(db, taskId, userId, role);

        // When adding additional resource, publish task assigned event
        const task = await ProjectTaskModel.getTaskById(db, taskId);
        if (task) {
            const phase = await ProjectModel.getPhaseById(db, task.phase_id);
            if (phase) {
                await publishEvent({
                    eventType: 'PROJECT_TASK_ASSIGNED',
                    payload: {
                        tenantId: currentUser.tenant,
                        projectId: phase.project_id,
                        taskId: taskId,
                        userId: currentUser.user_id,
                        assignedTo: userId,
                        additionalUsers: [] // This user is being added as a primary resource
                    }
                });
            }
        }
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
        const {knex: db} = await createTenantKnex();
        await ProjectTaskModel.removeTaskResource(db, assignmentId);
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
        const {knex: db} = await createTenantKnex();
        return await ProjectTaskModel.getTaskResources(db, taskId);
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
        const {knex: db} = await createTenantKnex();
        await ProjectTaskModel.deleteTaskTicketLink(db, linkId);
    } catch (error) {
        console.error('Error deleting ticket link:', error);
        throw error;
    }
}

export async function moveTaskToPhase(
    taskId: string, 
    newPhaseId: string, 
    newStatusMappingId?: string,
    targetProjectId?: string,
    beforeTaskId?: string | null,
    afterTaskId?: string | null
): Promise<IProjectTask> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }

        await checkPermission(currentUser, 'project', 'update');

        const {knex: db} = await createTenantKnex();
        
        // Get the existing task to preserve its data
        const existingTask = await ProjectTaskModel.getTaskById(db, taskId);
        if (!existingTask) {
            throw new Error('Task not found');
        }

        // Get the new phase to access its project and WBS code
        const newPhase = await ProjectModel.getPhaseById(db, newPhaseId);
        if (!newPhase) {
            throw new Error('Target phase not found');
        }

        // Get the current phase to check if this is a cross-project move
        const currentPhase = await ProjectModel.getPhaseById(db, existingTask.phase_id);
        if (!currentPhase) {
            throw new Error('Current phase not found');
        }

        // Always use the provided status mapping ID if it exists
        let finalStatusMappingId = newStatusMappingId || existingTask.project_status_mapping_id;

        // If moving to a different project and no specific status mapping is provided
        if (currentPhase.project_id !== newPhase.project_id && !newStatusMappingId) {
            // Get current status mapping
            const currentMapping = await ProjectModel.getProjectStatusMapping(db, existingTask.project_status_mapping_id);
            if (!currentMapping) {
                throw new Error('Current status mapping not found');
            }

            // Get all status mappings for the new project
            const newProjectMappings = await ProjectModel.getProjectStatusMappings(db, newPhase.project_id);
            
            // If no mappings exist in the target project, create default ones
            if (!newProjectMappings || newProjectMappings.length === 0) {
                const standardStatuses = await ProjectModel.getStandardStatusesByType(db, 'project_task');
                for (const status of standardStatuses) {
                    await ProjectModel.addProjectStatusMapping(db, newPhase.project_id, {
                        standard_status_id: status.standard_status_id,
                        is_standard: true,
                        custom_name: null,
                        display_order: status.display_order,
                        is_visible: true,
                    });
                }
                // Fetch the newly created mappings
                const updatedMappings = await ProjectModel.getProjectStatusMappings(db, newPhase.project_id);
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
                    const currentStatus = await ProjectModel.getCustomStatus(db, currentMapping.status_id);
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
        const newWbsCode = await ProjectModel.generateNextWbsCode(db, newPhase.wbs_code);

        // Get order key for new position
        const {tenant} = await createTenantKnex();
        const updatedTask = await withTransaction(db, async (trx) => {
            let beforeKey: string | null = null;
            let afterKey: string | null = null;
            
            if (beforeTaskId) {
                const beforeTask = await trx('project_tasks')
                    .where({ task_id: beforeTaskId, tenant })
                    .select('order_key')
                    .first();
                beforeKey = beforeTask?.order_key || null;
            }
            
            if (afterTaskId) {
                const afterTask = await trx('project_tasks')
                    .where({ task_id: afterTaskId, tenant })
                    .select('order_key')
                    .first();
                afterKey = afterTask?.order_key || null;
            }
            
            // If no position specified, add to end of target status
            if (!beforeKey && !afterKey) {
                const lastTask = await trx('project_tasks')
                    .where({ 
                        phase_id: newPhaseId, 
                        project_status_mapping_id: finalStatusMappingId,
                        tenant 
                    })
                    .orderBy('order_key', 'desc')
                    .first();
                beforeKey = lastTask?.order_key || null;
            }
            
            const newOrderKey = OrderingService.generateKeyForPosition(beforeKey, afterKey);

            const updateData: any = {
                phase_id: newPhaseId,
                wbs_code: newWbsCode,
                project_status_mapping_id: finalStatusMappingId,
                order_key: newOrderKey,
                // Preserve other important fields
                task_name: existingTask.task_name,
                description: existingTask.description,
                assigned_to: existingTask.assigned_to,
                estimated_hours: existingTask.estimated_hours,
                actual_hours: existingTask.actual_hours,
                due_date: existingTask.due_date,
                updated_at: trx.fn.now()
            };
            
            // If moving to different project, update project_id
            if (targetProjectId && targetProjectId !== currentPhase.project_id) {
                updateData.project_id = targetProjectId;
            }
            
            const [updatedTask] = await trx<IProjectTask>('project_tasks')
                .where('task_id', taskId)
                .andWhere('tenant', tenant!)
                .update(updateData)
                .returning('*');
            
            // Update all ticket links to point to new project and phase
            await trx('project_ticket_links')
                .where('task_id', taskId)
                .andWhere('tenant', tenant!)
                .update({
                    project_id: newPhase.project_id,
                    phase_id: newPhaseId
                });

            return updatedTask;
        });

        // Update all ticket links to point to new project and phase
        const ticketLinks = await ProjectTaskModel.getTaskTicketLinks(db, taskId);
        for (const link of ticketLinks) {
            await ProjectTaskModel.updateTaskTicketLink(db, link.link_id, {
                project_id: newPhase.project_id,
                phase_id: newPhaseId
            });
        }

        // If this is a cross-project move, update ticket links
        if (currentPhase.project_id !== newPhase.project_id) {
            const ticketLinks = await ProjectTaskModel.getTaskTicketLinks(db, taskId);
            for (const link of ticketLinks) {
                await ProjectTaskModel.updateTaskTicketLink(db, link.link_id, {
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

// New function starts here
export async function duplicateTaskToPhase(
    originalTaskId: string,
    newPhaseId: string,
    options?: {
        newStatusMappingId?: string;
        duplicatePrimaryAssignee?: boolean;
        duplicateAdditionalAssignees?: boolean;
        duplicateChecklist?: boolean;
        duplicateTicketLinks?: boolean;
    }
): Promise<IProjectTask> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser || !currentUser.tenant) {
            throw new Error("User or tenant context not found");
        }

        // Use 'create' permission as we are creating a new task entity
        await checkPermission(currentUser, 'project', 'create');

        const {knex: db} = await createTenantKnex();
        
        // 1. Fetch original task, new phase, and current phase
        const originalTask = await ProjectTaskModel.getTaskById(db, originalTaskId);
        if (!originalTask) {
            throw new Error('Original task not found');
        }

        const newPhase = await ProjectModel.getPhaseById(db, newPhaseId);
        if (!newPhase) {
            throw new Error('Target phase not found');
        }

        const currentPhase = await ProjectModel.getPhaseById(db, originalTask.phase_id);
        if (!currentPhase) {
            throw new Error('Current phase of original task not found');
        }

        // 2. Determine finalStatusMappingId (reuse logic from moveTaskToPhase)
        let finalStatusMappingId = options?.newStatusMappingId || originalTask.project_status_mapping_id;

        // If moving to a different project and no specific status mapping is provided
        if (currentPhase.project_id !== newPhase.project_id && !options?.newStatusMappingId) {
            const currentMapping = await ProjectModel.getProjectStatusMapping(db, originalTask.project_status_mapping_id);
            if (!currentMapping) {
                // Fallback if current mapping is somehow invalid, use the first available in target project
                console.warn(`Current status mapping ${originalTask.project_status_mapping_id} not found for task ${originalTaskId}. Falling back.`);
                const newProjectMappings = await ProjectModel.getProjectStatusMappings(db, newPhase.project_id);
                 if (!newProjectMappings || newProjectMappings.length === 0) {
                     // Handle case where target project has no mappings (should ideally not happen if defaults exist)
                     // Attempt to create default mappings (similar logic as in moveTaskToPhase)
                     const standardStatuses = await ProjectModel.getStandardStatusesByType(db, 'project_task');
                     for (const status of standardStatuses) {
                         await ProjectModel.addProjectStatusMapping(db, newPhase.project_id, {
                             standard_status_id: status.standard_status_id,
                             is_standard: true,
                             custom_name: null,
                             display_order: status.display_order,
                             is_visible: true,
                         });
                     }
                     const updatedMappings = await ProjectModel.getProjectStatusMappings(db, newPhase.project_id);
                     if (!updatedMappings || updatedMappings.length === 0) {
                         throw new Error('Failed to find or create status mappings for target project');
                     }
                     finalStatusMappingId = updatedMappings[0].project_status_mapping_id; // Use the first created one
                 } else {
                    finalStatusMappingId = newProjectMappings[0].project_status_mapping_id; // Use first available
                 }
            } else {
                const newProjectMappings = await ProjectModel.getProjectStatusMappings(db, newPhase.project_id);
                if (!newProjectMappings || newProjectMappings.length === 0) {
                     // Attempt to create default mappings
                     const standardStatuses = await ProjectModel.getStandardStatusesByType(db, 'project_task');
                     for (const status of standardStatuses) {
                         await ProjectModel.addProjectStatusMapping(db, newPhase.project_id, {
                             standard_status_id: status.standard_status_id,
                             is_standard: true,
                             custom_name: null,
                             display_order: status.display_order,
                             is_visible: true,
                         });
                     }
                     const updatedMappings = await ProjectModel.getProjectStatusMappings(db, newPhase.project_id);
                     if (!updatedMappings || updatedMappings.length === 0) {
                         throw new Error('Failed to find or create status mappings for target project');
                     }
                     finalStatusMappingId = updatedMappings[0].project_status_mapping_id;
                } else {
                    let equivalentMapping: IProjectStatusMapping | undefined;

                    if (currentMapping.is_standard && currentMapping.standard_status_id) {
                        equivalentMapping = newProjectMappings.find(m =>
                            m.is_standard && m.standard_status_id === currentMapping.standard_status_id
                        );
                    } else if (currentMapping.status_id) {
                        const currentStatus = await ProjectModel.getCustomStatus(db, currentMapping.status_id);
                        if (currentStatus) {
                            equivalentMapping = newProjectMappings.find(m =>
                                !m.is_standard && m.custom_name === currentMapping.custom_name
                            );
                        }
                    }

                    if (!equivalentMapping) {
                        equivalentMapping = newProjectMappings[0]; // Fallback to first available
                    }
                    finalStatusMappingId = equivalentMapping.project_status_mapping_id;
                }
            }
        } else if (currentPhase.project_id === newPhase.project_id && !options?.newStatusMappingId) {
             // If staying in the same project and no status provided, keep the original task's status mapping ID
             finalStatusMappingId = originalTask.project_status_mapping_id;
        }
        // If options.newStatusMappingId is provided, it's already set as finalStatusMappingId

        // 3. Get order key for end of target status
        const {tenant} = await createTenantKnex();
        
        const lastTask = await db('project_tasks')
            .where({ 
                phase_id: newPhaseId, 
                project_status_mapping_id: finalStatusMappingId,
                tenant 
            })
            .orderBy('order_key', 'desc')
            .first();
            
        const orderKey = OrderingService.generateKeyForPosition(
            lastTask?.order_key || null,
            null
        );

        // 4. Prepare new task data
        const newTaskData: Omit<IProjectTask, 'task_id' | 'phase_id' | 'wbs_code' | 'created_at' | 'updated_at' | 'tenant'> = {
            task_name: originalTask.task_name + ' (Copy)', // Add (Copy) suffix
            description: originalTask.description,
            due_date: originalTask.due_date,
            estimated_hours: originalTask.estimated_hours,
            actual_hours: 0, // Reset actual hours for the new task
            assigned_to: options?.duplicatePrimaryAssignee ? originalTask.assigned_to : null,
            project_status_mapping_id: finalStatusMappingId,
            order_key: orderKey,
            // Fields omitted: task_id, phase_id, wbs_code, created_at, updated_at, tenant (handled by model)
        };

        // 5. Create the new task
        const newTask = await ProjectTaskModel.addTask(db, newPhaseId, newTaskData);

        // 5. Optionally duplicate related data
        // Duplicate Checklist Items
        if (options?.duplicateChecklist) {
            const originalChecklistItems = await ProjectTaskModel.getChecklistItems(db, originalTaskId);
            for (const item of originalChecklistItems) {
                // Omit IDs, task_id, timestamps, tenant
                const newItemData = omit(item, ['checklist_item_id', 'task_id', 'created_at', 'updated_at', 'tenant']);
                await ProjectTaskModel.addChecklistItem(db, newTask.task_id, newItemData);
            }
        }

        // Duplicate Additional Assignees (Task Resources)
        if (options?.duplicateAdditionalAssignees) {
            const originalResources = await ProjectTaskModel.getTaskResources(db, originalTaskId);
            for (const resource of originalResources) {
                // addTaskResource expects taskId, userId, role
                await ProjectTaskModel.addTaskResource(db, newTask.task_id, resource.additional_user_id, resource.role || undefined);
            }
        }

        // Duplicate Ticket Links
        if (options?.duplicateTicketLinks) {
            const originalTicketLinks = await ProjectTaskModel.getTaskTicketLinks(db, originalTaskId);
            for (const link of originalTicketLinks) {
                // addTaskTicketLink expects projectId, taskId, ticketId, phaseId
                await ProjectTaskModel.addTaskTicketLink(db, newPhase.project_id, newTask.task_id, link.ticket_id, newPhaseId);
            }
        }

        // Publish event if task was assigned
        if (newTask.assigned_to) {
             await publishEvent({
                 eventType: 'PROJECT_TASK_ASSIGNED',
                 payload: {
                     tenantId: currentUser.tenant,
                     projectId: newPhase.project_id,
                     taskId: newTask.task_id,
                     userId: currentUser.user_id, // User performing the action
                     assignedTo: newTask.assigned_to,
                     additionalUsers: [], // Additional users handled separately if duplicated
                     timestamp: new Date().toISOString()
                 }
             });
        }

        // 6. Return the newly created task object
        // Fetch again to potentially include relations if needed, though addTask returns the core task
        const finalNewTask = await ProjectTaskModel.getTaskById(db, newTask.task_id);
        if (!finalNewTask) {
            throw new Error("Failed to retrieve the newly created task after duplication.");
        }
        return finalNewTask;

    } catch (error) {
        console.error('Error duplicating task to new phase:', error);
        // Consider more specific error handling or re-throwing
        if (error instanceof Error) {
            throw new Error(`Failed to duplicate task: ${error.message}`);
        }
        throw new Error('An unknown error occurred while duplicating the task.');
    }
}

export async function getTaskWithDetails(taskId: string, user: IUser) {
    try {
        await checkPermission(user, 'project', 'read');
        
        const {knex: db, tenant} = await createTenantKnex();
        if (!tenant) {
            throw new Error("tenant context not found");
        }
        
        // Example of proper tenant handling in JOINs:
        // Each JOIN includes an andOn clause to match tenants across tables,
        // ensuring data isolation between tenants even in complex queries
        const task = await db('project_tasks')
            .where('project_tasks.task_id', taskId)
            .andWhere('project_tasks.tenant', tenant!)
            .leftJoin('project_phases', function() { // Changed to leftJoin
                this.on('project_tasks.phase_id', '=', 'project_phases.phase_id')
                    .andOn('project_tasks.tenant', '=', 'project_phases.tenant');
            })
            .leftJoin('project_status_mappings', function() { // Changed to leftJoin
                this.on('project_tasks.project_status_mapping_id', '=', 'project_status_mappings.project_status_mapping_id')
                    .andOn('project_tasks.tenant', '=', 'project_status_mappings.tenant');
            })
            .leftJoin('users as assigned_user', function() {
                this.on('project_tasks.assigned_to', '=', 'assigned_user.user_id')
                    .andOn('project_tasks.tenant', '=', 'assigned_user.tenant');
            })
            .select(
                'project_tasks.*',
                'project_phases.phase_name',
                'project_phases.project_id',
                'project_status_mappings.status_id',
                'assigned_user.first_name as assigned_to_first_name',
                'assigned_user.last_name as assigned_to_last_name'
            )
            .first();

        if (!task) {
            throw new Error('Task not found');
        }
        
        // Get additional data needed for TaskEdit
        const [checklistItems, ticketLinks, resources] = await Promise.all([
            ProjectTaskModel.getChecklistItems(db, taskId),
            ProjectTaskModel.getTaskTicketLinks(db, taskId),
            ProjectTaskModel.getTaskResources(db, taskId)
        ]);
        
        return {
            ...task,
            checklist_items: checklistItems,
            ticket_links: ticketLinks,
            resources: resources
        };
    } catch (error) {
        console.error('Error getting task with details:', error);
        throw error;
    }
}

export async function reorderTask(
    taskId: string,
    beforeTaskId?: string | null,
    afterTaskId?: string | null
): Promise<void> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error("user not found");
    }

    await checkPermission(currentUser, 'project', 'update');
    
    const {knex: db, tenant} = await createTenantKnex();
    
    await withTransaction(db, async (trx: Knex.Transaction) => {
        // Get the task being moved
        const task = await trx('project_tasks')
            .where({ task_id: taskId, tenant })
            .select('phase_id', 'project_status_mapping_id')
            .first();
            
        if (!task) {
            throw new Error('Task not found');
        }
        
        // Get order keys for positioning
        let beforeKey: string | null = null;
        let afterKey: string | null = null;
        
        if (beforeTaskId) {
            const beforeTask = await trx('project_tasks')
                .where({ task_id: beforeTaskId, tenant })
                .select('order_key')
                .first();
            beforeKey = beforeTask?.order_key || null;
        }
        
        if (afterTaskId) {
            const afterTask = await trx('project_tasks')
                .where({ task_id: afterTaskId, tenant })
                .select('order_key')
                .first();
            afterKey = afterTask?.order_key || null;
        }
        
        try {
            const newOrderKey = OrderingService.generateKeyForPosition(beforeKey, afterKey);
            
            await trx('project_tasks')
                .where({ task_id: taskId, tenant })
                .update({
                    order_key: newOrderKey,
                    updated_at: trx.fn.now()
                });
        } catch (error) {
            console.error('Error generating order key, attempting to fix order keys for status', error);
            
            // If order key generation fails, try to fix the order keys for this status
            const wasFixed = await validateAndFixOrderKeys(
                task.phase_id,
                task.project_status_mapping_id
            );
            
            if (wasFixed) {
                // Retry the reorder after fixing
                await reorderTask(taskId, beforeTaskId, afterTaskId);
            } else {
                throw error;
            }
        }
    });
}

// Keep the old function for backward compatibility but update it to use order_key
export async function reorderTasksInStatus(tasks: { taskId: string, newWbsCode: string }[]): Promise<void> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }

        await checkPermission(currentUser, 'project', 'update');

        const {knex: db, tenant} = await createTenantKnex();
        await withTransaction(db, async (trx: Knex.Transaction) => {
            const taskRecords = await trx('project_tasks')
                .whereIn('task_id', tasks.map((t): string => t.taskId))
                .andWhere('tenant', tenant!)
                .select('task_id', 'phase_id');

            if (taskRecords.length !== tasks.length) {
                throw new Error('Some tasks not found');
            }

            const phaseId = taskRecords[0].phase_id;
            if (!taskRecords.every(t => t.phase_id === phaseId)) {
                throw new Error('All tasks must be in the same phase');
            }

            await Promise.all(tasks.map(({taskId, newWbsCode}): Promise<number> =>
                trx('project_tasks')
                    .where('task_id', taskId)
                    .andWhere('tenant', tenant!)
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

export async function cleanupOrderKeysForStatus(
    phaseId: string,
    statusId: string
): Promise<{ success: boolean; message: string }> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error("user not found");
    }
    await checkPermission(currentUser, 'project', 'update');
    
    try {
        const wasFixed = await validateAndFixOrderKeys(phaseId, statusId);
        
        if (wasFixed) {
            return {
                success: true,
                message: 'Order keys were regenerated successfully'
            };
        } else {
            return {
                success: true,
                message: 'Order keys are already valid, no changes needed'
            };
        }
    } catch (error) {
        console.error('Error cleaning up order keys:', error);
        return {
            success: false,
            message: 'Failed to clean up order keys'
        };
    }
}
