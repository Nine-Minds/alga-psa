'use server';

import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import type { WorkflowDefinition } from '@alga-psa/workflows/runtime';
import { getSchemaRegistry, emailWorkflowPayloadSchema } from '@alga-psa/workflows/runtime';
import {
  emptyWorkflowPayloadSchema,
  EMPTY_WORKFLOW_PAYLOAD_SCHEMA_REF
} from '@alga-psa/workflows/runtime';
import {
  workflowClockTriggerPayloadSchema,
  WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF
} from '@alga-psa/workflows/runtime';
import { workflowEventPayloadSchemas } from '@alga-psa/workflows/runtime';
import {
  WorkflowDefinitionModelV2,
  WorkflowDefinitionVersionModelV2,
  WorkflowScheduleStateModel,
  type WorkflowDefinitionVersionRecord,
  type WorkflowScheduleStateRecord
} from '@alga-psa/workflows/persistence';
import {
  createExternalWorkflowScheduleState,
  deleteWorkflowScheduleStateById,
  setExternalWorkflowScheduleEnabled,
  updateExternalWorkflowScheduleState,
  type DesiredWorkflowSchedule
} from '../lib/workflowScheduleLifecycle';
import {
  CreateWorkflowScheduleInput,
  DeleteWorkflowScheduleInput,
  GetWorkflowScheduleInput,
  ListWorkflowSchedulesInput,
  UpdateWorkflowScheduleInput,
  type CreateWorkflowScheduleInputShape,
  type UpdateWorkflowScheduleInputShape
} from './workflow-schedule-v2-schemas';

type WorkflowScheduleValidationFailure = {
  ok: false;
  code: string;
  message: string;
  issues?: unknown[];
};

type WorkflowScheduleMutationSuccess = {
  ok: true;
  schedule: WorkflowScheduleStateRecord;
};

let payloadSchemasInitialized = false;

const ensureWorkflowPayloadSchemasRegistered = (): void => {
  if (payloadSchemasInitialized) return;

  const schemaRegistry = getSchemaRegistry();
  const registrations: Array<[string, unknown]> = [
    [EMPTY_WORKFLOW_PAYLOAD_SCHEMA_REF, emptyWorkflowPayloadSchema],
    ['payload.EmailWorkflowPayload.v1', emailWorkflowPayloadSchema],
    [WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF, workflowClockTriggerPayloadSchema],
    ...Object.entries(workflowEventPayloadSchemas)
  ];

  for (const [ref, schema] of registrations) {
    if (!schemaRegistry.has(ref)) {
      schemaRegistry.register(ref, schema as never);
    }
  }

  payloadSchemasInitialized = true;
};

const isValidationFailure = <TSuccess>(
  value: TSuccess | WorkflowScheduleValidationFailure
): value is WorkflowScheduleValidationFailure => (
  typeof value === 'object' &&
  value !== null &&
  'ok' in value &&
  (value as { ok?: boolean }).ok === false
);

const throwHttpError = (status: number, message: string): never => {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  throw error;
};

const validateTimeTriggerTimezone = (timezone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
};

const validateFiveFieldCron = (cron: string): { ok: true; value: string } | { ok: false; message: string } => {
  const value = String(cron || '').trim();
  if (!value) {
    return { ok: false, message: 'Recurring schedules require a cron expression.' };
  }
  if (value.length > 128) {
    return { ok: false, message: 'Cron expression too long.' };
  }
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length !== 5) {
    return { ok: false, message: 'Recurring schedules require a 5-field cron expression.' };
  }
  for (const part of parts) {
    if (!/^[0-9*/,-]+$/.test(part)) {
      return { ok: false, message: 'Cron expression contains unsupported characters.' };
    }
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const domIsSet = dayOfMonth !== '*';
  const dowIsSet = dayOfWeek !== '*';
  if (domIsSet && dowIsSet) {
    return { ok: false, message: 'Cron cannot set both day-of-month and day-of-week.' };
  }
  const allOtherStars = hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*';
  if (allOtherStars && (minute === '*' || minute === '*/1' || minute === '*/2' || minute === '*/3' || minute === '*/4')) {
    return { ok: false, message: 'Cron too frequent (minimum interval is 5 minutes).' };
  }
  return { ok: true, value };
};

const requireWorkflowPermission = async (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user: any,
  action: 'read' | 'manage',
  knex: Awaited<ReturnType<typeof createTenantKnex>>['knex']
) => {
  const direct = await hasPermission(user, 'workflow', action, knex);
  if (direct) return;

  if (action === 'read') {
    const fallback = await Promise.all([
      hasPermission(user, 'workflow', 'view', knex),
      hasPermission(user, 'workflow', 'manage', knex),
      hasPermission(user, 'workflow', 'admin', knex)
    ]);
    if (fallback.some(Boolean)) return;
  }

  if (action === 'manage') {
    const adminAllowed = await hasPermission(user, 'workflow', 'admin', knex);
    if (adminAllowed) return;
  }

  throwHttpError(403, 'Forbidden');
};

const getLatestPublishedWorkflowVersion = async (
  knex: Awaited<ReturnType<typeof createTenantKnex>>['knex'],
  workflowId: string
): Promise<WorkflowDefinitionVersionRecord | null> => {
  const versions = await WorkflowDefinitionVersionModelV2.listByWorkflow(knex, workflowId);
  return versions[0] ?? null;
};

const mapStatusFilter = (
  status: 'all' | 'enabled' | 'paused' | 'failed' | 'completed' | 'disabled',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any
) => {
  if (status === 'all') return;
  if (status === 'enabled') {
    query.andWhere('tws.enabled', true);
    return;
  }
  query.andWhere('tws.status', status);
};

const toWorkflowScheduleValidationFailure = (
  code: string,
  message: string,
  issues?: unknown[]
): WorkflowScheduleValidationFailure => ({
  ok: false,
  code,
  message,
  ...(issues ? { issues } : {})
});

const buildDesiredScheduleFromInput = (
  input: CreateWorkflowScheduleInputShape | UpdateWorkflowScheduleInputShape
): DesiredWorkflowSchedule | WorkflowScheduleValidationFailure => {
  if (input.triggerType === 'schedule') {
    if (!input.runAt || !String(input.runAt).trim()) {
      return toWorkflowScheduleValidationFailure(
        'RUN_AT_REQUIRED',
        'One-time schedules require a runAt timestamp.'
      );
    }
    const runAt = new Date(input.runAt);
    if (Number.isNaN(runAt.getTime())) {
      return toWorkflowScheduleValidationFailure(
        'RUN_AT_INVALID',
        'One-time schedules require a valid ISO 8601 timestamp.'
      );
    }
    if (runAt.getTime() <= Date.now()) {
      return toWorkflowScheduleValidationFailure(
        'RUN_AT_IN_PAST',
        'One-time schedules must be scheduled in the future.'
      );
    }

    return {
      triggerType: 'schedule',
      workflowVersion: 0,
      runAt: runAt.toISOString(),
      enabled: input.enabled,
      status: input.enabled ? 'scheduled' : 'paused'
    };
  }

  const cron = validateFiveFieldCron(input.cron ?? '');
  if (!cron.ok) {
    const message = 'message' in cron ? cron.message : 'Recurring schedules require a valid cron expression.';
    return toWorkflowScheduleValidationFailure('CRON_INVALID', message);
  }
  if (!input.timezone || !validateTimeTriggerTimezone(input.timezone)) {
    return toWorkflowScheduleValidationFailure(
      'TIMEZONE_INVALID',
      'Recurring schedules require a valid IANA timezone.'
    );
  }

  return {
    triggerType: 'recurring',
    workflowVersion: 0,
    cron: cron.value,
    timezone: input.timezone,
    enabled: input.enabled,
    status: input.enabled ? 'scheduled' : 'paused'
  };
};

const resolvePayloadSchemaRef = (
  workflow: Awaited<ReturnType<typeof WorkflowDefinitionModelV2.getById>>,
  latestVersion: WorkflowDefinitionVersionRecord
): string | null => {
  const definition = latestVersion.definition_json as WorkflowDefinition | null;
  if (definition && typeof definition.payloadSchemaRef === 'string' && definition.payloadSchemaRef.trim()) {
    return definition.payloadSchemaRef.trim();
  }
  if (workflow && typeof workflow.payload_schema_ref === 'string' && workflow.payload_schema_ref.trim()) {
    return workflow.payload_schema_ref.trim();
  }
  return null;
};

const validateSchedulableWorkflow = async (
  knex: Awaited<ReturnType<typeof createTenantKnex>>['knex'],
  workflowId: string,
  payload: Record<string, unknown>
): Promise<
  | WorkflowScheduleValidationFailure
  | {
      ok: true;
      latestVersion: WorkflowDefinitionVersionRecord;
    }
> => {
  ensureWorkflowPayloadSchemasRegistered();
  const workflow = await WorkflowDefinitionModelV2.getById(knex, workflowId);
  if (!workflow) {
    return throwHttpError(404, 'Workflow not found');
  }

  const latestVersion = await getLatestPublishedWorkflowVersion(knex, workflowId);
  if (!latestVersion) {
    return toWorkflowScheduleValidationFailure(
      'WORKFLOW_NOT_PUBLISHED',
      'Schedules can only be created for workflows with a published version.'
    );
  }

  const payloadSchemaMode = String(workflow.payload_schema_mode ?? 'pinned');
  if (payloadSchemaMode !== 'pinned') {
    return toWorkflowScheduleValidationFailure(
      'WORKFLOW_PAYLOAD_SCHEMA_NOT_PINNED',
      'Schedules are only supported for workflows with a pinned payload schema.'
    );
  }

  const payloadSchemaRef = resolvePayloadSchemaRef(workflow, latestVersion);
  const schemaRegistry = getSchemaRegistry();
  if (!payloadSchemaRef || !schemaRegistry.has(payloadSchemaRef)) {
    return toWorkflowScheduleValidationFailure(
      'WORKFLOW_PAYLOAD_SCHEMA_UNAVAILABLE',
      'The latest published workflow version does not have a registered pinned payload schema.'
    );
  }

  const validation = schemaRegistry.get(payloadSchemaRef).safeParse(payload);
  if (!validation.success) {
    return toWorkflowScheduleValidationFailure(
      'SCHEDULE_PAYLOAD_INVALID',
      'Schedule payload failed validation against the workflow payload schema.',
      validation.error.issues
    );
  }

  return {
    ok: true,
    latestVersion
  };
};

const enrichScheduleRow = async (
  knex: Awaited<ReturnType<typeof createTenantKnex>>['knex'],
  schedule: WorkflowScheduleStateRecord
) => {
  const workflow = await WorkflowDefinitionModelV2.getById(knex, schedule.workflow_id);
  return {
    ...schedule,
    workflow_name: workflow?.name ?? null
  };
};

export const listWorkflowSchedulesAction = withAuth(async (user, _ctx, input: unknown) => {
  const parsed = ListWorkflowSchedulesInput.parse(input);
  const { knex, tenant } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);

  const query = knex('tenant_workflow_schedule as tws')
    .leftJoin('workflow_definitions as wd', 'wd.workflow_id', 'tws.workflow_id')
    .select('tws.*', 'wd.name as workflow_name')
    .where('tws.tenant_id', tenant);

  if (parsed.workflowId) {
    query.andWhere('tws.workflow_id', parsed.workflowId);
  }
  if (parsed.triggerType !== 'all') {
    query.andWhere('tws.trigger_type', parsed.triggerType);
  }
  mapStatusFilter(parsed.status, query);
  if (parsed.search) {
    query.andWhere(function whereSearch(this: typeof query) {
      this.whereRaw('tws.name ilike ?', [`%${parsed.search}%`])
        .orWhereRaw('wd.name ilike ?', [`%${parsed.search}%`]);
    });
  }

  const rows = await query.orderBy('tws.updated_at', 'desc').orderBy('tws.id', 'asc');
  return { items: rows };
});

export const getWorkflowScheduleAction = withAuth(async (user, _ctx, input: unknown) => {
  const parsed = GetWorkflowScheduleInput.parse(input);
  const { knex, tenant } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);

  const row = await WorkflowScheduleStateModel.getById(knex, parsed.scheduleId);
  if (!row || row.tenant_id !== tenant) {
    return throwHttpError(404, 'Not found');
  }

  return enrichScheduleRow(knex, row);
});

async function mutateWorkflowSchedule(
  knex: Awaited<ReturnType<typeof createTenantKnex>>['knex'],
  tenant: string,
  input: CreateWorkflowScheduleInputShape | UpdateWorkflowScheduleInputShape,
  existingScheduleId?: string
): Promise<WorkflowScheduleMutationSuccess | WorkflowScheduleValidationFailure> {
  const desired = buildDesiredScheduleFromInput(input);
  if (isValidationFailure(desired)) {
    return desired;
  }

  const schedulable = await validateSchedulableWorkflow(knex, input.workflowId, input.payload);
  if (isValidationFailure(schedulable)) {
    return schedulable;
  }

  const record = {
    workflowId: input.workflowId,
    name: input.name,
    payloadJson: input.payload,
    desired: {
      ...desired,
      workflowVersion: schedulable.latestVersion.version
    }
  };

  if (!existingScheduleId) {
    const schedule = await createExternalWorkflowScheduleState(knex, {
      tenantId: tenant,
      record
    });
    return { ok: true, schedule };
  }

  const existing = await WorkflowScheduleStateModel.getById(knex, existingScheduleId);
  if (!existing || existing.tenant_id !== tenant) {
    return throwHttpError(404, 'Not found');
  }

  const schedule = await updateExternalWorkflowScheduleState(knex, {
    tenantId: tenant,
    scheduleId: existingScheduleId,
    record
  });
  return { ok: true, schedule };
}

export const createWorkflowScheduleAction = withAuth(async (user, _ctx, input: unknown) => {
  const parsed = CreateWorkflowScheduleInput.parse(input);
  const { knex, tenant } = await createTenantKnex();
  await requireWorkflowPermission(user, 'manage', knex);
  if (!tenant) {
    return throwHttpError(400, 'Tenant not found');
  }
  return mutateWorkflowSchedule(knex, tenant, parsed);
});

export const updateWorkflowScheduleAction = withAuth(async (user, _ctx, input: unknown) => {
  const parsed = UpdateWorkflowScheduleInput.parse(input);
  const { knex, tenant } = await createTenantKnex();
  await requireWorkflowPermission(user, 'manage', knex);
  if (!tenant) {
    return throwHttpError(400, 'Tenant not found');
  }
  return mutateWorkflowSchedule(knex, tenant, parsed, parsed.scheduleId);
});

export const pauseWorkflowScheduleAction = withAuth(async (user, _ctx, input: unknown) => {
  const parsed = GetWorkflowScheduleInput.parse(input);
  const { knex, tenant } = await createTenantKnex();
  await requireWorkflowPermission(user, 'manage', knex);

  const existing = await WorkflowScheduleStateModel.getById(knex, parsed.scheduleId);
  if (!existing || existing.tenant_id !== tenant) {
    return throwHttpError(404, 'Not found');
  }

  const schedule = await setExternalWorkflowScheduleEnabled(knex, {
    tenantId: tenant,
    scheduleId: parsed.scheduleId,
    enabled: false
  });
  return { ok: true, schedule };
});

export const resumeWorkflowScheduleAction = withAuth(async (user, _ctx, input: unknown) => {
  const parsed = GetWorkflowScheduleInput.parse(input);
  const { knex, tenant } = await createTenantKnex();
  await requireWorkflowPermission(user, 'manage', knex);

  const existing = await WorkflowScheduleStateModel.getById(knex, parsed.scheduleId);
  if (!existing || existing.tenant_id !== tenant) {
    return throwHttpError(404, 'Not found');
  }

  const schedule = await setExternalWorkflowScheduleEnabled(knex, {
    tenantId: tenant,
    scheduleId: parsed.scheduleId,
    enabled: true
  });
  return { ok: true, schedule };
});

export const deleteWorkflowScheduleAction = withAuth(async (user, _ctx, input: unknown) => {
  const parsed = DeleteWorkflowScheduleInput.parse(input);
  const { knex, tenant } = await createTenantKnex();
  await requireWorkflowPermission(user, 'manage', knex);

  const existing = await WorkflowScheduleStateModel.getById(knex, parsed.scheduleId);
  if (!existing || existing.tenant_id !== tenant) {
    return throwHttpError(404, 'Not found');
  }

  await deleteWorkflowScheduleStateById(knex, {
    tenantId: tenant,
    scheduleId: parsed.scheduleId
  });

  return { ok: true };
});
