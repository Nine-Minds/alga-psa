import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import type { IProjectTask } from '@alga-psa/types';
import type { Knex } from 'knex';

import ProjectModel from '../models/project';
import ProjectTaskModel from '../models/projectTask';

import {
  registerAction,
  type InboundActionDefinition,
  type InboundActionResult,
} from '@alga-psa/shared/inboundWebhooks/actions/registry';
import { lookupAlgaEntityByExternalId, writeEntityMapping } from '@alga-psa/shared/inboundWebhooks/externalEntityMappings';

interface CreateProjectTaskMappedValues extends Record<string, unknown> {
  project_id?: string;
  project_external_id?: string;
  phase_id?: string;
  project_status_mapping_id?: string;
  task_name: string;
  description?: string;
  assigned_to?: string;
  estimated_hours?: number;
  due_date?: string;
  priority_id?: string;
  task_type_key?: string;
  service_id?: string;
  external_id?: string;
}

interface UpdateProjectTaskStatusByExternalIdMappedValues extends Record<string, unknown> {
  external_id: string;
  project_status_mapping_id: string;
}

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string,
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

class ExpectedInboundActionFailure extends Error {
  constructor(readonly result: InboundActionResult) {
    super(result.message ?? 'Inbound action failed');
  }
}

function inboundFailure(
  code: 'VALIDATION_ERROR' | 'LOOKUP_MISS',
  message: string,
  entityType: string,
  externalId?: string,
  metadata: Record<string, unknown> = {},
): InboundActionResult {
  return {
    success: false,
    entityType,
    externalId,
    message,
    metadata: { code, ...metadata },
  };
}

function throwInboundFailure(
  code: 'VALIDATION_ERROR' | 'LOOKUP_MISS',
  message: string,
  entityType: string,
  externalId?: string,
  metadata: Record<string, unknown> = {},
): never {
  throw new ExpectedInboundActionFailure(inboundFailure(code, message, entityType, externalId, metadata));
}

function toExpectedInboundActionResult(error: unknown): InboundActionResult | null {
  return error instanceof ExpectedInboundActionFailure ? error.result : null;
}

const createProjectTaskAction: InboundActionDefinition<CreateProjectTaskMappedValues> = {
  name: 'createProjectTask',
  entityType: 'project_task',
  displayName: 'Create Project Task',
  description: 'Create a project task under a direct or webhook-mapped project.',
  targetFields: [
    { name: 'project_id', type: 'ref', required: false, refEntityType: 'project', description: 'Project ID' },
    { name: 'project_external_id', type: 'string', required: false, description: 'External project ID to resolve' },
    { name: 'phase_id', type: 'ref', required: false, refEntityType: 'project_phase', description: 'Project phase ID' },
    {
      name: 'project_status_mapping_id',
      type: 'ref',
      required: false,
      refEntityType: 'project_status_mapping',
      description: 'Project task status mapping ID',
    },
    { name: 'task_name', type: 'string', required: true, description: 'Task name' },
    { name: 'description', type: 'string', required: false, description: 'Task description' },
    { name: 'assigned_to', type: 'ref', required: false, refEntityType: 'user', description: 'Assigned user ID' },
    { name: 'estimated_hours', type: 'number', required: false, description: 'Estimated effort' },
    { name: 'due_date', type: 'string', required: false, description: 'Due date' },
    { name: 'priority_id', type: 'ref', required: false, refEntityType: 'priority', description: 'Priority ID' },
    { name: 'task_type_key', type: 'string', required: false, description: 'Task type key' },
    { name: 'service_id', type: 'ref', required: false, refEntityType: 'service', description: 'Service ID' },
    { name: 'external_id', type: 'string', required: false, description: 'External task identifier to map' },
  ],
  async handle(ctx, mappedValues) {
    const { knex } = await createTenantKnex(ctx.tenant);
    let task;
    try {
      task = await withTransaction(knex, async (trx) => {
        const projectId = await resolveProjectId(trx, ctx.tenant, ctx.webhookSlug, mappedValues);
        const project = await tenantScopedTable(trx, 'projects', ctx.tenant)
          .where({ project_id: projectId })
          .first('project_id');
        if (!project) {
          throwInboundFailure(
            'VALIDATION_ERROR',
            `VALIDATION_ERROR: project_id "${projectId}" does not exist`,
            'project_task',
            mappedValues.external_id,
            { field: 'project_id' },
          );
        }

        const phaseId = await resolvePhaseId(trx, ctx.tenant, projectId, mappedValues.phase_id, mappedValues.external_id);
        const statusMappingId = await resolveStatusMappingId(
          trx,
          ctx.tenant,
          projectId,
          phaseId,
          mappedValues.project_status_mapping_id,
          mappedValues.external_id,
        );

        const created = await ProjectTaskModel.addTask(trx, ctx.tenant, phaseId, {
          task_name: mappedValues.task_name,
          description: mappedValues.description ?? null,
          assigned_to: mappedValues.assigned_to ?? null,
          estimated_hours: mappedValues.estimated_hours ?? null,
          actual_hours: null,
          due_date: mappedValues.due_date ? new Date(mappedValues.due_date) : null,
          project_status_mapping_id: statusMappingId,
          priority_id: mappedValues.priority_id ?? null,
          task_type_key: mappedValues.task_type_key ?? 'task',
          service_id: mappedValues.service_id ?? null,
        } as Omit<IProjectTask, 'task_id' | 'phase_id' | 'created_at' | 'updated_at' | 'tenant' | 'wbs_code'>);

        if (mappedValues.external_id) {
          await writeEntityMapping(ctx.tenant, ctx.webhookSlug, 'project_task', created.task_id, mappedValues.external_id, {
            knex: trx,
            metadata: { source: 'inbound_webhook', delivery_id: ctx.deliveryId },
          });
        }

        return created;
      });
    } catch (error) {
      const expectedResult = toExpectedInboundActionResult(error);
      if (expectedResult) {
        return expectedResult;
      }
      throw error;
    }

    return {
      success: true,
      entityType: 'project_task',
      entityId: task.task_id,
      externalId: mappedValues.external_id,
      metadata: {
        phase_id: task.phase_id,
        project_status_mapping_id: task.project_status_mapping_id,
      },
    };
  },
};

const updateProjectTaskStatusByExternalIdAction: InboundActionDefinition<UpdateProjectTaskStatusByExternalIdMappedValues> = {
  name: 'updateProjectTaskStatusByExternalId',
  entityType: 'project_task',
  displayName: 'Update Project Task Status by External ID',
  description: 'Update the status mapping for a webhook-mapped project task.',
  targetFields: [
    { name: 'external_id', type: 'string', required: true, description: 'External task identifier to resolve' },
    {
      name: 'project_status_mapping_id',
      type: 'ref',
      required: true,
      refEntityType: 'project_status_mapping',
      description: 'Target project task status mapping ID',
    },
  ],
  async handle(ctx, mappedValues) {
    const { knex } = await createTenantKnex(ctx.tenant);
    let updatedTask;
    try {
      updatedTask = await withTransaction(knex, async (trx) => {
        const lookup = await lookupAlgaEntityByExternalId(
          ctx.tenant,
          ctx.webhookSlug,
          'project_task',
          mappedValues.external_id,
          { knex: trx },
        );

        if (!lookup) {
          return null;
        }

        const taskQuery = tenantScopedTable(trx, 'project_tasks as pt', ctx.tenant);
        tenantDb(trx, ctx.tenant).tenantJoin(taskQuery, 'project_phases as pp', 'pt.phase_id', 'pp.phase_id');
        const task = await taskQuery
          .where({ 'pt.task_id': lookup.algaEntityId })
          .first<{
            task_id: string;
            phase_id: string;
            project_id: string;
          }>('pt.task_id', 'pt.phase_id', 'pp.project_id');

        if (!task) {
          return null;
        }

        await assertStatusMappingValidForTaskProject(
          trx,
          ctx.tenant,
          task.project_id,
          mappedValues.project_status_mapping_id,
          mappedValues.external_id,
        );

        return ProjectTaskModel.updateTaskStatus(
          trx,
          ctx.tenant,
          task.task_id,
          mappedValues.project_status_mapping_id,
        );
      });
    } catch (error) {
      const expectedResult = toExpectedInboundActionResult(error);
      if (expectedResult) {
        return expectedResult;
      }
      throw error;
    }

    if (!updatedTask) {
      return {
        success: false,
        entityType: 'project_task',
        externalId: mappedValues.external_id,
        message: `lookup_miss: project_task external_id "${mappedValues.external_id}" is not mapped for webhook "${ctx.webhookSlug}"`,
        metadata: { code: 'LOOKUP_MISS' },
      };
    }

    return {
      success: true,
      entityType: 'project_task',
      entityId: updatedTask.task_id,
      externalId: mappedValues.external_id,
      metadata: {
        project_status_mapping_id: updatedTask.project_status_mapping_id,
      },
    };
  },
};

registerAction(createProjectTaskAction);
registerAction(updateProjectTaskStatusByExternalIdAction);

export const projectInboundActions = [createProjectTaskAction, updateProjectTaskStatusByExternalIdAction];

async function resolveProjectId(
  trx: any,
  tenant: string,
  webhookSlug: string,
  mappedValues: CreateProjectTaskMappedValues,
): Promise<string> {
  if (mappedValues.project_id) {
    return mappedValues.project_id;
  }

  if (mappedValues.project_external_id) {
    const lookup = await lookupAlgaEntityByExternalId(
      tenant,
      webhookSlug,
      'project',
      mappedValues.project_external_id,
      { knex: trx },
    );
    if (lookup) {
      return lookup.algaEntityId;
    }
    throwInboundFailure(
      'LOOKUP_MISS',
      `lookup_miss: project external_id "${mappedValues.project_external_id}" is not mapped for webhook "${webhookSlug}"`,
      'project_task',
      mappedValues.external_id ?? mappedValues.project_external_id,
      { lookup_entity_type: 'project', lookup_external_id: mappedValues.project_external_id },
    );
  }

  throwInboundFailure(
    'VALIDATION_ERROR',
    'VALIDATION_ERROR: createProjectTask requires project_id or project_external_id',
    'project_task',
    mappedValues.external_id,
    { field: 'project_id' },
  );
}

async function resolvePhaseId(
  trx: any,
  tenant: string,
  projectId: string,
  phaseId?: string,
  externalId?: string,
): Promise<string> {
  if (phaseId) {
    const phase = await tenantScopedTable(trx, 'project_phases', tenant)
      .where({ project_id: projectId, phase_id: phaseId })
      .first('phase_id');
    if (!phase) {
      throwInboundFailure(
        'VALIDATION_ERROR',
        `VALIDATION_ERROR: phase_id "${phaseId}" does not belong to project "${projectId}"`,
        'project_task',
        externalId,
        { field: 'phase_id', project_id: projectId },
      );
    }
    return phase.phase_id;
  }

  const phases = await ProjectModel.getPhases(trx, tenant, projectId);
  const firstPhase = phases[0];
  if (!firstPhase) {
    throwInboundFailure(
      'VALIDATION_ERROR',
      `VALIDATION_ERROR: project "${projectId}" has no phases`,
      'project_task',
      externalId,
      { field: 'phase_id', project_id: projectId },
    );
  }
  return firstPhase.phase_id;
}

async function resolveStatusMappingId(
  trx: any,
  tenant: string,
  projectId: string,
  phaseId: string,
  statusMappingId?: string,
  externalId?: string,
): Promise<string> {
  if (statusMappingId) {
    const mapping = await tenantScopedTable(trx, 'project_status_mappings', tenant)
      .where({ project_status_mapping_id: statusMappingId })
      .where((builder: any) => {
        builder.where({ project_id: projectId }).orWhereNull('project_id');
      })
      .first('project_status_mapping_id');
    if (!mapping) {
      throwInboundFailure(
        'VALIDATION_ERROR',
        `VALIDATION_ERROR: project_status_mapping_id "${statusMappingId}" is not valid for project "${projectId}"`,
        'project_task',
        externalId,
        { field: 'project_status_mapping_id', project_id: projectId },
      );
    }
    return mapping.project_status_mapping_id;
  }

  const mappings = await ProjectModel.getEffectiveStatusMappings(trx, tenant, projectId, phaseId);
  const firstMapping = mappings[0];
  if (!firstMapping) {
    throwInboundFailure(
      'VALIDATION_ERROR',
      `VALIDATION_ERROR: project "${projectId}" has no task status mappings`,
      'project_task',
      externalId,
      { field: 'project_status_mapping_id', project_id: projectId },
    );
  }
  return firstMapping.project_status_mapping_id;
}

async function assertStatusMappingValidForTaskProject(
  trx: any,
  tenant: string,
  projectId: string,
  statusMappingId: string,
  externalId?: string,
): Promise<void> {
  const mapping = await tenantScopedTable(trx, 'project_status_mappings', tenant)
    .where({ project_status_mapping_id: statusMappingId })
    .where((builder: any) => {
      builder.where({ project_id: projectId }).orWhereNull('project_id');
    })
    .first('project_status_mapping_id');

  if (!mapping) {
    throwInboundFailure(
      'VALIDATION_ERROR',
      `VALIDATION_ERROR: project_status_mapping_id "${statusMappingId}" is not valid for project "${projectId}"`,
      'project_task',
      externalId,
      { field: 'project_status_mapping_id', project_id: projectId },
    );
  }
}
