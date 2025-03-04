'use server';

import { Knex } from 'knex';
import ProjectTaskModel from 'server/src/lib/models/projectTask';
import ProjectModel from 'server/src/lib/models/project';
import { publishEvent } from 'server/src/lib/eventBus/publishers';
import { IProjectTask, IProjectTicketLink, IProjectStatusMapping, ITaskChecklistItem, IProjectTicketLinkWithDetails } from 'server/src/interfaces/project.interfaces';
import { IUser, IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { validateData, validateArray } from 'server/src/lib/utils/validation';
import { createTenantKnex } from 'server/src/lib/db';
import { 
    createTaskSchema, 
    updateTaskSchema, 
    createChecklistItemSchema, 
    updateChecklistItemSchema
} from 'server/src/lib/schemas/project.schemas';

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

        const existingTask = await ProjectTaskModel.getTaskById(taskId);
        if (!existingTask) {
            throw new Error("Task not found");
        }

        // Remove tenant field if present in taskData
        const { checklist_items, tenant: _, ...taskUpdateData } = taskData;
        const validatedTaskData = validateData(updateTaskSchema, taskUpdateData);

        const updatedTask = await ProjectTaskModel.updateTask(taskId, validatedTaskData);

        // If assigned_to was updated, publish event
        if ('assigned_to' in taskData && updatedTask.assigned_to) {
            const phase = await ProjectModel.getPhaseById(updatedTask.phase_id);
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
            await ProjectTaskModel.deleteChecklistItems(taskId);
            
            for (const item of checklist_items) {
                await ProjectTaskModel.addChecklistItem(taskId, item);
            }
        }
        
        const finalTask = await ProjectTaskModel.getTaskById(taskId);
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

        const newTask = await ProjectTaskModel.addTask(phaseId, taskData);

        // If task is assigned to someone, publish event
        if (taskData.assigned_to) {
            const phase = await ProjectModel.getPhaseById(phaseId);
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
            await ProjectTaskModel.addChecklistItem(newTask.task_id, item);
        }

        const taskWithChecklist = await ProjectTaskModel.getTaskById(newTask.task_id);
        return taskWithChecklist;
    } catch (error) {
        console.error('Error adding task to phase:', error);
        throw error;
    }
}

export async function updateTaskStatus(
    taskId: string, 
    projectStatusMappingId: string,
    position?: number // Optional position to insert the task
): Promise<IProjectTask> {
    
    const {knex: db, tenant} = await createTenantKnex();
    
    return await db.transaction(async (trx: Knex.Transaction) => {
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

            // Get all tasks in the target status
            const targetStatusTasks = await trx<IProjectTask>('project_tasks')
                .where('project_status_mapping_id', projectStatusMappingId)
                .andWhere('phase_id', task.phase_id)
                .andWhere('tenant', tenant!)
                .orderBy('wbs_code');
            
        // Generate new WBS codes
        const parentWbs = task.wbs_code.split('.').slice(0, -1).join('.');
        const updates = [];

        if (targetStatusTasks.length === 0) {
            // If moving to empty status, just use .1
            updates.push({
                taskId: taskId,
                newWbsCode: `${parentWbs}.1`
            });
        } else if (typeof position === 'number' && position >= 0 && position <= targetStatusTasks.length) {
            // If position is specified, insert at that position and shift others
            const before = targetStatusTasks.slice(0, position);
            const after = targetStatusTasks.slice(position);

            // Update tasks before insertion point
            before.forEach((t, index) => {
                updates.push({
                    taskId: t.task_id,
                    newWbsCode: `${parentWbs}.${index + 1}`
                });
            });

            // Add moved task at specified position
            updates.push({
                taskId: taskId,
                newWbsCode: `${parentWbs}.${position + 1}`
            });

            // Update tasks after insertion point
            after.forEach((t, index) => {
                updates.push({
                    taskId: t.task_id,
                    newWbsCode: `${parentWbs}.${position + index + 2}`
                });
            });
        } else {
            // Default behavior - add to end
            targetStatusTasks.forEach((t, index) => {
                updates.push({
                    taskId: t.task_id,
                    newWbsCode: `${parentWbs}.${index + 1}`
                });
            });

            updates.push({
                taskId: taskId,
                newWbsCode: `${parentWbs}.${targetStatusTasks.length + 1}`
            });
        }

            // Update all tasks
            await Promise.all(updates.map(({taskId, newWbsCode}): Promise<number> =>
                trx('project_tasks')
                    .where('task_id', taskId)
                    .andWhere('tenant', tenant!)
                    .update({
                        wbs_code: newWbsCode,
                        project_status_mapping_id: projectStatusMappingId,
                        updated_at: trx.fn.now()
                    })
            ));

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
        
        return await ProjectTaskModel.addChecklistItem(taskId, validatedData);
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
        
        return await ProjectTaskModel.updateChecklistItem(checklistItemId, validatedData);
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
        await ProjectTaskModel.deleteChecklistItem(checklistItemId);
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
        return await ProjectTaskModel.getChecklistItems(taskId);
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

        const ticketLinks = await ProjectTaskModel.getTaskTicketLinks(taskId);
        
        for (const link of ticketLinks) {
            await ProjectTaskModel.deleteTaskTicketLink(link.link_id);
        }

        await ProjectTaskModel.deleteChecklistItems(taskId);

        await ProjectTaskModel.deleteTask(taskId);
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
        return await ProjectTaskModel.addTaskTicketLink(projectId, taskId, ticketId, phaseId);
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
        return await ProjectTaskModel.getTaskTicketLinks(taskId);
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
        await ProjectTaskModel.addTaskResource(taskId, userId, role);

        // When adding additional resource, publish task assigned event
        const task = await ProjectTaskModel.getTaskById(taskId);
        if (task) {
            const phase = await ProjectModel.getPhaseById(task.phase_id);
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
        await ProjectTaskModel.removeTaskResource(assignmentId);
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
        return await ProjectTaskModel.getTaskResources(taskId);
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
        await ProjectTaskModel.deleteTaskTicketLink(linkId);
    } catch (error) {
        console.error('Error deleting ticket link:', error);
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
        const existingTask = await ProjectTaskModel.getTaskById(taskId);
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
        const {knex: db, tenant} = await createTenantKnex();
        const updatedTask = await db.transaction(async (trx) => {
            const [updatedTask] = await trx<IProjectTask>('project_tasks')
                .where('task_id', taskId)
                .andWhere('tenant', tenant!)
                .update({
                    phase_id: newPhaseId,
                    wbs_code: newWbsCode,
                    project_status_mapping_id: finalStatusMappingId,
                    // Preserve other important fields
                    task_name: existingTask.task_name,
                    description: existingTask.description,
                    assigned_to: existingTask.assigned_to,
                    estimated_hours: existingTask.estimated_hours,
                    actual_hours: existingTask.actual_hours,
                    due_date: existingTask.due_date,
                    updated_at: db.fn.now()
                })
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
        const ticketLinks = await ProjectTaskModel.getTaskTicketLinks(taskId);
        for (const link of ticketLinks) {
            await ProjectTaskModel.updateTaskTicketLink(link.link_id, {
                project_id: newPhase.project_id,
                phase_id: newPhaseId
            });
        }

        // If this is a cross-project move, update ticket links
        if (currentPhase.project_id !== newPhase.project_id) {
            const ticketLinks = await ProjectTaskModel.getTaskTicketLinks(taskId);
            for (const link of ticketLinks) {
                await ProjectTaskModel.updateTaskTicketLink(link.link_id, {
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
            .join('project_phases', function() {
                this.on('project_tasks.phase_id', '=', 'project_phases.phase_id')
                    .andOn('project_tasks.tenant', '=', 'project_phases.tenant');
            })
            .join('project_status_mappings', function() {
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
            ProjectTaskModel.getChecklistItems(taskId),
            ProjectTaskModel.getTaskTicketLinks(taskId),
            ProjectTaskModel.getTaskResources(taskId)
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

export async function reorderTasksInStatus(tasks: { taskId: string, newWbsCode: string }[]): Promise<void> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }

        await checkPermission(currentUser, 'project', 'update');

        const {knex: db, tenant} = await createTenantKnex();
        await db.transaction(async (trx: Knex.Transaction) => {
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
