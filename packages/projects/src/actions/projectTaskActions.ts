'use server';

import { Knex } from 'knex';
import ProjectTaskModel from '../models/projectTask';
import ProjectModel from '@alga-psa/projects/models/project';
import TaskTypeModel from '../models/taskType';
import TaskDependencyModel from '../models/taskDependency';
import { publishEvent, publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import type {
  DependencyType,
  ICustomTaskType,
  IProjectPhase,
  IProjectStatusMapping,
  IProjectTask,
  IProjectTaskDependency,
  IProjectTicketLink,
  IProjectTicketLinkWithDetails,
  ITag,
  ITaskChecklistItem,
  ITaskType,
  IUser,
  IUserWithRoles,
  ProjectStatus,
} from '@alga-psa/types';
import { findTagsByEntityIds } from '@alga-psa/tags/actions';
import { getCurrentUser } from '@alga-psa/auth/getCurrentUser';
import { hasPermission } from '@alga-psa/auth/rbac';
import { validateArray, validateData } from '@alga-psa/validation';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { omit } from 'lodash';
import { 
    createTaskSchema, 
    updateTaskSchema, 
    createChecklistItemSchema, 
    updateChecklistItemSchema
} from '../schemas/project.schemas';
import { OrderingService } from '../lib/orderingService';
import { validateAndFixOrderKeys } from './regenerateOrderKeys';
import {
  buildProjectTaskAssignedPayload,
  buildProjectTaskCompletedPayload,
  buildProjectTaskCreatedPayload,
  buildProjectTaskDependencyBlockedPayload,
  buildProjectTaskDependencyUnblockedPayload,
  buildProjectTaskStatusChangedPayload,
} from '@shared/workflow/streams/domainEventBuilders/projectTaskEventBuilders';

// Helper to get tenant with non-null assertion after validation
async function getTenantKnex(tenantId?: string | null): Promise<{ knex: Knex; tenant: string }> {
  let tenant = tenantId ?? null;
  if (!tenant) {
    const currentUser = await getCurrentUser();
    tenant = currentUser?.tenant ?? null;
  }

  const { knex, tenant: resolvedTenant } = await createTenantKnex(tenant);
  tenant = resolvedTenant;

  if (!tenant) {
    throw new Error('SYSTEM_ERROR: Tenant context not found');
  }

  return { knex, tenant };
}

async function resolveProjectStatusInfo(
  trx: Knex.Transaction,
  tenant: string,
  projectStatusMappingId: string
): Promise<{ status: string; isClosed: boolean }> {
  const row = await trx('project_status_mappings as psm')
    .leftJoin('statuses as s', function joinStatuses(this: Knex.JoinClause) {
      this.on('psm.status_id', '=', 's.status_id').andOn('psm.tenant', '=', 's.tenant');
    })
    .leftJoin('standard_statuses as ss', function joinStandardStatuses(this: Knex.JoinClause) {
      this.on('psm.standard_status_id', '=', 'ss.standard_status_id').andOn('psm.tenant', '=', 'ss.tenant');
    })
    .where({ 'psm.project_status_mapping_id': projectStatusMappingId, 'psm.tenant': tenant })
    .select(
      trx.raw(
        'COALESCE(psm.custom_name, s.name, ss.name, psm.project_status_mapping_id) as status_name'
      ),
      trx.raw('COALESCE(s.is_closed, ss.is_closed, false) as is_closed')
    )
    .first<{ status_name: string; is_closed: boolean }>();

  if (!row) {
    return { status: projectStatusMappingId, isClosed: false };
  }

  return { status: row.status_name, isClosed: Boolean(row.is_closed) };
}

function resolveTaskBlockRelation(params: {
  dependencyType: DependencyType;
  predecessorTaskId: string;
  successorTaskId: string;
}): { blockedTaskId: string; blockedByTaskId: string } | null {
  if (params.dependencyType === 'blocks') {
    return { blockedTaskId: params.successorTaskId, blockedByTaskId: params.predecessorTaskId };
  }
  if (params.dependencyType === 'blocked_by') {
    return { blockedTaskId: params.predecessorTaskId, blockedByTaskId: params.successorTaskId };
  }
  return null;
}

async function checkPermission(user: IUser, resource: string, action: string, knexConnection?: Knex | Knex.Transaction): Promise<void> {
    const hasPermissionResult = await hasPermission(user, resource, action, knexConnection);
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

        const {knex: db, tenant} = await getTenantKnex();
        
        return await withTransaction(db, async (trx: Knex.Transaction) => {
            await checkPermission(currentUser, 'project', 'update', trx);
            
            const existingTask = await ProjectTaskModel.getTaskById(trx, tenant, taskId);
            if (!existingTask) {
                throw new Error("Task not found");
            }

            // Remove tenant field if present in taskData
            const { checklist_items, tenant: _, ...taskUpdateData } = taskData;
            const validatedTaskData = validateData(updateTaskSchema, taskUpdateData);

            const updatedTask = await ProjectTaskModel.updateTask(trx, tenant, taskId, validatedTaskData as Partial<IProjectTask>);

            const phase = await ProjectModel.getPhaseById(trx, tenant, updatedTask.phase_id);
            if (phase) {
                if (!currentUser.tenant) {
                    throw new Error("tenant context required for event publishing");
                }

                const occurredAt = updatedTask.updated_at instanceof Date ? updatedTask.updated_at : new Date();
                const ctx = {
                    tenantId: currentUser.tenant,
                    occurredAt,
                    actor: { actorType: 'USER' as const, actorUserId: currentUser.user_id },
                };

                if ('assigned_to' in taskData && existingTask.assigned_to !== updatedTask.assigned_to && updatedTask.assigned_to) {
                    await publishWorkflowEvent({
                        eventType: 'PROJECT_TASK_ASSIGNED',
                        ctx,
                        payload: buildProjectTaskAssignedPayload({
                            projectId: phase.project_id,
                            taskId,
                            assignedToId: updatedTask.assigned_to,
                            assignedToType: 'user',
                            assignedByUserId: currentUser.user_id,
                            assignedAt: occurredAt,
                        }),
                    });
                }

                if (
                    'project_status_mapping_id' in taskData &&
                    existingTask.project_status_mapping_id !== updatedTask.project_status_mapping_id
                ) {
                    const [beforeStatus, afterStatus] = await Promise.all([
                        resolveProjectStatusInfo(trx, tenant, existingTask.project_status_mapping_id),
                        resolveProjectStatusInfo(trx, tenant, updatedTask.project_status_mapping_id),
                    ]);

                    await publishWorkflowEvent({
                        eventType: 'PROJECT_TASK_STATUS_CHANGED',
                        ctx,
                        payload: buildProjectTaskStatusChangedPayload({
                            projectId: phase.project_id,
                            taskId,
                            previousStatus: beforeStatus.status,
                            newStatus: afterStatus.status,
                            changedAt: occurredAt,
                        }),
                    });

                    if (!beforeStatus.isClosed && afterStatus.isClosed) {
                        await publishWorkflowEvent({
                            eventType: 'PROJECT_TASK_COMPLETED',
                            ctx,
                            payload: buildProjectTaskCompletedPayload({
                                projectId: phase.project_id,
                                taskId,
                                completedByUserId: currentUser.user_id,
                                completedAt: occurredAt,
                            }),
                        });
                    }
                }
            }

            if (checklist_items) {
                await ProjectTaskModel.deleteChecklistItems(trx, tenant, taskId);
                
                for (const item of checklist_items) {
                    await ProjectTaskModel.addChecklistItem(trx, tenant, taskId, item);
                }
            }
            
            const finalTask = await ProjectTaskModel.getTaskById(trx, tenant, taskId);
            if (!finalTask) {
                throw new Error('Task not found after update');
            }
            return finalTask;
        });
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

        const {knex: db, tenant} = await getTenantKnex();
        
        return await withTransaction(db, async (trx: Knex.Transaction) => {
            await checkPermission(currentUser, 'project', 'update', trx);
            
            const newTask = await ProjectTaskModel.addTask(trx, tenant, phaseId, taskData);

            const phase = await ProjectModel.getPhaseById(trx, tenant, phaseId);
            if (phase) {
                const occurredAt = newTask.created_at instanceof Date ? newTask.created_at : new Date();
                const ctx = {
                    tenantId: currentUser.tenant,
                    occurredAt,
                    actor: { actorType: 'USER' as const, actorUserId: currentUser.user_id },
                };
                const statusInfo = await resolveProjectStatusInfo(trx, tenant, newTask.project_status_mapping_id);

                await publishWorkflowEvent({
                    eventType: 'PROJECT_TASK_CREATED',
                    ctx,
                    payload: buildProjectTaskCreatedPayload({
                        projectId: phase.project_id,
                        taskId: newTask.task_id,
                        title: newTask.task_name,
                        dueDate: newTask.due_date,
                        status: statusInfo.status,
                        createdByUserId: currentUser.user_id,
                        createdAt: occurredAt,
                    }),
                });

                if (newTask.assigned_to) {
                    await publishWorkflowEvent({
                        eventType: 'PROJECT_TASK_ASSIGNED',
                        ctx,
                        payload: buildProjectTaskAssignedPayload({
                            projectId: phase.project_id,
                            taskId: newTask.task_id,
                            assignedToId: newTask.assigned_to,
                            assignedToType: 'user',
                            assignedByUserId: currentUser.user_id,
                            assignedAt: occurredAt,
                        }),
                    });
                }
            }

            for (const item of checklistItems) {
                await ProjectTaskModel.addChecklistItem(trx, tenant, newTask.task_id, item);
            }

            const taskWithChecklist = await ProjectTaskModel.getTaskById(trx, tenant, newTask.task_id);
            return taskWithChecklist;
        });
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
    
    const {knex: db, tenant} = await getTenantKnex();
    
    return await withTransaction(db, async (trx: Knex.Transaction) => {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }

        await checkPermission(currentUser, 'project', 'update', trx);
        
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

            if (currentUser.tenant) {
                const phase = await ProjectModel.getPhaseById(trx, tenant, updatedTask.phase_id);
                if (phase) {
                    const occurredAt = updatedTask.updated_at instanceof Date ? updatedTask.updated_at : new Date();
                    const ctx = {
                        tenantId: currentUser.tenant,
                        occurredAt,
                        actor: { actorType: 'USER' as const, actorUserId: currentUser.user_id },
                    };
                    const [beforeStatus, afterStatus] = await Promise.all([
                        resolveProjectStatusInfo(trx, tenant, task.project_status_mapping_id),
                        resolveProjectStatusInfo(trx, tenant, updatedTask.project_status_mapping_id),
                    ]);

                    await publishWorkflowEvent({
                        eventType: 'PROJECT_TASK_STATUS_CHANGED',
                        ctx,
                        payload: buildProjectTaskStatusChangedPayload({
                            projectId: phase.project_id,
                            taskId,
                            previousStatus: beforeStatus.status,
                            newStatus: afterStatus.status,
                            changedAt: occurredAt,
                        }),
                    });

                    if (!beforeStatus.isClosed && afterStatus.isClosed) {
                        await publishWorkflowEvent({
                            eventType: 'PROJECT_TASK_COMPLETED',
                            ctx,
                            payload: buildProjectTaskCompletedPayload({
                                projectId: phase.project_id,
                                taskId,
                                completedByUserId: currentUser.user_id,
                                completedAt: occurredAt,
                            }),
                        });
                    }
                }
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

        const validatedData = validateData(createChecklistItemSchema, itemData);
        
        const {knex: db, tenant} = await getTenantKnex();
        return await withTransaction(db, async (trx: Knex.Transaction) => {
            await checkPermission(currentUser, 'project', 'update', trx);
            return await ProjectTaskModel.addChecklistItem(trx, tenant, taskId, validatedData as Omit<ITaskChecklistItem, 'checklist_item_id' | 'task_id' | 'created_at' | 'updated_at' | 'tenant'>);
        });
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

        const validatedData = validateData(updateChecklistItemSchema, itemData);
        
        const {knex: db, tenant} = await getTenantKnex();
        return await withTransaction(db, async (trx: Knex.Transaction) => {
            await checkPermission(currentUser, 'project', 'update', trx);
            return await ProjectTaskModel.updateChecklistItem(trx, tenant, checklistItemId, validatedData);
        });
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

        const {knex: db, tenant} = await getTenantKnex();
        await withTransaction(db, async (trx: Knex.Transaction) => {
            await checkPermission(currentUser, 'project', 'delete', trx);
            await ProjectTaskModel.deleteChecklistItem(trx, tenant, checklistItemId);
        });
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

        const {knex: db, tenant} = await getTenantKnex();
        return await withTransaction(db, async (trx: Knex.Transaction) => {
            await checkPermission(currentUser, 'project', 'read', trx);
            return await ProjectTaskModel.getChecklistItems(trx, tenant, taskId);
        });
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

        const {knex: db, tenant} = await getTenantKnex();
        
        await withTransaction(db, async (trx: Knex.Transaction) => {
            await checkPermission(currentUser, 'project', 'delete', trx);
            
            // Check for associated time entries before proceeding
            const timeEntryCount = await trx('time_entries')
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

            const ticketLinks = await ProjectTaskModel.getTaskTicketLinks(trx, tenant, taskId);
            
            for (const link of ticketLinks) {
                await ProjectTaskModel.deleteTaskTicketLink(trx, tenant, link.link_id);
            }

            await ProjectTaskModel.deleteChecklistItems(trx, tenant, taskId);

            await ProjectTaskModel.deleteTask(trx, tenant, taskId);
        });
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

        const {knex: db, tenant} = await getTenantKnex();
        return await withTransaction(db, async (trx: Knex.Transaction) => {
            await checkPermission(currentUser, 'project', 'update', trx);
            return await ProjectTaskModel.addTaskTicketLink(trx, tenant, projectId, taskId, ticketId, phaseId);
        });
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

        const {knex: db, tenant} = await getTenantKnex();
        return await withTransaction(db, async (trx: Knex.Transaction) => {
            await checkPermission(currentUser, 'project', 'read', trx);
            return await ProjectTaskModel.getTaskTicketLinks(trx, tenant, taskId);
        });
    } catch (error) {
        console.error('Error getting task ticket links:', error);
        throw error;
    }
}

export async function getTasksForPhase(phaseId: string): Promise<{
    tasks: IProjectTask[];
    ticketLinks: { [taskId: string]: IProjectTicketLinkWithDetails[] };
    taskResources: { [taskId: string]: any[] };
    taskDependencies: { [taskId: string]: { predecessors: IProjectTaskDependency[]; successors: IProjectTaskDependency[] } };
}> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }
        const {knex: db, tenant} = await getTenantKnex();
        return await withTransaction(db, async (trx: Knex.Transaction) => {
            await checkPermission(currentUser, 'project', 'read', trx);

            // Get phase to get its WBS code
            const phase = await trx('project_phases')
                .where({ phase_id: phaseId })
                .first();

            if (!phase) {
                throw new Error('Phase not found');
            }

            // Get all tasks for this phase
            const tasks = await ProjectTaskModel.getTasksByPhase(trx, tenant, phaseId);

            // Get all related data in parallel
            const taskIds = tasks.map(t => t.task_id);
            const [ticketLinksArray, taskResourcesArray, predecessorsArray, successorsArray] = await Promise.all([
                taskIds.length > 0 ? ProjectTaskModel.getTaskTicketLinksForTasks(trx, tenant, taskIds) : [],
                taskIds.length > 0 ? ProjectTaskModel.getTaskResourcesForTasks(trx, tenant, taskIds) : [],
                // Fetch dependencies where task is the successor (predecessors of task)
                taskIds.length > 0
                    ? trx('project_task_dependencies as ptd')
                        .whereIn('ptd.successor_task_id', taskIds)
                        .andWhere('ptd.tenant', tenant)
                        .leftJoin('project_tasks as pt', function() {
                            this.on('ptd.predecessor_task_id', '=', 'pt.task_id')
                                .andOn('ptd.tenant', '=', 'pt.tenant');
                        })
                        .select('ptd.*', 'pt.task_name as predecessor_task_name', 'pt.wbs_code as predecessor_wbs_code', 'pt.task_type_key as predecessor_task_type_key')
                    : [],
                // Fetch dependencies where task is the predecessor (successors of task)
                taskIds.length > 0
                    ? trx('project_task_dependencies as ptd')
                        .whereIn('ptd.predecessor_task_id', taskIds)
                        .andWhere('ptd.tenant', tenant)
                        .leftJoin('project_tasks as pt', function() {
                            this.on('ptd.successor_task_id', '=', 'pt.task_id')
                                .andOn('ptd.tenant', '=', 'pt.tenant');
                        })
                        .select('ptd.*', 'pt.task_name as successor_task_name', 'pt.wbs_code as successor_wbs_code', 'pt.task_type_key as successor_task_type_key')
                    : []
            ]);

            // Convert arrays to maps
            const ticketLinks: { [taskId: string]: IProjectTicketLinkWithDetails[] } = {};
            const taskResources: { [taskId: string]: any[] } = {};
            const taskDependencies: { [taskId: string]: { predecessors: IProjectTaskDependency[]; successors: IProjectTaskDependency[] } } = {};

            for (const link of ticketLinksArray) {
                if (link.task_id) {
                    if (!ticketLinks[link.task_id]) {
                        ticketLinks[link.task_id] = [];
                    }
                    ticketLinks[link.task_id].push(link);
                }
            }

            for (const resource of taskResourcesArray) {
                if (resource.task_id) {
                    if (!taskResources[resource.task_id]) {
                        taskResources[resource.task_id] = [];
                    }
                    taskResources[resource.task_id].push(resource);
                }
            }

            // Process predecessors (dependencies where task is the successor)
            for (const dep of predecessorsArray) {
                const taskId = dep.successor_task_id;
                if (!taskDependencies[taskId]) {
                    taskDependencies[taskId] = { predecessors: [], successors: [] };
                }
                taskDependencies[taskId].predecessors.push({
                    ...dep,
                    predecessor_task: {
                        task_id: dep.predecessor_task_id,
                        task_name: dep.predecessor_task_name,
                        wbs_code: dep.predecessor_wbs_code,
                        task_type_key: dep.predecessor_task_type_key
                    }
                });
            }

            // Process successors (dependencies where task is the predecessor)
            for (const dep of successorsArray) {
                const taskId = dep.predecessor_task_id;
                if (!taskDependencies[taskId]) {
                    taskDependencies[taskId] = { predecessors: [], successors: [] };
                }
                taskDependencies[taskId].successors.push({
                    ...dep,
                    successor_task: {
                        task_id: dep.successor_task_id,
                        task_name: dep.successor_task_name,
                        wbs_code: dep.successor_wbs_code,
                        task_type_key: dep.successor_task_type_key
                    }
                });
            }

            return { tasks, ticketLinks, taskResources, taskDependencies };
        });
    } catch (error) {
        console.error('Error getting tasks for phase:', error);
        throw error;
    }
}

export async function addTaskResourceAction(taskId: string, userId: string, role?: string): Promise<void> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }

        const {knex: db, tenant} = await getTenantKnex();
        await withTransaction(db, async (trx: Knex.Transaction) => {
            await checkPermission(currentUser, 'project', 'update', trx);
            await ProjectTaskModel.addTaskResource(trx, tenant, taskId, userId, role);

            // When adding additional resource, publish task additional agent assigned event
            const task = await ProjectTaskModel.getTaskById(trx, tenant, taskId);
            if (task) {
                const phase = await ProjectModel.getPhaseById(trx, tenant, task.phase_id);
                if (phase) {
                    const eventPayload = {
                        tenantId: currentUser.tenant,
                        projectId: phase.project_id,
                        taskId: taskId,
                        primaryAgentId: task.assigned_to,
                        additionalAgentId: userId,
                        assignedByUserId: currentUser.user_id
                    };
                    console.log('[projectTaskActions] Publishing PROJECT_TASK_ADDITIONAL_AGENT_ASSIGNED event:', JSON.stringify(eventPayload));
                    await publishEvent({
                        eventType: 'PROJECT_TASK_ADDITIONAL_AGENT_ASSIGNED',
                        payload: eventPayload
                    });
                }
            }
        });
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

        const {knex: db, tenant} = await getTenantKnex();
        await withTransaction(db, async (trx: Knex.Transaction) => {
            await checkPermission(currentUser, 'project', 'update', trx);
            await ProjectTaskModel.removeTaskResource(trx, tenant, assignmentId);
        });
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

        const {knex: db, tenant} = await getTenantKnex();
        return await withTransaction(db, async (trx: Knex.Transaction) => {
            await checkPermission(currentUser, 'project', 'read', trx);
            return await ProjectTaskModel.getTaskResources(trx, tenant, taskId);
        });
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

        const {knex: db, tenant} = await getTenantKnex();
        await withTransaction(db, async (trx: Knex.Transaction) => {
            await checkPermission(currentUser, 'project', 'update', trx);
            await ProjectTaskModel.deleteTaskTicketLink(trx, tenant, linkId);
        });
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

        const {knex: db, tenant} = await getTenantKnex();
        
        return await withTransaction(db, async (trx: Knex.Transaction) => {
            await checkPermission(currentUser, 'project', 'update', trx);
            
            // Get the existing task to preserve its data
            const existingTask = await ProjectTaskModel.getTaskById(trx, tenant, taskId);
            if (!existingTask) {
                throw new Error('Task not found');
            }

            // Get the new phase to access its project and WBS code
            const newPhase = await ProjectModel.getPhaseById(trx, tenant, newPhaseId);
            if (!newPhase) {
                throw new Error('Target phase not found');
            }

            // Get the current phase to check if this is a cross-project move
            const currentPhase = await ProjectModel.getPhaseById(trx, tenant, existingTask.phase_id);
            if (!currentPhase) {
                throw new Error('Current phase not found');
            }

            // Always use the provided status mapping ID if it exists
            let finalStatusMappingId = newStatusMappingId || existingTask.project_status_mapping_id;

            // If moving to a different project and no specific status mapping is provided
            if (currentPhase.project_id !== newPhase.project_id && !newStatusMappingId) {
                // Get current status mapping
                const currentMapping = await ProjectModel.getProjectStatusMapping(trx, tenant, existingTask.project_status_mapping_id);
                if (!currentMapping) {
                    throw new Error('Current status mapping not found');
                }

                // Get all status mappings for the new project
                const newProjectMappings = await ProjectModel.getProjectStatusMappings(trx, tenant, newPhase.project_id);
                
                // If no mappings exist in the target project, create default ones
                if (!newProjectMappings || newProjectMappings.length === 0) {
                    const standardStatuses = await ProjectModel.getStandardStatusesByType(trx, tenant, 'project_task');
                    for (const status of standardStatuses) {
                        await ProjectModel.addProjectStatusMapping(trx, tenant, newPhase.project_id, {
                            standard_status_id: status.standard_status_id,
                            is_standard: true,
                            custom_name: null,
                            display_order: status.display_order,
                            is_visible: true,
                        });
                    }
                    // Fetch the newly created mappings
                    const updatedMappings = await ProjectModel.getProjectStatusMappings(trx, tenant, newPhase.project_id);
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
                        const currentStatus = await ProjectModel.getCustomStatus(trx, tenant, currentMapping.status_id);
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
            const newWbsCode = await ProjectModel.generateNextWbsCode(trx, tenant, newPhase.wbs_code);

            // Get order key for new position
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

            // If this is a cross-project move, update ticket links
            if (currentPhase.project_id !== newPhase.project_id) {
                const ticketLinks = await ProjectTaskModel.getTaskTicketLinks(trx, tenant, taskId);
                for (const link of ticketLinks) {
                    await ProjectTaskModel.updateTaskTicketLink(trx, tenant, link.link_id, {
                        project_id: newPhase.project_id,
                        phase_id: newPhaseId
                    });
                }
            }

            return updatedTask;
        });
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

        const {knex: db, tenant} = await getTenantKnex();
        
        return await withTransaction(db, async (trx: Knex.Transaction) => {
            // Use 'create' permission as we are creating a new task entity
            await checkPermission(currentUser, 'project', 'create', trx);
            
            // 1. Fetch original task, new phase, and current phase
            const originalTask = await ProjectTaskModel.getTaskById(trx, tenant, originalTaskId);
            if (!originalTask) {
                throw new Error('Original task not found');
            }

            const newPhase = await ProjectModel.getPhaseById(trx, tenant, newPhaseId);
            if (!newPhase) {
                throw new Error('Target phase not found');
            }

            const currentPhase = await ProjectModel.getPhaseById(trx, tenant, originalTask.phase_id);
            if (!currentPhase) {
                throw new Error('Current phase of original task not found');
            }

            // 2. Determine finalStatusMappingId (reuse logic from moveTaskToPhase)
            let finalStatusMappingId = options?.newStatusMappingId || originalTask.project_status_mapping_id;

            // If moving to a different project and no specific status mapping is provided
            if (currentPhase.project_id !== newPhase.project_id && !options?.newStatusMappingId) {
                const currentMapping = await ProjectModel.getProjectStatusMapping(trx, tenant, originalTask.project_status_mapping_id);
                if (!currentMapping) {
                    // Fallback if current mapping is somehow invalid, use the first available in target project
                    console.warn(`Current status mapping ${originalTask.project_status_mapping_id} not found for task ${originalTaskId}. Falling back.`);
                    const newProjectMappings = await ProjectModel.getProjectStatusMappings(trx, tenant, newPhase.project_id);
                     if (!newProjectMappings || newProjectMappings.length === 0) {
                         // Handle case where target project has no mappings (should ideally not happen if defaults exist)
                         // Attempt to create default mappings (similar logic as in moveTaskToPhase)
                         const standardStatuses = await ProjectModel.getStandardStatusesByType(trx, tenant, 'project_task');
                         for (const status of standardStatuses) {
                             await ProjectModel.addProjectStatusMapping(trx, tenant, newPhase.project_id, {
                                 standard_status_id: status.standard_status_id,
                                 is_standard: true,
                                 custom_name: null,
                                 display_order: status.display_order,
                                 is_visible: true,
                             });
                         }
                         const updatedMappings = await ProjectModel.getProjectStatusMappings(trx, tenant, newPhase.project_id);
                         if (!updatedMappings || updatedMappings.length === 0) {
                             throw new Error('Failed to find or create status mappings for target project');
                         }
                         finalStatusMappingId = updatedMappings[0].project_status_mapping_id; // Use the first created one
                     } else {
                        finalStatusMappingId = newProjectMappings[0].project_status_mapping_id; // Use first available
                     }
                } else {
                    const newProjectMappings = await ProjectModel.getProjectStatusMappings(trx, tenant, newPhase.project_id);
                    if (!newProjectMappings || newProjectMappings.length === 0) {
                         // Attempt to create default mappings
                         const standardStatuses = await ProjectModel.getStandardStatusesByType(trx, tenant, 'project_task');
                         for (const status of standardStatuses) {
                             await ProjectModel.addProjectStatusMapping(trx, tenant, newPhase.project_id, {
                                 standard_status_id: status.standard_status_id,
                                 is_standard: true,
                                 custom_name: null,
                                 display_order: status.display_order,
                                 is_visible: true,
                             });
                         }
                         const updatedMappings = await ProjectModel.getProjectStatusMappings(trx, tenant, newPhase.project_id);
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
                            const currentStatus = await ProjectModel.getCustomStatus(trx, tenant, currentMapping.status_id);
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
            const lastTask = await trx('project_tasks')
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
                task_type_key: originalTask.task_type_key || 'task',
                // Fields omitted: task_id, phase_id, wbs_code, created_at, updated_at, tenant (handled by model)
            };

            // 5. Create the new task
            const newTask = await ProjectTaskModel.addTask(trx, tenant, newPhaseId, newTaskData);

            // 5. Optionally duplicate related data
            // Duplicate Checklist Items
            if (options?.duplicateChecklist) {
                const originalChecklistItems = await ProjectTaskModel.getChecklistItems(trx, tenant, originalTaskId);
                for (const item of originalChecklistItems) {
                    // Omit IDs, task_id, timestamps, tenant
                    const newItemData = omit(item, ['checklist_item_id', 'task_id', 'created_at', 'updated_at', 'tenant']);
                    await ProjectTaskModel.addChecklistItem(trx, tenant, newTask.task_id, newItemData);
                }
            }

            // Duplicate Additional Assignees (Task Resources)
            if (options?.duplicateAdditionalAssignees) {
                const originalResources = await ProjectTaskModel.getTaskResources(trx, tenant, originalTaskId);
                for (const resource of originalResources) {
                    // addTaskResource expects taskId, userId, role
                    await ProjectTaskModel.addTaskResource(trx, tenant, newTask.task_id, resource.additional_user_id, resource.role || undefined);
                }
            }

            // Duplicate Ticket Links
            if (options?.duplicateTicketLinks) {
                const originalTicketLinks = await ProjectTaskModel.getTaskTicketLinks(trx, tenant, originalTaskId);
                for (const link of originalTicketLinks) {
                    // addTaskTicketLink expects projectId, taskId, ticketId, phaseId
                    await ProjectTaskModel.addTaskTicketLink(trx, tenant, newPhase.project_id, newTask.task_id, link.ticket_id, newPhaseId);
                }
            }

            if (currentUser.tenant) {
                const occurredAt = newTask.created_at instanceof Date ? newTask.created_at : new Date();
                const ctx = {
                    tenantId: currentUser.tenant,
                    occurredAt,
                    actor: { actorType: 'USER' as const, actorUserId: currentUser.user_id },
                };
                const statusInfo = await resolveProjectStatusInfo(trx, tenant, newTask.project_status_mapping_id);

                await publishWorkflowEvent({
                    eventType: 'PROJECT_TASK_CREATED',
                    ctx,
                    payload: buildProjectTaskCreatedPayload({
                        projectId: newPhase.project_id,
                        taskId: newTask.task_id,
                        title: newTask.task_name,
                        dueDate: newTask.due_date,
                        status: statusInfo.status,
                        createdByUserId: currentUser.user_id,
                        createdAt: occurredAt,
                    }),
                });

                if (newTask.assigned_to) {
                    await publishWorkflowEvent({
                        eventType: 'PROJECT_TASK_ASSIGNED',
                        ctx,
                        payload: buildProjectTaskAssignedPayload({
                            projectId: newPhase.project_id,
                            taskId: newTask.task_id,
                            assignedToId: newTask.assigned_to,
                            assignedToType: 'user',
                            assignedByUserId: currentUser.user_id,
                            assignedAt: occurredAt,
                        }),
                    });
                }
            }

            // 6. Return the newly created task object
            // Fetch again to potentially include relations if needed, though addTask returns the core task
            const finalNewTask = await ProjectTaskModel.getTaskById(trx, tenant, newTask.task_id);
            if (!finalNewTask) {
                throw new Error("Failed to retrieve the newly created task after duplication.");
            }
            return finalNewTask;
        });
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
        const {knex: db, tenant} = await getTenantKnex();
        if (!tenant) {
            throw new Error("tenant context not found");
        }
        
        return await withTransaction(db, async (trx: Knex.Transaction) => {
            await checkPermission(user, 'project', 'read', trx);
            
            // Example of proper tenant handling in JOINs:
            // Each JOIN includes an andOn clause to match tenants across tables,
            // ensuring data isolation between tenants even in complex queries
            const task = await trx('project_tasks')
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
                ProjectTaskModel.getChecklistItems(trx, tenant, taskId),
                ProjectTaskModel.getTaskTicketLinks(trx, tenant, taskId),
                ProjectTaskModel.getTaskResources(trx, tenant, taskId)
            ]);
            
            return {
                ...task,
                checklist_items: checklistItems,
                ticket_links: ticketLinks,
                resources: resources
            };
        });
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

    const {knex: db, tenant} = await getTenantKnex();
    
    await withTransaction(db, async (trx: Knex.Transaction) => {
        await checkPermission(currentUser, 'project', 'update', trx);
        
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

        const {knex: db, tenant} = await getTenantKnex();
        await withTransaction(db, async (trx: Knex.Transaction) => {
            await checkPermission(currentUser, 'project', 'update', trx);
            
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
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }
        
        const {knex: db, tenant} = await getTenantKnex();
        
        const result = await withTransaction(db, async (trx: Knex.Transaction) => {
            await checkPermission(currentUser, 'project', 'update', trx);
            
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
        });
        
        return result;
    } catch (error) {
        console.error('Error cleaning up order keys:', error);
        return {
            success: false,
            message: 'Failed to clean up order keys'
        };
    }
}

// Task Type Actions
export async function getTaskTypes(): Promise<ITaskType[]> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error("user not found");
    }
    
    const {knex: db, tenant} = await getTenantKnex();
    await checkPermission(currentUser, 'project', 'read', db);
    
    return await TaskTypeModel.getAllTaskTypes(db, tenant);
}

export async function createCustomTaskType(
    data: Omit<ITaskType, 'type_id' | 'tenant' | 'created_at' | 'updated_at'>
): Promise<ITaskType> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error("user not found");
    }
    
    const {knex: db, tenant} = await getTenantKnex();
    await checkPermission(currentUser, 'project', 'create', db);
    
    return await TaskTypeModel.createCustomTaskType(
        db,
        tenant,
        data as Omit<ICustomTaskType, 'type_id' | 'tenant' | 'created_at' | 'updated_at'>
    );
}

// Task Dependency Actions
export async function addTaskDependency(
    predecessorTaskId: string,
    successorTaskId: string,
    dependencyType?: DependencyType,
    leadLagDays: number = 0,
    notes?: string
): Promise<IProjectTaskDependency> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error("user not found");
    }
    
    const { knex: db, tenant } = await getTenantKnex();
    
    return await withTransaction(db, async (trx) => {
        await checkPermission(currentUser, 'project', 'update', trx);
        
        // Handle 'blocked_by' by swapping the tasks and using 'blocks' instead
        let actualPredecessorId = predecessorTaskId;
        let actualSuccessorId = successorTaskId;
        let actualDependencyType = dependencyType;
        
        if (dependencyType === 'blocked_by') {
            // Swap the tasks: "A blocked_by B" becomes "B blocks A"
            actualPredecessorId = successorTaskId;
            actualSuccessorId = predecessorTaskId;
            actualDependencyType = 'blocks';
        }
        
        if (!actualDependencyType) {
            const [predecessor, successor] = await Promise.all([
                trx('project_tasks').where({ task_id: actualPredecessorId, tenant }).first(),
                trx('project_tasks').where({ task_id: actualSuccessorId, tenant }).first()
            ]);
            
            if (!predecessor || !successor) {
                throw new Error('One or both tasks not found');
            }
            
            actualDependencyType = TaskDependencyModel.suggestDependencyType(
                predecessor.task_type_key || 'task',
                successor.task_type_key || 'task'
            );
        }
        
        const dependency = await TaskDependencyModel.addDependency(
          trx,
          tenant,
          actualPredecessorId,
          actualSuccessorId,
          actualDependencyType,
          leadLagDays,
          notes
        );

        if (!currentUser.tenant) {
          throw new Error('tenant context required for event publishing');
        }

        const blockRelation = resolveTaskBlockRelation({
          dependencyType: actualDependencyType,
          predecessorTaskId: actualPredecessorId,
          successorTaskId: actualSuccessorId,
        });

        if (blockRelation) {
          const blockedTask = await ProjectTaskModel.getTaskById(trx, tenant, blockRelation.blockedTaskId);
          if (blockedTask) {
            const phase = await ProjectModel.getPhaseById(trx, tenant, blockedTask.phase_id);
            if (phase) {
              const occurredAt = dependency.created_at instanceof Date ? dependency.created_at : new Date();
              const ctx = {
                tenantId: currentUser.tenant,
                occurredAt,
                actor: { actorType: 'USER' as const, actorUserId: currentUser.user_id },
              };

              await publishWorkflowEvent({
                eventType: 'PROJECT_TASK_DEPENDENCY_BLOCKED',
                ctx,
                payload: buildProjectTaskDependencyBlockedPayload({
                  projectId: phase.project_id,
                  taskId: blockRelation.blockedTaskId,
                  blockedByTaskId: blockRelation.blockedByTaskId,
                  blockedAt: occurredAt,
                }),
              });
            }
          }
        }

        return dependency;
    });
}

export async function getTaskDependencies(taskId: string): Promise<{
    predecessors: IProjectTaskDependency[],
    successors: IProjectTaskDependency[]
}> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error("user not found");
    }
    
    const {knex: db, tenant} = await getTenantKnex();
    await checkPermission(currentUser, 'project', 'read', db);
    
    return await TaskDependencyModel.getTaskDependencies(db, tenant, taskId);
}

export async function removeTaskDependency(dependencyId: string): Promise<void> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error("user not found");
    }
    
    const { knex: db, tenant } = await getTenantKnex();

    await withTransaction(db, async (trx) => {
      await checkPermission(currentUser, 'project', 'update', trx);

      const dependency = await trx('project_task_dependencies')
        .where({ dependency_id: dependencyId, tenant })
        .first();

      if (!dependency) {
        throw new Error('Dependency not found');
      }

      await TaskDependencyModel.removeDependency(trx, tenant, dependencyId);

      if (!currentUser.tenant) {
        throw new Error('tenant context required for event publishing');
      }

      const blockRelation = resolveTaskBlockRelation({
        dependencyType: dependency.dependency_type,
        predecessorTaskId: dependency.predecessor_task_id,
        successorTaskId: dependency.successor_task_id,
      });

      if (!blockRelation) return;

      const blockedTask = await ProjectTaskModel.getTaskById(trx, tenant, blockRelation.blockedTaskId);
      if (!blockedTask) return;

      const phase = await ProjectModel.getPhaseById(trx, tenant, blockedTask.phase_id);
      if (!phase) return;

      const occurredAt = new Date();
      const ctx = {
        tenantId: currentUser.tenant,
        occurredAt,
        actor: { actorType: 'USER' as const, actorUserId: currentUser.user_id },
      };

      await publishWorkflowEvent({
        eventType: 'PROJECT_TASK_DEPENDENCY_UNBLOCKED',
        ctx,
        payload: buildProjectTaskDependencyUnblockedPayload({
          projectId: phase.project_id,
          taskId: blockRelation.blockedTaskId,
          unblockedByTaskId: blockRelation.blockedByTaskId,
          unblockedAt: occurredAt,
        }),
      });
    });
}

export async function updateTaskDependency(
    dependencyId: string,
    data: Partial<Pick<IProjectTaskDependency, 'lead_lag_days' | 'notes'>>
): Promise<IProjectTaskDependency> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error("user not found");
    }

    const {knex: db, tenant} = await getTenantKnex();
    await checkPermission(currentUser, 'project', 'update', db);

    return await TaskDependencyModel.updateDependency(db, tenant, dependencyId, data);
}

export async function getTaskById(taskId: string): Promise<IProjectTask | null> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }
        if (!currentUser.tenant) {
            throw new Error("tenant context not found");
        }

        const {knex: db, tenant} = await getTenantKnex();
        await checkPermission(currentUser, 'project', 'read', db);

        const task = await db('project_tasks')
            .where({
                'project_tasks.task_id': taskId,
                'project_tasks.tenant': currentUser.tenant
            })
            .first();

        return task || null;
    } catch (error) {
        console.error('Error fetching task by ID:', error);
        throw error;
    }
}

export async function getAllProjectTasksForListView(projectId: string): Promise<{
    phases: IProjectPhase[];
    tasks: IProjectTask[];
    statuses: ProjectStatus[];
    ticketLinks: Record<string, IProjectTicketLinkWithDetails[]>;
    taskResources: Record<string, any[]>;
    checklistItems: Record<string, ITaskChecklistItem[]>;
    taskTags: Record<string, ITag[]>;
    taskDependencies: Record<string, { predecessors: IProjectTaskDependency[]; successors: IProjectTaskDependency[] }>;
}> {
    const currentUser = await getCurrentUser();
    if (!currentUser) throw new Error("user not found");

    const { knex: db, tenant } = await getTenantKnex();

    return await withTransaction(db, async (trx: Knex.Transaction) => {
        await checkPermission(currentUser, 'project', 'read', trx);

        // 1. Get all phases for this project
        const phases = await trx('project_phases')
            .where({ project_id: projectId, tenant })
            .orderBy('order_key');

        const phaseIds = phases.map(p => p.phase_id);

        // 2. Get all tasks across all phases (base fields)
        const tasks = phaseIds.length > 0
            ? await trx('project_tasks')
                .whereIn('phase_id', phaseIds)
                .andWhere('tenant', tenant)
                .orderBy(['phase_id', 'order_key'])
            : [];

        const taskIds = tasks.map(t => t.task_id);

        // 3. Get statuses using getProjectTaskStatuses (NOT getProjectStatuses)
        const { getProjectTaskStatuses } = await import('./projectActions');
        const statuses = await getProjectTaskStatuses(projectId);

        // 4. Parallel fetch related data (including dependencies)
        const [ticketLinksArray, taskResourcesArray, checklistItemsArray, tagsArray, predecessorDeps, successorDeps] = await Promise.all([
            taskIds.length > 0
                ? ProjectTaskModel.getTaskTicketLinksForTasks(trx, tenant, taskIds)
                : [],
            taskIds.length > 0
                ? ProjectTaskModel.getTaskResourcesForTasks(trx, tenant, taskIds)
                : [],
            taskIds.length > 0
                ? trx('task_checklist_items')
                    .whereIn('task_id', taskIds)
                    .andWhere('tenant', tenant)
                    .orderBy('order_number')
                : [],
            taskIds.length > 0
                ? findTagsByEntityIds(taskIds, 'project_task').catch(() => [])
                : [],
            // Fetch dependencies where task is the successor (predecessors of task)
            taskIds.length > 0
                ? trx('project_task_dependencies as ptd')
                    .whereIn('ptd.successor_task_id', taskIds)
                    .andWhere('ptd.tenant', tenant)
                    .leftJoin('project_tasks as pt', function() {
                        this.on('ptd.predecessor_task_id', '=', 'pt.task_id')
                            .andOn('ptd.tenant', '=', 'pt.tenant');
                    })
                    .select('ptd.*', 'pt.task_name as predecessor_task_name', 'pt.wbs_code as predecessor_wbs_code')
                : [],
            // Fetch dependencies where task is the predecessor (successors of task)
            taskIds.length > 0
                ? trx('project_task_dependencies as ptd')
                    .whereIn('ptd.predecessor_task_id', taskIds)
                    .andWhere('ptd.tenant', tenant)
                    .leftJoin('project_tasks as pt', function() {
                        this.on('ptd.successor_task_id', '=', 'pt.task_id')
                            .andOn('ptd.tenant', '=', 'pt.tenant');
                    })
                    .select('ptd.*', 'pt.task_name as successor_task_name', 'pt.wbs_code as successor_wbs_code')
                : []
        ]);

        // 5. Convert arrays to maps keyed by task_id
        const ticketLinks: Record<string, IProjectTicketLinkWithDetails[]> = {};
        const taskResources: Record<string, any[]> = {};
        const checklistItems: Record<string, ITaskChecklistItem[]> = {};
        const taskTags: Record<string, ITag[]> = {};
        const taskDependencies: Record<string, { predecessors: IProjectTaskDependency[]; successors: IProjectTaskDependency[] }> = {};

        for (const link of ticketLinksArray) {
            if (link.task_id) {
                (ticketLinks[link.task_id] ??= []).push(link);
            }
        }
        for (const resource of taskResourcesArray) {
            if (resource.task_id) {
                (taskResources[resource.task_id] ??= []).push(resource);
            }
        }
        for (const item of checklistItemsArray) {
            (checklistItems[item.task_id] ??= []).push(item);
        }
        // Tags: findTagsByEntityIds returns ITag[] with tagged_id field
        for (const tag of tagsArray) {
            if (tag.tagged_id) {
                (taskTags[tag.tagged_id] ??= []).push(tag);
            }
        }

        // Process dependencies - group by task_id
        for (const dep of predecessorDeps) {
            const taskId = dep.successor_task_id;
            if (!taskDependencies[taskId]) {
                taskDependencies[taskId] = { predecessors: [], successors: [] };
            }
            taskDependencies[taskId].predecessors.push({
                ...dep,
                predecessor_task: {
                    task_id: dep.predecessor_task_id,
                    task_name: dep.predecessor_task_name,
                    wbs_code: dep.predecessor_wbs_code
                }
            });
        }
        for (const dep of successorDeps) {
            const taskId = dep.predecessor_task_id;
            if (!taskDependencies[taskId]) {
                taskDependencies[taskId] = { predecessors: [], successors: [] };
            }
            taskDependencies[taskId].successors.push({
                ...dep,
                successor_task: {
                    task_id: dep.successor_task_id,
                    task_name: dep.successor_task_name,
                    wbs_code: dep.successor_wbs_code
                }
            });
        }

        return { phases, tasks, statuses, ticketLinks, taskResources, checklistItems, taskTags, taskDependencies };
    });
}

/**
 * Get task counts per phase for a project (lightweight query for kanban sidebar)
 */
export async function getPhaseTaskCounts(projectId: string): Promise<Record<string, number>> {
    const currentUser = await getCurrentUser();
    if (!currentUser) throw new Error("user not found");

    const { knex: db, tenant } = await getTenantKnex();

    await checkPermission(currentUser, 'project', 'read', db);

    const counts = await db('project_tasks as pt')
        .join('project_phases as pp', function() {
            this.on('pt.phase_id', 'pp.phase_id').andOn('pt.tenant', 'pp.tenant');
        })
        .where({ 'pp.project_id': projectId, 'pt.tenant': tenant })
        .groupBy('pt.phase_id')
        .select('pt.phase_id')
        .count('pt.task_id as count');

    const result: Record<string, number> = {};
    for (const row of counts) {
        result[row.phase_id] = Number(row.count);
    }
    return result;
}
