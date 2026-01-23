'use server';

import { Knex } from 'knex';
import ProjectModel from '../models/project';
import ProjectTaskModel from '../models/projectTask';
import type {
  IClient,
  IProject,
  IProjectPhase,
  IProjectStatusMapping,
  IProjectTask,
  IProjectTicketLink,
  IProjectTicketLinkWithDetails,
  IStandardStatus,
  IStatus,
  ITaskChecklistItem,
  IUser,
  IUserWithRoles,
  ItemType,
  ProjectStatus,
} from '@alga-psa/types';
import { getAllUsers, findUserById } from '@alga-psa/users/actions/user-actions/userActions';
import { getCurrentUser } from '@alga-psa/auth/getCurrentUser';
import { hasPermission } from '@alga-psa/auth/rbac';
import { validateArray, validateData } from '@alga-psa/validation';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { z } from 'zod';
import { publishEvent, publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { createProjectSchema, updateProjectSchema, projectPhaseSchema } from '../schemas/project.schemas';
import { OrderingService } from '../lib/orderingService';
import { SharedNumberingService } from '@shared/services/numberingService';
import {
  buildProjectStatusChangedPayload,
  buildProjectUpdatedPayload,
} from '@shared/workflow/streams/domainEventBuilders/projectLifecycleEventBuilders';

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

const extendedCreateProjectSchema = createProjectSchema.extend({
  assigned_to: z.string().nullable().optional(),
  contact_name_id: z.string().nullable().optional(),
  budgeted_hours: z.number().nullable().optional()
}).transform((data) => ({
  ...data,
  assigned_to: data.assigned_to || null,
  contact_name_id: data.contact_name_id || null
}));

const extendedUpdateProjectSchema = updateProjectSchema.extend({
  assigned_to: z.string().nullable().optional(),
  contact_name_id: z.string().nullable().optional(),
  budgeted_hours: z.number().nullable().optional()
}).transform((data) => ({
  ...data,
  assigned_to: data.assigned_to || null,
  contact_name_id: data.contact_name_id || null
}));

async function checkPermission(user: IUser, resource: string, action: string, knexConnection?: Knex | Knex.Transaction): Promise<void> {
    const hasPermissionResult = await hasPermission(user, resource, action, knexConnection);
    if (!hasPermissionResult) {
        throw new Error(`Permission denied: Cannot ${action} ${resource}`);
    }
}

async function getContactFullNameByContactNameId(params: {
    knexOrTrx: Knex | Knex.Transaction;
    tenant: string;
    contactNameId: string;
}): Promise<string | null> {
    const row = await params.knexOrTrx('contacts')
        .where({ tenant: params.tenant, contact_name_id: params.contactNameId })
        .first<{ full_name: string }>('full_name');
    return row?.full_name ?? null;
}

export async function getAllClientsForProjects(): Promise<IClient[]> {
  const { knex: db, tenant } = await getTenantKnex();

  const clients = await withTransaction(db, async (trx: Knex.Transaction) => {
    return trx('clients').select('*').where('tenant', tenant).orderBy('client_name', 'asc');
  });

  return clients as IClient[];
}

export async function getProjects(): Promise<IProject[]> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }
        if (!currentUser.tenant) {
            throw new Error("tenant context not found");
        }
        const {knex, tenant} = await getTenantKnex(currentUser.tenant);
        
        const projects = await withTransaction(knex, async (trx: Knex.Transaction) => {
            await checkPermission(currentUser, 'project', 'read', trx);
            return await ProjectModel.getAll(trx, tenant, true);
        });
        
        // Fetch assigned user details for each project
        const projectsWithUsers = await Promise.all(projects.map(async (project): Promise<IProject> => {
            if (project.assigned_to) {
                const user = await findUserById(project.assigned_to);
                return {
                    ...project,
                    assigned_user: user || null
                };
            }
            return project;
        }));
        
        return projectsWithUsers;
    } catch (error) {
        console.error('Error fetching projects:', error);
        throw error;
    }
}

export async function getProjectPhase(phaseId: string): Promise<IProjectPhase | null> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error('No authenticated user found');
        }

        const {knex, tenant} = await getTenantKnex(currentUser.tenant);
        const phase = await withTransaction(knex, async (trx: Knex.Transaction) => {
            if (!await hasPermission(currentUser, 'project', 'read', trx)) {
                throw new Error('Permission denied: Cannot read project');
            }
            return await ProjectModel.getPhaseById(trx, tenant, phaseId);
        });
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

    const {knex, tenant} = await getTenantKnex(currentUser.tenant);
    
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      await checkPermission(currentUser, 'project', 'read', trx);
      const projects = projectId ? 
        [await ProjectModel.getById(trx, tenant, projectId)] : 
        await ProjectModel.getAll(trx, tenant, true);
      
      const validProjects = projects.filter((p): p is NonNullable<typeof p> => p !== null);
      
      if (validProjects.length === 0) {
        throw new Error('No projects found');
      }
      
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
          const [phases, statusMappings] = await Promise.all([
            ProjectModel.getPhases(trx, tenant, project.project_id),
            ProjectModel.getProjectStatusMappings(trx, tenant, project.project_id)
          ]);

          if (!statusMappings || statusMappings.length === 0) {
            const standardStatuses = await ProjectModel.getStandardStatusesByType(trx, tenant, 'project_task');
            await Promise.all(standardStatuses.map((status): Promise<IProjectStatusMapping> => 
              ProjectModel.addProjectStatusMapping(trx, tenant, project.project_id, {
                standard_status_id: status.standard_status_id,
                is_standard: true,
                custom_name: null,
                display_order: status.display_order,
                is_visible: true,
              })
            ));
          }

          const statuses = await getProjectTaskStatuses(project.project_id);

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

      const validTreeData = treeData
        .filter((data): data is NonNullable<typeof data> =>
          data !== null && 
          data.children && 
          data.children.length > 0
        );
      
      if (validTreeData.length === 0) {
        throw new Error('No projects available with valid phases');
      }
      
      return validTreeData;
    });
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

        // Skip validation in development mode since we're handling the types correctly
        const {knex, tenant} = await getTenantKnex();
        const updatedPhase = await withTransaction(knex, async (trx: Knex.Transaction) => {
            await checkPermission(currentUser, 'project', 'update', trx);
            return await ProjectModel.updatePhase(trx, tenant, phaseId, {
                ...phaseData,
                start_date: phaseData.start_date ? new Date(phaseData.start_date) : null,
                end_date: phaseData.end_date ? new Date(phaseData.end_date) : null
            });
        });
        
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

        const {knex, tenant} = await getTenantKnex();
        await withTransaction(knex, async (trx: Knex.Transaction) => {
            await checkPermission(currentUser, 'project', 'delete', trx);
            await ProjectModel.deletePhase(trx, tenant, phaseId);
        });
    } catch (error) {
        console.error('Error deleting project phase:', error);
        throw error;
    }
}

export async function addProjectPhase(phaseData: Omit<IProjectPhase, 'phase_id' | 'created_at' | 'updated_at' | 'tenant'>): Promise<IProjectPhase> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }

        const validatedData = validateData(projectPhaseSchema.omit({ 
            phase_id: true,
            created_at: true,
            updated_at: true,
            tenant: true
        }), phaseData);

        // Get the project first to get its WBS code
        const {knex, tenant} = await getTenantKnex();
        
        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            await checkPermission(currentUser, 'project', 'update', trx);
            const project = await ProjectModel.getById(trx, tenant, phaseData.project_id);
            if (!project) {
                throw new Error('Project not found');
            }

            const phases = await ProjectModel.getPhases(trx, tenant, phaseData.project_id);
            const nextOrderNumber = phases.length + 1;

            // Get next phase number
            const phaseNumbers = phases
                .map((phase):number => {
                    const parts = phase.wbs_code.split('.');
                    return parseInt(parts[parts.length - 1]);
                })
                .filter(num => !isNaN(num));

            const maxPhaseNumber = phaseNumbers.length > 0 ? Math.max(...phaseNumbers) : 0;
            const newWbsCode = `${project.wbs_code}.${maxPhaseNumber + 1}`;
            
            // Generate order key for the new phase
            const { generateKeyBetween } = await import('fractional-indexing');
            let orderKey: string;
            
            if (phases.length === 0) {
                // First phase
                orderKey = generateKeyBetween(null, null);
            } else {
                // Add after the last phase
                const sortedPhases = [...phases].sort((a, b) => {
                    if (a.order_key && b.order_key) {
                        return a.order_key < b.order_key ? -1 : a.order_key > b.order_key ? 1 : 0;
                    }
                    return 0;
                });
                const lastPhase = sortedPhases[sortedPhases.length - 1];
                orderKey = generateKeyBetween(lastPhase.order_key || null, null);
            }

            const phaseWithDefaults = {
                ...validatedData,
                order_number: nextOrderNumber,
                wbs_code: newWbsCode,
                order_key: orderKey,
            };

            return await ProjectModel.addPhase(trx, tenant, phaseWithDefaults as Omit<IProjectPhase, 'phase_id' | 'created_at' | 'updated_at' | 'tenant'>);
        });
    } catch (error) {
        console.error('Error adding project phase:', error);
        throw error;
    }
}

export async function reorderPhase(
    phaseId: string,
    beforePhaseId?: string | null,
    afterPhaseId?: string | null
): Promise<void> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error("user not found");
    }

    const {knex: db, tenant} = await getTenantKnex();
    
    await withTransaction(db, async (trx: Knex.Transaction) => {
        await checkPermission(currentUser, 'project', 'update', trx);
        // Get the phase being moved
        const phase = await trx('project_phases')
            .where({ phase_id: phaseId, tenant })
            .select('project_id')
            .first();
            
        if (!phase) {
            throw new Error('Phase not found');
        }
        
        // Get order keys for positioning
        let beforeKey: string | null = null;
        let afterKey: string | null = null;
        
        if (beforePhaseId) {
            const beforePhase = await trx('project_phases')
                .where({ phase_id: beforePhaseId, tenant })
                .select('order_key')
                .first();
            beforeKey = beforePhase?.order_key || null;
        }
        
        if (afterPhaseId) {
            const afterPhase = await trx('project_phases')
                .where({ phase_id: afterPhaseId, tenant })
                .select('order_key')
                .first();
            afterKey = afterPhase?.order_key || null;
        }
        
        try {
            // Use OrderingService for key generation
            const newOrderKey = OrderingService.generateKeyForPosition(beforeKey, afterKey);
            
            await trx('project_phases')
                .where({ phase_id: phaseId, tenant })
                .update({
                    order_key: newOrderKey,
                    updated_at: trx.fn.now()
                });
                
            console.log('Phase reordered successfully:', {
                phaseId,
                newOrderKey,
                beforeKey,
                afterKey
            });
        } catch (error) {
            console.error('Error generating order key for phase:', error);
            
            // Try to recover by regenerating all order keys for the project
            const { regenerateOrderKeysForPhases } = await import('./regenerateOrderKeys');
            await regenerateOrderKeysForPhases(phase.project_id);
            
            // Try again with fresh order keys
            const freshBeforePhase = beforePhaseId ? await trx('project_phases')
                .where({ phase_id: beforePhaseId, tenant })
                .select('order_key')
                .first() : null;
            const freshAfterPhase = afterPhaseId ? await trx('project_phases')
                .where({ phase_id: afterPhaseId, tenant })
                .select('order_key')
                .first() : null;
                
            const freshBeforeKey = freshBeforePhase?.order_key || null;
            const freshAfterKey = freshAfterPhase?.order_key || null;
            
            const newOrderKey = OrderingService.generateKeyForPosition(freshBeforeKey, freshAfterKey);
            
            await trx('project_phases')
                .where({ phase_id: phaseId, tenant })
                .update({
                    order_key: newOrderKey,
                    updated_at: trx.fn.now()
                });
                
            console.log('Phase reordered successfully after recovery:', {
                phaseId,
                newOrderKey
            });
        }
    });
}

export async function getProject(projectId: string): Promise<IProject | null> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }
        const {knex, tenant} = await getTenantKnex();
        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            await checkPermission(currentUser, 'project', 'read', trx);
            return await ProjectModel.getById(trx, tenant, projectId);
        });
    } catch (error) {
        console.error('Error fetching project:', error);
        throw error;
    }
}

async function getStandardProjectTaskStatuses(): Promise<IStandardStatus[]> {
    try {
        const {knex, tenant} = await getTenantKnex();
        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            return await ProjectModel.getStandardStatusesByType(trx, tenant, 'project_task');
        });
    } catch (error) {
        console.error('Error fetching standard project task statuses:', error);
        throw new Error('Failed to fetch standard project task statuses');
    }
}

export async function getProjectStatuses(): Promise<IStatus[]> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error('No authenticated user found');
    }

    const {knex, tenant} = await getTenantKnex();
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
        if (!await hasPermission(currentUser, 'project', 'read', trx)) {
            throw new Error('Permission denied: Cannot read project');
        }
        return await ProjectModel.getStatusesByType(trx, tenant, 'project');
    });
  } catch (error) {
    console.error('Error fetching project statuses:', error);
    throw new Error('Failed to fetch project statuses');
  }
}

export async function generateNextWbsCode(): Promise<string> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error('No authenticated user found');
        }

        const {knex, tenant} = await getTenantKnex();
        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            if (!await hasPermission(currentUser, 'project', 'read', trx)) {
                throw new Error('Permission denied: Cannot read project');
            }
            return await ProjectModel.generateNextWbsCode(trx, tenant, '');
        });
    } catch (error) {
        console.error('Error generating WBS code:', error);
        throw error;
    }
}

export async function createProject(
  projectData: Omit<IProject, 'project_id' | 'created_at' | 'updated_at' | 'wbs_code' | 'project_number'> & {
    assigned_to?: string | null;
    contact_name_id?: string | null;
  },
  selectedTaskStatusIds?: string[],
  options?: {
    /** Optional transaction to use - if provided, the project will be created within this transaction */
    trx?: Knex.Transaction;
    /** If true, skip publishing events (useful when called within another action's transaction) */
    skipEvents?: boolean;
  }
): Promise<IProject> {
    try {
        // Get project statuses first
        const projectStatuses = await getProjectStatuses();

        if (projectStatuses.length === 0) {
            throw new Error('No project statuses found');
        }

        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }
        if (!currentUser.tenant) {
            throw new Error("tenant context not found");
        }

        const {knex, tenant} = await getTenantKnex();
        const externalTrx = options?.trx;

        // Try to get both standard statuses and regular statuses for backward compatibility
        const getStatuses = async (trx: Knex.Transaction) => {
            const standardStatuses = await ProjectModel.getStandardStatusesByType(trx, tenant, 'project_task').catch(() => []);
            const regularStatuses = await ProjectModel.getStatusesByType(trx, tenant, 'project_task').catch(() => []);
            return [standardStatuses, regularStatuses] as const;
        };

        const [standardTaskStatuses, projectTaskStatuses] = externalTrx
            ? await getStatuses(externalTrx)
            : await withTransaction(knex, getStatuses);

        // Prefer regular statuses (new system with colors/icons) over standard statuses (old system)
        const taskStatusesToUse = projectTaskStatuses.length > 0 ? projectTaskStatuses : standardTaskStatuses;

        console.log(`[createProject] Found ${projectTaskStatuses.length} custom statuses and ${standardTaskStatuses.length} standard statuses`);
        console.log(`[createProject] Using ${taskStatusesToUse.length} statuses, isStandard: ${projectTaskStatuses.length === 0}`);
        console.log(`[createProject] selectedTaskStatusIds:`, selectedTaskStatusIds);

        if (taskStatusesToUse.length === 0) {
            throw new Error('No project task statuses found. Please ensure task statuses are configured.');
        }

        const validatedData = validateData(createProjectSchema, projectData);

        // Helper function for the actual project creation logic
        const createProjectInTransaction = async (trx: Knex.Transaction) => {
            await checkPermission(currentUser, 'project', 'create', trx);

            // Generate project number
            const projectNumber = await SharedNumberingService.getNextNumber(
                'PROJECT',
                { knex: trx, tenant: currentUser.tenant! }
            );
            console.log(`[createProject] Generated project number: ${projectNumber}`);

            const wbsCode = await ProjectModel.generateNextWbsCode(trx, tenant, '');
            const defaultStatus = projectStatuses[0];
            // Remove tenant field if present in validatedData
            const { tenant: _, ...safeValidatedData } = validatedData;
            const projectDataWithStatus = {
                ...safeValidatedData,
                status: defaultStatus.status_id,
                status_name: defaultStatus.name,
                is_closed: defaultStatus.is_closed,
                assigned_to: safeValidatedData.assigned_to || null,
                contact_name_id: safeValidatedData.contact_name_id || null,
                wbs_code: wbsCode,
                project_number: projectNumber
            };
            console.log('Project data with status:', projectDataWithStatus); // Debug log

            // Add debug logging before database insert
            console.log('Creating project with data:', projectDataWithStatus);

            const newProject = await ProjectModel.create(trx, tenant, {
                ...projectDataWithStatus,
                assigned_to: validatedData.assigned_to || null,
                contact_name_id: validatedData.contact_name_id || null
            } as Omit<IProject, 'project_id' | 'created_at' | 'updated_at' | 'tenant'>);

            // Create project status mappings - handle both standard and regular statuses
            const isUsingStandardStatuses = projectTaskStatuses.length === 0;

            console.log(`[createProject] isUsingStandardStatuses: ${isUsingStandardStatuses}`);

            // Filter and order statuses based on selection (if provided)
            let statusesToCreate: Array<IStandardStatus | IStatus>;

            if (selectedTaskStatusIds && selectedTaskStatusIds.length > 0) {
                // Create ordered list based on selectedTaskStatusIds array order
                statusesToCreate = selectedTaskStatusIds
                    .map(statusId => {
                        return taskStatusesToUse.find(status => {
                            const id = isUsingStandardStatuses
                                ? (status as IStandardStatus).standard_status_id
                                : (status as IStatus).status_id;
                            return id === statusId;
                        });
                    })
                    .filter((status): status is IStandardStatus | IStatus => status !== undefined);
            } else {
                // If no selection, use all statuses (backward compatibility)
                statusesToCreate = taskStatusesToUse;
            }

            console.log(`[createProject] Creating ${statusesToCreate.length} status mappings`);

            // Create mappings in the specified order
            for (let i = 0; i < statusesToCreate.length; i++) {
                const status = statusesToCreate[i];
                const displayOrder = i + 1; // Use index for display_order to maintain user's chosen order

                if (isUsingStandardStatuses) {
                    // Using standard_statuses table (backward compatibility)
                    await ProjectModel.addProjectStatusMapping(trx, tenant, newProject.project_id, {
                        standard_status_id: (status as IStandardStatus).standard_status_id,
                        is_standard: true,
                        custom_name: null,
                        display_order: displayOrder,
                        is_visible: true,
                    });
                } else {
                    // Using regular statuses table (new approach)
                    await ProjectModel.addProjectStatusMapping(trx, tenant, newProject.project_id, {
                        status_id: (status as IStatus).status_id,
                        is_standard: false,
                        custom_name: null, // Name comes from join with statuses table
                        display_order: displayOrder,
                        is_visible: true,
                    });
                }
            }

            // Fetch the full project details including contact and assigned user
            const project = await ProjectModel.getById(trx, tenant, newProject.project_id);
            if (!project) {
                throw new Error('Failed to fetch created project details');
            }
            return project;
        };

        // Execute using external transaction if provided, otherwise create a new one
        const fullProject = externalTrx
            ? await createProjectInTransaction(externalTrx)
            : await withTransaction(knex, createProjectInTransaction);

        // Only publish events if not using an external transaction (or explicitly requested)
        if (!options?.skipEvents) {
            // Ensure tenant exists before publishing event
            if (!currentUser.tenant) {
                throw new Error("tenant context required for event publishing");
            }

            // Publish project created event
            await publishEvent({
                eventType: 'PROJECT_CREATED',
                payload: {
                    tenantId: currentUser.tenant,
                    projectId: fullProject.project_id,
                    userId: currentUser.user_id,
                    timestamp: new Date().toISOString()
                }
            });
        }

        return fullProject;
    } catch (error) {
        console.error('Error creating project:', error);
        throw error;
    }
}

export async function updateProject(projectId: string, projectData: Partial<IProject>): Promise<IProject> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }

        if (!currentUser.tenant) {
            throw new Error("tenant context not found");
        }

        // Remove tenant field if present in projectData
        const { tenant: tenantField, ...safeProjectData } = projectData;
        const validatedData = validateData(updateProjectSchema, safeProjectData);
        
        const {knex, tenant} = await getTenantKnex();
        
        const { beforeProject, updatedProject } = await withTransaction(knex, async (trx: Knex.Transaction) => {
            await checkPermission(currentUser, 'project', 'update', trx);
            const beforeProject = await ProjectModel.getById(trx, tenant, projectId);
            if (!beforeProject) {
                throw new Error(`Project ${projectId} not found`);
            }
            let project = await ProjectModel.update(trx, tenant, projectId, validatedData);

            // If status was updated, fetch the status details
            if ('status' in safeProjectData && safeProjectData.status) {
                const status = await ProjectModel.getCustomStatus(trx, tenant, safeProjectData.status);
                if (status) {
                    project = await ProjectModel.update(trx, tenant, projectId, {
                        ...project,
                        status_name: status.name,
                        is_closed: status.is_closed
                    });
                }
            }
            return { beforeProject, updatedProject: project };
        });

        // If assigned_to was updated, fetch the full user details and publish event
        if ('assigned_to' in projectData && projectData.assigned_to !== updatedProject.assigned_to) {
            if (updatedProject.assigned_to) {
                const user = await findUserById(updatedProject.assigned_to);
                updatedProject.assigned_user = user || null;

                // Ensure tenant exists before publishing event
                if (!currentUser.tenant) {
                    throw new Error("tenant context required for event publishing");
                }

                // Publish project assigned event only if assigned_to actually changed
                await publishEvent({
                    eventType: 'PROJECT_ASSIGNED',
                    payload: {
                        tenantId: currentUser.tenant,
                        projectId: projectId,
                        userId: currentUser.user_id,
                        assignedTo: updatedProject.assigned_to,
                        timestamp: new Date().toISOString()
                    }
                });
            } else {
                updatedProject.assigned_user = null;
            }
        }

        // If contact_name_id was updated, fetch the full contact details
        if ('contact_name_id' in projectData) {
            if (updatedProject.contact_name_id) {
                const fullName = await getContactFullNameByContactNameId({
                    knexOrTrx: knex,
                    tenant,
                    contactNameId: updatedProject.contact_name_id,
                });
                updatedProject.contact_name = fullName;
            } else {
                updatedProject.contact_name = null;
            }
        }

        // Ensure tenant exists before publishing event
        if (!currentUser.tenant) {
            throw new Error("tenant context required for event publishing");
        }

        const occurredAt = updatedProject.updated_at instanceof Date ? updatedProject.updated_at : new Date();
        const ctx = {
            tenantId: currentUser.tenant,
            occurredAt,
            actor: { actorType: 'USER' as const, actorUserId: currentUser.user_id },
        };

        if ('status' in validatedData && beforeProject.status !== updatedProject.status) {
            await publishWorkflowEvent({
                eventType: 'PROJECT_STATUS_CHANGED',
                ctx,
                payload: buildProjectStatusChangedPayload({
                    projectId,
                    previousStatus: beforeProject.status,
                    newStatus: updatedProject.status,
                    changedAt: occurredAt,
                }),
            });
        }

        await publishWorkflowEvent({
            eventType: 'PROJECT_UPDATED',
            ctx,
            payload: buildProjectUpdatedPayload({
                projectId,
                before: beforeProject as unknown as Record<string, unknown> & { project_id: string },
                after: updatedProject as unknown as Record<string, unknown> & { project_id: string },
                updatedFieldKeys: Object.keys(validatedData),
                updatedAt: occurredAt,
            }),
        });

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

        const {knex, tenant} = await getTenantKnex();
        await withTransaction(knex, async (trx: Knex.Transaction) => {
            await checkPermission(currentUser, 'project', 'delete', trx);
            await ProjectModel.delete(trx, tenant, projectId);
        });
    } catch (error) {
        console.error('Error deleting project:', error);
        throw error;
    }
}

export async function getProjectMetadata(projectId: string): Promise<{
    project: IProject;
    phases: IProjectPhase[];
    statuses: ProjectStatus[];
    users: IUserWithRoles[];
    contact?: { full_name: string };
    assignedUser: IUserWithRoles | null;
    clients: IClient[];
}> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }
        const {knex, tenant} = await getTenantKnex();
        
        // Fetch data that doesn't need to be in a transaction
        const [statuses, users, clients] = await Promise.all([
            getProjectTaskStatuses(projectId),
            getAllUsers(),
            getAllClientsForProjects()
        ]);
        
        // Fetch project-specific data within a transaction
        const projectData = await withTransaction(knex, async (trx: Knex.Transaction) => {
            await checkPermission(currentUser, 'project', 'read', trx);
            const [project, phases] = await Promise.all([
                ProjectModel.getById(trx, tenant, projectId),
                ProjectModel.getPhases(trx, tenant, projectId)
            ]);
            
            return { project, phases };
        });
        
        const { project, phases } = projectData;
        if (!project) {
            throw new Error('Project not found');
        }
        
        // Fetch assigned user details if assigned_to exists
        let assignedUser: IUserWithRoles | null = null;
        if (project.assigned_to) {
            const user = await findUserById(project.assigned_to);
            assignedUser = user || null;
        }
        
        // Fetch contact details if needed
        let contact: { full_name: string } | undefined;
        if (project.contact_name_id) {
            const contactData = await withTransaction(knex, async (trx: Knex.Transaction) => {
                return await trx('contacts')
                    .where({ contact_name_id: project.contact_name_id })
                    .select('full_name')
                    .first();
            });
            contact = contactData;
        }
        
        return {
            project,
            phases,
            statuses,
            users,
            contact,
            assignedUser,
            clients
        };
    } catch (error) {
        console.error('Error getting project metadata:', error);
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
    contact?: { full_name: string };
    assignedUser: IUserWithRoles | null;
    clients: IClient[];
}> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }

        const {knex, tenant} = await getTenantKnex();
        
        // Fetch data that doesn't need to be in a transaction
        const [statuses, users, clients] = await Promise.all([
            getProjectTaskStatuses(projectId),
            getAllUsers(),
            getAllClientsForProjects()
        ]);
        
        // Fetch project-specific data within a transaction
        const projectData = await withTransaction(knex, async (trx: Knex.Transaction) => {
            await checkPermission(currentUser, 'project', 'read', trx);
            const [project, phases, rawTasks, checklistItemsMap, ticketLinksMap, taskResourcesMap] = await Promise.all([
                ProjectModel.getById(trx, tenant, projectId),
                ProjectModel.getPhases(trx, tenant, projectId),
                ProjectTaskModel.getTasks(trx, tenant, projectId),
                ProjectTaskModel.getAllTaskChecklistItems(trx, tenant, projectId),
                ProjectTaskModel.getAllTaskTicketLinks(trx, tenant, projectId),
                ProjectTaskModel.getAllTaskResources(trx, tenant, projectId)
            ]);
            
            return { project, phases, rawTasks, checklistItemsMap, ticketLinksMap, taskResourcesMap };
        });
        
        const { project, phases, rawTasks, checklistItemsMap, ticketLinksMap, taskResourcesMap } = projectData;

        if (!project) {
            throw new Error('Project not found');
        }

        // Fetch assigned user details if assigned_to exists
        if (project.assigned_to) {
            const user = await findUserById(project.assigned_to);
            project.assigned_user = user || null;
        }

        const tasks = rawTasks.map((task): IProjectTask & {
            checklist_items: ITaskChecklistItem[],
            resources: any[]
        } => ({
            ...task,
            checklist_items: checklistItemsMap[task.task_id] || [],
            resources: taskResourcesMap[task.task_id] || []
        }));

        const ticketLinks = Object.values(ticketLinksMap).flat();

        const contact = project.contact_name ? {
            full_name: project.contact_name
        } : undefined;

        return { 
            project, 
            phases, 
            tasks, 
            ticketLinks, 
            statuses, 
            users,
            contact,
            assignedUser: project.assigned_user || null,
            clients
        };
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

        const {knex, tenant} = await getTenantKnex();
        await withTransaction(knex, async (trx: Knex.Transaction) => {
            await checkPermission(currentUser, 'project', 'update', trx);
            await ProjectModel.updateStructure(trx, tenant, projectId, updates);
        });
    } catch (error) {
        console.error('Error updating project structure:', error);
        throw error;
    }
}

export async function getProjectTaskStatuses(projectId: string): Promise<ProjectStatus[]> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error('No authenticated user found');
        }

        const {knex, tenant} = await getTenantKnex();
        
        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            if (!await hasPermission(currentUser, 'project', 'read', trx)) {
                throw new Error('Permission denied: Cannot read project');
            }
            const statusMappings = await ProjectModel.getProjectStatusMappings(trx, tenant, projectId);
            if (!statusMappings || statusMappings.length === 0) {
                console.warn(`No status mappings found for project ${projectId}`);
                return [];
            }

            const statuses = await Promise.all(statusMappings.map(async (mapping: IProjectStatusMapping): Promise<ProjectStatus | null> => {
                try {
                    if (mapping.is_standard && mapping.standard_status_id) {
                        const standardStatus = await ProjectModel.getStandardStatus(trx, tenant, mapping.standard_status_id);
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
                        const customStatus = await ProjectModel.getCustomStatus(trx, tenant, mapping.status_id);
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
                            is_closed: customStatus.is_closed,
                            color: customStatus.color,
                            icon: customStatus.icon
                        } as ProjectStatus;
                    }
                console.warn(`Invalid status mapping ${mapping.project_status_mapping_id}: missing both standard_status_id and status_id`);
                return null;
            } catch (error) {
                console.error(`Error processing status mapping ${mapping.project_status_mapping_id}:`, error);
                return null;
            }
        }));

            const validStatuses = statuses.filter((status): status is ProjectStatus => status !== null);
            
            if (validStatuses.length === 0) {
                console.warn(`No valid statuses found for project ${projectId}`);
                return [];
            }

            return validStatuses;
        });
    } catch (error) {
        console.error('Error fetching project statuses:', error);
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

        const {knex, tenant} = await getTenantKnex();
        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            await checkPermission(currentUser, 'project', 'update', trx);
            return await ProjectModel.addStatusToProject(trx, tenant, projectId, statusData);
        });
    } catch (error) {
        console.error('Error adding status to task:', error);
        throw error;
    }
}

export async function updateProjectStatus(
    projectId: string,
    statusId: string,
    statusData: Partial<IStatus>,
    mappingData: Partial<IProjectStatusMapping>
): Promise<IStatus> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error("user not found");
        }

        const {knex, tenant} = await getTenantKnex();
        const updatedStatus = await withTransaction(knex, async (trx: Knex.Transaction) => {
            await checkPermission(currentUser, 'project', 'update', trx);
            return await ProjectModel.updateProjectStatus(trx, tenant, statusId, statusData, mappingData);
        });

        // If the status is closed, publish project closed event
        if (statusData.is_closed) {
            await publishEvent({
                eventType: 'PROJECT_CLOSED',
                payload: {
                    tenantId: currentUser.tenant,
                    projectId: projectId,
                    userId: currentUser.user_id,
                    changes: statusData
                }
            });
        }

        return updatedStatus;
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

        const {knex, tenant} = await getTenantKnex();
        await withTransaction(knex, async (trx: Knex.Transaction) => {
            await checkPermission(currentUser, 'project', 'delete', trx);
            await ProjectModel.deleteProjectStatus(trx, tenant, statusId);
        });
    } catch (error) {
        console.error('Error deleting project status:', error);
        throw new Error('Failed to delete project status');
    }
}
