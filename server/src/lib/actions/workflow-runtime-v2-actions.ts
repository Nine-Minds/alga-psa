'use server';

import { zodToJsonSchema } from 'zod-to-json-schema';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import {
  WorkflowRuntimeV2,
  getActionRegistryV2,
  getNodeTypeRegistry,
  getSchemaRegistry,
  initializeWorkflowRuntimeV2,
  validateWorkflowDefinition,
  type PublishError
} from '@shared/workflow/runtime';
import { verifySecretsExist } from '@shared/workflow/runtime/validation/publishValidation';
import { createTenantSecretProvider } from '@alga-psa/shared/workflow/secrets';
import WorkflowDefinitionModelV2 from '@shared/workflow/persistence/workflowDefinitionModelV2';
import WorkflowDefinitionVersionModelV2, { type WorkflowDefinitionVersionRecord } from '@shared/workflow/persistence/workflowDefinitionVersionModelV2';
import WorkflowRunModelV2 from '@shared/workflow/persistence/workflowRunModelV2';
import WorkflowRunStepModelV2 from '@shared/workflow/persistence/workflowRunStepModelV2';
import WorkflowRunSnapshotModelV2 from '@shared/workflow/persistence/workflowRunSnapshotModelV2';
import WorkflowRunWaitModelV2 from '@shared/workflow/persistence/workflowRunWaitModelV2';
import WorkflowActionInvocationModelV2 from '@shared/workflow/persistence/workflowActionInvocationModelV2';
import WorkflowRuntimeEventModelV2 from '@shared/workflow/persistence/workflowRuntimeEventModelV2';
import WorkflowRunLogModelV2 from '@shared/workflow/persistence/workflowRunLogModelV2';
import { auditLog } from 'server/src/lib/logging/auditLog';
import { hasPermission } from 'server/src/lib/auth/rbac';
import {
  CreateWorkflowDefinitionInput,
  DeleteWorkflowDefinitionInput,
  GetWorkflowDefinitionVersionInput,
  PublishWorkflowDefinitionInput,
  RunIdInput,
  RunActionInput,
  ReplayWorkflowRunInput,
  EventIdInput,
  SchemaRefInput,
  ListWorkflowRunsInput,
  ListWorkflowRunSummaryInput,
  ListWorkflowRunLogsInput,
  ListWorkflowAuditLogsInput,
  ListWorkflowEventsInput,
  ListWorkflowDeadLetterInput,
  StartWorkflowRunInput,
  SubmitWorkflowEventInput,
  UpdateWorkflowDefinitionInput,
  UpdateWorkflowDefinitionMetadataInput,
  WorkflowIdInput
} from './workflow-runtime-v2-schemas';

const throwHttpError = (status: number, message: string, details?: unknown): never => {
  const error = new Error(message) as Error & { status?: number; details?: unknown };
  error.status = status;
  if (details) {
    error.details = details;
  }
  throw error;
};

const EXPORT_RUNS_LIMIT = 1000;
const EXPORT_EVENTS_LIMIT = 1000;
const EXPORT_AUDIT_LIMIT = 5000;
const EXPORT_LOGS_LIMIT = 5000;

const csvEscape = (value: unknown) => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const buildCsv = (headers: string[], rows: Array<Array<unknown>>) =>
  [headers.join(','), ...rows.map((row) => row.map(csvEscape).join(','))].join('\n');

const hashDefinition = (definition: Record<string, unknown>) => {
  try {
    return createHash('sha256').update(JSON.stringify(definition)).digest('hex');
  } catch {
    return null;
  }
};

type ValidationStatus = 'valid' | 'warning' | 'error';

const deriveValidationStatus = (errors: PublishError[], warnings: PublishError[]): ValidationStatus => {
  if (errors.length > 0) return 'error';
  if (warnings.length > 0) return 'warning';
  return 'valid';
};

const buildUnknownSchemaError = (schemaRef: string): PublishError => ({
  severity: 'error',
  stepPath: 'root',
  code: 'UNKNOWN_SCHEMA',
  message: `Unknown schema ref ${schemaRef}`
});

const listSecretNames = async (knex: Awaited<ReturnType<typeof createTenantKnex>>['knex'], tenant?: string | null) => {
  if (!tenant) return null;
  const provider = createTenantSecretProvider(knex, tenant);
  const secrets = await provider.list();
  return new Set(secrets.map((secret) => secret.name));
};

const computeValidation = async (params: {
  definition: Record<string, unknown>;
  payloadSchemaRef?: string | null;
  payloadSchemaJson?: Record<string, unknown> | null;
  knex: Awaited<ReturnType<typeof createTenantKnex>>['knex'];
  tenant?: string | null;
}) => {
  const { definition, payloadSchemaRef, payloadSchemaJson, knex, tenant } = params;
  const validation = validateWorkflowDefinition(
    definition as any,
    payloadSchemaJson ?? undefined
  );

  const errors = [...validation.errors];
  const warnings = [...validation.warnings];

  if (!payloadSchemaJson && payloadSchemaRef) {
    errors.push(buildUnknownSchemaError(payloadSchemaRef));
  }

  if (validation.secretRefs.size > 0) {
    const knownSecrets = await listSecretNames(knex, tenant);
    if (knownSecrets) {
      const secretErrors = verifySecretsExist(validation.secretRefs, knownSecrets);
      errors.push(...secretErrors);
    }
  }

  const status = deriveValidationStatus(errors, warnings);
  return {
    ...validation,
    errors,
    warnings,
    status
  };
};

const SENSITIVE_KEY_PATTERN = /(secret|token|password|api[_-]?key|authorization)/i;

const WORKFLOW_RUN_RATE_LIMIT_POINTS = Number(process.env.WORKFLOW_RUN_RATE_LIMIT_POINTS ?? 60);
const WORKFLOW_RUN_RATE_LIMIT_DURATION = Number(process.env.WORKFLOW_RUN_RATE_LIMIT_DURATION ?? 60);
const DEFAULT_WORKFLOW_RUN_PAYLOAD_BYTES = 512 * 1024;
const WORKFLOW_RUN_PAYLOAD_MAX_BYTES = Number(process.env.WORKFLOW_RUN_PAYLOAD_MAX_BYTES ?? DEFAULT_WORKFLOW_RUN_PAYLOAD_BYTES);
const WORKFLOW_RUN_PAYLOAD_LIMIT = Number.isFinite(WORKFLOW_RUN_PAYLOAD_MAX_BYTES)
  ? WORKFLOW_RUN_PAYLOAD_MAX_BYTES
  : DEFAULT_WORKFLOW_RUN_PAYLOAD_BYTES;

const workflowRunStartLimiter = new RateLimiterMemory({
  points: Number.isFinite(WORKFLOW_RUN_RATE_LIMIT_POINTS) ? WORKFLOW_RUN_RATE_LIMIT_POINTS : 60,
  duration: Number.isFinite(WORKFLOW_RUN_RATE_LIMIT_DURATION) ? WORKFLOW_RUN_RATE_LIMIT_DURATION : 60
});

const measurePayloadBytes = (payload: unknown) => {
  try {
    const serialized = JSON.stringify(payload ?? {});
    return Buffer.byteLength(serialized, 'utf8');
  } catch {
    return null;
  }
};

const redactSensitiveValues = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitiveValues(entry));
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, val]) => {
      if (key === 'secretRef' || SENSITIVE_KEY_PATTERN.test(key)) {
        return [key, '***'];
      }
      return [key, redactSensitiveValues(val)];
    });
    return Object.fromEntries(entries);
  }
  return value;
};

const requireUser = async () => {
  const user = await getCurrentUser();
  if (!user) {
    throwHttpError(401, 'Unauthorized');
  }
  return user!;
};

const requireWorkflowPermission = async (
  user: Awaited<ReturnType<typeof getCurrentUser>>,
  action: 'read' | 'manage' | 'publish' | 'admin',
  knex?: Awaited<ReturnType<typeof createTenantKnex>>['knex']
) => {
  if (!user) {
    return throwHttpError(401, 'Unauthorized');
  }
  const allowed = await hasPermission(user!, 'workflow', action, knex);
  if (allowed) return;
  if (action === 'read') {
    const viewAllowed = await hasPermission(user!, 'workflow', 'view', knex);
    if (viewAllowed) return;
    const manageAllowed = await hasPermission(user!, 'workflow', 'manage', knex);
    if (manageAllowed) return;
    const adminAllowed = await hasPermission(user!, 'workflow', 'admin', knex);
    if (adminAllowed) return;
  }
  if (action === 'manage') {
    const adminAllowed = await hasPermission(user!, 'workflow', 'admin', knex);
    if (adminAllowed) return;
  }
  if (action === 'publish') {
    const adminAllowed = await hasPermission(user!, 'workflow', 'admin', knex);
    if (adminAllowed) return;
  }
  throwHttpError(403, 'Forbidden');
};

const auditWorkflowEvent = async (
  knex: Awaited<ReturnType<typeof createTenantKnex>>['knex'],
  user: Awaited<ReturnType<typeof getCurrentUser>>,
  params: {
    operation: string;
    tableName: 'workflow_definitions' | 'workflow_runs';
    recordId: string;
    changedData?: Record<string, unknown>;
    details?: Record<string, unknown>;
    source?: string | null;
  }
) => {
  if (!user) return;
  const roleNames = user.roles?.map((role) => role.role_name) ?? [];
  await auditLog(knex, {
    userId: user.user_id,
    operation: params.operation,
    tableName: params.tableName,
    recordId: params.recordId,
    changedData: params.changedData ?? {},
    details: {
      ...params.details,
      actorRoles: roleNames,
      source: params.source ?? 'api'
    }
  });
};

export async function listWorkflowDefinitionsAction() {
  const user = await requireUser();
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);
  const records = await WorkflowDefinitionModelV2.list(knex);
  const workflowIds = records.map((record) => record.workflow_id);
  const publishedVersionMap = new Map<string, number | null>();
  if (workflowIds.length) {
    const rows = await knex('workflow_definition_versions')
      .select('workflow_id')
      .max('version as published_version')
      .whereIn('workflow_id', workflowIds)
      .groupBy('workflow_id') as Array<{ workflow_id: string; published_version: number | string | null }>;
    rows.forEach((row) => {
      const value = row.published_version == null ? null : Number(row.published_version);
      publishedVersionMap.set(row.workflow_id, Number.isNaN(value as number) ? null : value);
    });
  }

  const enrichedRecords = records.map((record) => ({
    ...record,
    published_version: publishedVersionMap.get(record.workflow_id) ?? null
  }));
  const canAdmin = await hasPermission(user, 'workflow', 'admin', knex);
  if (canAdmin) {
    return enrichedRecords;
  }
  return enrichedRecords.filter((record) => record.is_visible !== false);
}

export async function listWorkflowDefinitionVersionsAction(input: unknown) {
  const user = await requireUser();
  const parsed = WorkflowIdInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);

  const rows = await knex('workflow_definition_versions')
    .select('version', 'published_at', 'created_at')
    .where({ workflow_id: parsed.workflowId })
    .orderBy('version', 'desc');

  return { versions: rows };
}

export async function createWorkflowDefinitionAction(input: unknown) {
  const user = await requireUser();
  initializeWorkflowRuntimeV2();
  const parsed = CreateWorkflowDefinitionInput.parse(input);

  const { knex, tenant } = await createTenantKnex();
  await requireWorkflowPermission(user, 'manage', knex);
  const workflowId = uuidv4();
  const definition = { ...parsed.definition, id: workflowId };

  const schemaRegistry = getSchemaRegistry();
  const payloadSchemaJson = definition.payloadSchemaRef && schemaRegistry.has(definition.payloadSchemaRef)
    ? schemaRegistry.toJsonSchema(definition.payloadSchemaRef)
    : null;
  const validation = await computeValidation({
    definition,
    payloadSchemaRef: definition.payloadSchemaRef,
    payloadSchemaJson,
    knex,
    tenant
  });

  const record = await WorkflowDefinitionModelV2.create(knex, {
    workflow_id: workflowId,
    name: definition.name,
    description: definition.description ?? null,
    payload_schema_ref: definition.payloadSchemaRef,
    trigger: definition.trigger ?? null,
    draft_definition: definition,
    draft_version: definition.version,
    status: 'draft',
    validation_status: validation.status,
    validation_errors: validation.errors,
    validation_warnings: validation.warnings,
    validated_at: new Date().toISOString(),
    created_by: user.user_id,
    updated_by: user.user_id
  });

  await auditWorkflowEvent(knex, user, {
    operation: 'workflow_definition_create',
    tableName: 'workflow_definitions',
    recordId: record.workflow_id,
    changedData: {
      name: definition.name,
      payloadSchemaRef: definition.payloadSchemaRef,
      status: 'draft'
    },
    details: {
      draftVersion: definition.version,
      trigger: definition.trigger ?? null,
      definitionHash: hashDefinition(definition as Record<string, unknown>)
    },
    source: 'api'
  });

  return { workflowId: record.workflow_id };
}

export async function getWorkflowDefinitionVersionAction(input: unknown) {
  const user = await requireUser();
  const parsed = GetWorkflowDefinitionVersionInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);
  const record = await WorkflowDefinitionVersionModelV2.getByWorkflowAndVersion(
    knex,
    parsed.workflowId,
    parsed.version
  );
  if (!record) {
    return throwHttpError(404, 'Not found');
  }
  return record;
}

export async function updateWorkflowDefinitionDraftAction(input: unknown) {
  const user = await requireUser();
  initializeWorkflowRuntimeV2();
  const parsed = UpdateWorkflowDefinitionInput.parse(input);

  const { knex, tenant } = await createTenantKnex();
  await requireWorkflowPermission(user, 'manage', knex);
  const current = await WorkflowDefinitionModelV2.getById(knex, parsed.workflowId);
  if (current?.is_system) {
    await requireWorkflowPermission(user, 'admin', knex);
  }
  const definition = { ...parsed.definition, id: parsed.workflowId };

  const schemaRegistry = getSchemaRegistry();
  const payloadSchemaJson = definition.payloadSchemaRef && schemaRegistry.has(definition.payloadSchemaRef)
    ? schemaRegistry.toJsonSchema(definition.payloadSchemaRef)
    : null;
  const validation = await computeValidation({
    definition,
    payloadSchemaRef: definition.payloadSchemaRef,
    payloadSchemaJson,
    knex,
    tenant
  });

  const updated = await WorkflowDefinitionModelV2.update(knex, parsed.workflowId, {
    draft_definition: definition,
    draft_version: definition.version,
    updated_by: user.user_id,
    name: definition.name,
    description: definition.description ?? null,
    payload_schema_ref: definition.payloadSchemaRef,
    trigger: definition.trigger ?? null,
    validation_status: validation.status,
    validation_errors: validation.errors,
    validation_warnings: validation.warnings,
    validated_at: new Date().toISOString()
  });

  if (!updated) {
    return throwHttpError(404, 'Not found');
  }

  await auditWorkflowEvent(knex, user, {
    operation: 'workflow_definition_update',
    tableName: 'workflow_definitions',
    recordId: parsed.workflowId,
    changedData: {
      name: definition.name,
      payloadSchemaRef: definition.payloadSchemaRef,
      draftVersion: definition.version
    },
    details: {
      definitionHash: hashDefinition(definition as Record<string, unknown>)
    },
    source: 'api'
  });

  return updated;
}

export async function updateWorkflowDefinitionMetadataAction(input: unknown) {
  const user = await requireUser();
  const parsed = UpdateWorkflowDefinitionMetadataInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'manage', knex);

  const current = await WorkflowDefinitionModelV2.getById(knex, parsed.workflowId);
  if (!current) {
    return throwHttpError(404, 'Not found');
  }
  if (current.is_system) {
    await requireWorkflowPermission(user, 'admin', knex);
  }

  const updated = await WorkflowDefinitionModelV2.update(knex, parsed.workflowId, {
    is_visible: parsed.isVisible ?? current.is_visible ?? true,
    is_paused: parsed.isPaused ?? current.is_paused ?? false,
    concurrency_limit: parsed.concurrencyLimit ?? current.concurrency_limit ?? null,
    auto_pause_on_failure: parsed.autoPauseOnFailure ?? current.auto_pause_on_failure ?? false,
    failure_rate_threshold: parsed.failureRateThreshold ?? current.failure_rate_threshold ?? null,
    failure_rate_min_runs: parsed.failureRateMinRuns ?? current.failure_rate_min_runs ?? null,
    retention_policy_override: parsed.retentionPolicyOverride ?? current.retention_policy_override ?? null,
    updated_by: user.user_id
  });

  await auditWorkflowEvent(knex, user, {
    operation: 'workflow_definition_metadata_update',
    tableName: 'workflow_definitions',
    recordId: parsed.workflowId,
    changedData: {
      isVisible: parsed.isVisible,
      isPaused: parsed.isPaused,
      concurrencyLimit: parsed.concurrencyLimit,
      autoPauseOnFailure: parsed.autoPauseOnFailure,
      failureRateThreshold: parsed.failureRateThreshold,
      failureRateMinRuns: parsed.failureRateMinRuns
    },
    details: {
      retentionPolicyOverride: parsed.retentionPolicyOverride ?? null
    },
    source: 'api'
  });

  return updated;
}

export async function deleteWorkflowDefinitionAction(input: unknown) {
  const user = await requireUser();
  const parsed = DeleteWorkflowDefinitionInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'manage', knex);

  const current = await WorkflowDefinitionModelV2.getById(knex, parsed.workflowId);
  if (!current) {
    return throwHttpError(404, 'Not found');
  }
  if (current.is_system) {
    return throwHttpError(403, 'System workflows cannot be deleted');
  }

  // Check for active runs
  const activeRuns = await knex('workflow_runs')
    .where({ workflow_id: parsed.workflowId })
    .whereIn('status', ['RUNNING', 'WAITING'])
    .count('* as count')
    .first();

  if (activeRuns && Number(activeRuns.count) > 0) {
    return throwHttpError(409, 'Cannot delete workflow with active runs. Cancel all runs first.');
  }

  // Delete related records in order (respecting foreign key constraints)
  await knex.transaction(async (trx) => {
    // Delete run-related data
    const runIds = await trx('workflow_runs')
      .where({ workflow_id: parsed.workflowId })
      .pluck('run_id');

    if (runIds.length > 0) {
      await trx('workflow_run_logs').whereIn('run_id', runIds).del();
      await trx('workflow_action_invocations').whereIn('run_id', runIds).del();
      await trx('workflow_run_snapshots').whereIn('run_id', runIds).del();
      await trx('workflow_run_waits').whereIn('run_id', runIds).del();
      await trx('workflow_run_steps').whereIn('run_id', runIds).del();
      await trx('workflow_runs').whereIn('run_id', runIds).del();
    }

    // Delete versions
    await trx('workflow_definition_versions')
      .where({ workflow_id: parsed.workflowId })
      .del();

    // Delete the definition
    await trx('workflow_definitions')
      .where({ workflow_id: parsed.workflowId })
      .del();
  });

  await auditWorkflowEvent(knex, user, {
    operation: 'workflow_definition_delete',
    tableName: 'workflow_definitions',
    recordId: parsed.workflowId,
    changedData: {
      name: current.name,
      status: current.status
    },
    details: {
      deletedAt: new Date().toISOString()
    },
    source: 'api'
  });

  return { deleted: true, workflowId: parsed.workflowId };
}

export async function publishWorkflowDefinitionAction(input: unknown) {
  const user = await requireUser();
  initializeWorkflowRuntimeV2();
  const parsed = PublishWorkflowDefinitionInput.parse(input);

  const { knex, tenant } = await createTenantKnex();
  await requireWorkflowPermission(user, 'publish', knex);
  const workflow = await WorkflowDefinitionModelV2.getById(knex, parsed.workflowId);
  if (!workflow) {
    return throwHttpError(404, 'Not found');
  }
  if (workflow.is_system) {
    await requireWorkflowPermission(user, 'admin', knex);
  }

  const definition = { ...(parsed.definition as any ?? workflow.draft_definition), id: parsed.workflowId };
  if (!definition) {
    return throwHttpError(400, 'No definition to publish');
  }

  const schemaRegistry = getSchemaRegistry();
  const payloadSchemaJson = schemaRegistry.has(definition.payloadSchemaRef)
    ? schemaRegistry.toJsonSchema(definition.payloadSchemaRef)
    : null;
  const validation = await computeValidation({
    definition,
    payloadSchemaRef: definition.payloadSchemaRef,
    payloadSchemaJson,
    knex,
    tenant
  });
  if (validation.errors.length > 0) {
    return { ok: false, errors: validation.errors, warnings: validation.warnings };
  }

  const record = await WorkflowDefinitionVersionModelV2.create(knex, {
    workflow_id: parsed.workflowId,
    version: parsed.version,
    definition_json: definition,
    payload_schema_json: payloadSchemaJson as Record<string, unknown> | null,
    validation_status: validation.status,
    validation_errors: validation.errors,
    validation_warnings: validation.warnings,
    validated_at: new Date().toISOString(),
    published_by: user.user_id,
    published_at: new Date().toISOString()
  });

  await WorkflowDefinitionModelV2.update(knex, parsed.workflowId, {
    status: 'published',
    updated_by: user.user_id
  });

  await auditWorkflowEvent(knex, user, {
    operation: 'workflow_definition_publish',
    tableName: 'workflow_definitions',
    recordId: parsed.workflowId,
    changedData: {
      publishedVersion: record.version,
      status: 'published'
    },
    details: {
      definitionHash: hashDefinition(definition as Record<string, unknown>),
      warnings: validation.warnings?.length ?? 0
    },
    source: 'api'
  });

  return { ok: true, publishedVersion: record.version, errors: [], warnings: validation.warnings };
}

export async function startWorkflowRunAction(input: unknown) {
  const user = await requireUser();
  initializeWorkflowRuntimeV2();
  const parsed = StartWorkflowRunInput.parse(input);

  const { knex, tenant } = await createTenantKnex();
  await requireWorkflowPermission(user, 'manage', knex);
  if (tenant) {
    try {
      await workflowRunStartLimiter.consume(tenant);
    } catch {
      throwHttpError(429, 'Workflow run rate limit exceeded');
    }
  }

  const payloadSize = measurePayloadBytes(parsed.payload);
  if (payloadSize === null) {
    return throwHttpError(400, 'Payload must be JSON serializable');
  }
  if (payloadSize > WORKFLOW_RUN_PAYLOAD_LIMIT) {
    return throwHttpError(413, 'Payload exceeds maximum size');
  }
  const runtime = new WorkflowRuntimeV2();

  const workflow = await WorkflowDefinitionModelV2.getById(knex, parsed.workflowId);
  if (!workflow) {
    return throwHttpError(404, 'Workflow not found');
  }
  if (workflow.is_paused) {
    return throwHttpError(409, 'Workflow is paused');
  }
  if (workflow.concurrency_limit) {
    const activeCount = await knex('workflow_runs')
      .where({ workflow_id: parsed.workflowId })
      .whereIn('status', ['RUNNING', 'WAITING'])
      .count('* as count')
      .first();
    const current = Number((activeCount as any)?.count ?? 0);
    if (current >= workflow.concurrency_limit) {
      return throwHttpError(429, 'Workflow concurrency limit reached');
    }
  }

  let versionRecord: WorkflowDefinitionVersionRecord | null = null;
  if (parsed.workflowVersion) {
    versionRecord = await WorkflowDefinitionVersionModelV2.getByWorkflowAndVersion(
      knex,
      parsed.workflowId,
      parsed.workflowVersion
    );
    if (!versionRecord) {
      return throwHttpError(404, 'Workflow version not found');
    }
  } else {
    const versions = await WorkflowDefinitionVersionModelV2.listByWorkflow(knex, parsed.workflowId);
    versionRecord = versions[0] ?? null;
    if (!versionRecord) {
      return throwHttpError(409, 'Workflow has no published versions');
    }
  }

  const schemaRegistry = getSchemaRegistry();
  const definition = versionRecord.definition_json as Record<string, unknown> | null;
  const schemaRef = definition?.payloadSchemaRef ?? workflow.payload_schema_ref ?? null;

  if (!versionRecord.validation_status || versionRecord.validation_status === 'error') {
    const payloadSchemaJson = versionRecord.payload_schema_json
      ?? (schemaRef && schemaRegistry.has(schemaRef) ? schemaRegistry.toJsonSchema(schemaRef) : null);
    const validation = await computeValidation({
      definition: definition ?? {},
      payloadSchemaRef: schemaRef ?? undefined,
      payloadSchemaJson,
      knex,
      tenant
    });
    await WorkflowDefinitionVersionModelV2.update(knex, parsed.workflowId, versionRecord.version, {
      validation_status: validation.status,
      validation_errors: validation.errors,
      validation_warnings: validation.warnings,
      validated_at: new Date().toISOString()
    });
    if (validation.errors.length > 0) {
      return throwHttpError(409, 'Workflow validation failed', { errors: validation.errors, warnings: validation.warnings });
    }
  }

  if (schemaRef && schemaRegistry.has(schemaRef)) {
    const validation = schemaRegistry.get(schemaRef).safeParse(parsed.payload);
    if (!validation.success) {
      return throwHttpError(400, 'Payload failed validation', { issues: validation.error.issues });
    }
  }

  const runId = await runtime.startRun(knex, {
    workflowId: parsed.workflowId,
    version: versionRecord.version,
    payload: parsed.payload,
    tenantId: tenant
  });

  await runtime.executeRun(knex, runId, `action-${user.user_id}`);

  const run = await WorkflowRunModelV2.getById(knex, runId);
  return { runId, status: run?.status };
}

export async function getWorkflowRunAction(input: unknown) {
  const user = await requireUser();
  const parsed = RunIdInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);
  const run = await WorkflowRunModelV2.getById(knex, parsed.runId);
  if (!run) {
    return throwHttpError(404, 'Not found');
  }
  return run;
}

export async function listWorkflowRunsAction(input: unknown) {
  const user = await requireUser();
  const parsed = ListWorkflowRunsInput.parse(input);
  const { knex, tenant } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);

  const [sortField, sortDir] = parsed.sort.split(':') as ['started_at' | 'updated_at', 'asc' | 'desc'];

  const query = knex('workflow_runs')
    .leftJoin('workflow_definitions', 'workflow_runs.workflow_id', 'workflow_definitions.workflow_id')
    .select(
      'workflow_runs.run_id',
      'workflow_runs.workflow_id',
      'workflow_runs.workflow_version',
      'workflow_runs.tenant_id',
      'workflow_runs.status',
      'workflow_runs.node_path',
      'workflow_runs.started_at',
      'workflow_runs.completed_at',
      'workflow_runs.updated_at',
      'workflow_definitions.name as workflow_name'
    );

  if (tenant) {
    query.where('workflow_runs.tenant_id', tenant);
  }
  if (parsed.status?.length) {
    query.whereIn('workflow_runs.status', parsed.status);
  }
  if (parsed.workflowId) {
    query.where('workflow_runs.workflow_id', parsed.workflowId);
  }
  if (parsed.version) {
    query.where('workflow_runs.workflow_version', parsed.version);
  }
  if (parsed.runId) {
    query.where('workflow_runs.run_id', parsed.runId);
  }
  if (parsed.search) {
    const searchValue = `%${parsed.search}%`;
    query.where((builder) => {
      builder
        .whereRaw('workflow_runs.run_id::text ilike ?', [searchValue])
        .orWhereExists(
          knex('workflow_run_waits')
            .select(1)
            .whereRaw('workflow_run_waits.run_id = workflow_runs.run_id')
            .where('workflow_run_waits.key', 'ilike', searchValue)
        );
    });
  }
  if (parsed.from) {
    query.where('workflow_runs.started_at', '>=', parsed.from);
  }
  if (parsed.to) {
    query.where('workflow_runs.started_at', '<=', parsed.to);
  }

  const rows = await query
    .orderBy(`workflow_runs.${sortField}`, sortDir)
    .orderBy('workflow_runs.run_id', 'desc')
    .limit(parsed.limit + 1)
    .offset(parsed.cursor);

  const hasMore = rows.length > parsed.limit;
  const runs = hasMore ? rows.slice(0, parsed.limit) : rows;
  const nextCursor = hasMore ? parsed.cursor + parsed.limit : null;

  return { runs, nextCursor };
}

export async function exportWorkflowRunsAction(input: unknown) {
  const rawInput = (input ?? {}) as Record<string, unknown>;
  const result = await listWorkflowRunsAction({
    ...rawInput,
    limit: rawInput.limit ?? EXPORT_RUNS_LIMIT,
    cursor: 0
  });

  const headers = [
    'run_id',
    'workflow_name',
    'workflow_id',
    'workflow_version',
    'status',
    'tenant_id',
    'started_at',
    'updated_at',
    'completed_at'
  ];

  const rows = result.runs.map((run: any) => [
    run.run_id,
    run.workflow_name ?? '',
    run.workflow_id,
    run.workflow_version,
    run.status,
    run.tenant_id ?? '',
    run.started_at,
    run.updated_at,
    run.completed_at ?? ''
  ]);

  const csv = buildCsv(headers, rows);
  return { body: csv, contentType: 'text/csv', filename: 'workflow-runs.csv' };
}

export async function listWorkflowDeadLetterRunsAction(input: unknown) {
  const user = await requireUser();
  const parsed = ListWorkflowDeadLetterInput.parse(input);
  const { knex, tenant } = await createTenantKnex();
  await requireWorkflowPermission(user, 'admin', knex);

  const query = knex('workflow_runs as runs')
    .leftJoin('workflow_definitions as defs', 'runs.workflow_id', 'defs.workflow_id')
    .leftJoin('workflow_run_steps as steps', 'runs.run_id', 'steps.run_id')
    .where('runs.status', 'FAILED')
    .select(
      'runs.run_id',
      'runs.workflow_id',
      'runs.workflow_version',
      'runs.tenant_id',
      'runs.status',
      'runs.started_at',
      'runs.updated_at',
      'runs.completed_at',
      'defs.name as workflow_name',
      knex.raw('max(steps.attempt) as max_attempt'),
      knex.raw("count(case when steps.status = 'FAILED' then 1 end) as failed_steps")
    )
    .groupBy(
      'runs.run_id',
      'runs.workflow_id',
      'runs.workflow_version',
      'runs.tenant_id',
      'runs.status',
      'runs.started_at',
      'runs.updated_at',
      'runs.completed_at',
      'defs.name'
    )
    .havingRaw('max(steps.attempt) >= ?', [parsed.minRetries]);

  if (tenant) {
    query.where('runs.tenant_id', tenant);
  }

  const rows = await query
    .orderBy('runs.updated_at', 'desc')
    .orderBy('runs.run_id', 'desc')
    .limit(parsed.limit + 1)
    .offset(parsed.cursor);

  const hasMore = rows.length > parsed.limit;
  const runs = hasMore ? rows.slice(0, parsed.limit) : rows;
  const nextCursor = hasMore ? parsed.cursor + parsed.limit : null;

  return { runs, nextCursor };
}

export async function listWorkflowRunSummaryAction(input: unknown) {
  const user = await requireUser();
  const parsed = ListWorkflowRunSummaryInput.parse(input);
  const { knex, tenant } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);

  const query = knex('workflow_runs').select('status').count('* as count');

  if (tenant) {
    query.where('tenant_id', tenant);
  }
  if (parsed.workflowId) {
    query.where('workflow_id', parsed.workflowId);
  }
  if (parsed.version) {
    query.where('workflow_version', parsed.version);
  }
  if (parsed.from) {
    query.where('started_at', '>=', parsed.from);
  }
  if (parsed.to) {
    query.where('started_at', '<=', parsed.to);
  }

  const rows = await query.groupBy('status');
  const summary: Record<string, number> = {};
  let total = 0;
  rows.forEach((row: any) => {
    const count = Number(row.count ?? 0);
    summary[row.status] = count;
    total += count;
  });

  return { total, byStatus: summary };
}

export async function getWorkflowRunSummaryMetadataAction(input: unknown) {
  const user = await requireUser();
  const parsed = RunIdInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);

  const run = await WorkflowRunModelV2.getById(knex, parsed.runId);
  if (!run) {
    return throwHttpError(404, 'Run not found');
  }

  const [stepsCount, logsCount, waitsCount] = await Promise.all([
    knex('workflow_run_steps').where({ run_id: parsed.runId }).count<{ count: string }>('step_id as count').first(),
    knex('workflow_run_logs').where({ run_id: parsed.runId }).count<{ count: string }>('log_id as count').first(),
    knex('workflow_run_waits').where({ run_id: parsed.runId }).count<{ count: string }>('wait_id as count').first()
  ]);

  const durationMs = run.completed_at
    ? new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()
    : null;

  return {
    runId: run.run_id,
    status: run.status,
    workflowId: run.workflow_id,
    workflowVersion: run.workflow_version,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    durationMs: durationMs != null && durationMs >= 0 ? durationMs : null,
    stepsCount: Number(stepsCount?.count ?? 0),
    logsCount: Number(logsCount?.count ?? 0),
    waitsCount: Number(waitsCount?.count ?? 0)
  };
}

export async function getLatestWorkflowRunAction(input: unknown) {
  const user = await requireUser();
  const parsed = WorkflowIdInput.parse(input);
  const { knex, tenant } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);

  const query = knex('workflow_runs')
    .where({ workflow_id: parsed.workflowId })
    .orderBy('started_at', 'desc')
    .limit(1);

  if (tenant) {
    query.where('tenant_id', tenant);
  }

  const latest = await query.first();
  if (!latest) {
    return { run: null };
  }

  return { run: latest };
}

export async function listWorkflowRunLogsAction(input: unknown) {
  const user = await requireUser();
  const parsed = ListWorkflowRunLogsInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);

  return WorkflowRunLogModelV2.listByRun(knex, parsed.runId, {
    level: parsed.level,
    search: parsed.search,
    limit: parsed.limit,
    cursor: parsed.cursor
  });
}

export async function listWorkflowRunTimelineEventsAction(input: unknown) {
  const user = await requireUser();
  const parsed = RunIdInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);

  const steps = await WorkflowRunStepModelV2.listByRun(knex, parsed.runId);
  const waits = await WorkflowRunWaitModelV2.listByRun(knex, parsed.runId);

  const stepEvents = steps.map((step) => ({
    type: 'step',
    step_id: step.step_id,
    step_path: step.step_path,
    definition_step_id: step.definition_step_id,
    status: step.status,
    attempt: step.attempt,
    duration_ms: step.duration_ms ?? null,
    started_at: step.started_at,
    completed_at: step.completed_at ?? null,
    timestamp: step.started_at
  }));

  const waitEvents = waits.map((wait) => ({
    type: 'wait',
    wait_id: wait.wait_id,
    step_path: wait.step_path,
    wait_type: wait.wait_type,
    status: wait.status,
    event_name: wait.event_name ?? null,
    key: wait.key ?? null,
    timeout_at: wait.timeout_at ?? null,
    created_at: wait.created_at,
    resolved_at: wait.resolved_at ?? null,
    timestamp: wait.created_at
  }));

  const events = [...stepEvents, ...waitEvents].sort((a, b) => (
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  ));

  return { events };
}

export async function exportWorkflowRunLogsAction(input: unknown) {
  const rawInput = (input ?? {}) as Record<string, unknown>;
  const parsed = ListWorkflowRunLogsInput.parse({
    ...rawInput,
    limit: rawInput.limit ?? EXPORT_LOGS_LIMIT,
    cursor: 0
  });
  const result = await listWorkflowRunLogsAction(parsed);

  const headers = ['created_at', 'level', 'message', 'step_path', 'event_name', 'correlation_key', 'source'];
  const rows = result.logs.map((log: any) => [
    log.created_at,
    log.level,
    log.message,
    log.step_path ?? '',
    log.event_name ?? '',
    log.correlation_key ?? '',
    log.source ?? ''
  ]);

  return {
    body: buildCsv(headers, rows),
    contentType: 'text/csv',
    filename: `workflow-run-${parsed.runId}-logs.csv`
  };
}

export async function listWorkflowAuditLogsAction(input: unknown) {
  const user = await requireUser();
  const parsed = ListWorkflowAuditLogsInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'admin', knex);

  const rows = await knex('audit_logs')
    .where({ table_name: parsed.tableName, record_id: parsed.recordId })
    .orderBy('timestamp', 'desc')
    .orderBy('audit_id', 'desc')
    .limit(parsed.limit + 1)
    .offset(parsed.cursor);

  const hasMore = rows.length > parsed.limit;
  const logs = hasMore ? rows.slice(0, parsed.limit) : rows;
  const nextCursor = hasMore ? parsed.cursor + parsed.limit : null;

  const sanitized = logs.map((log: any) => ({
    ...log,
    changed_data: redactSensitiveValues(log.changed_data),
    details: redactSensitiveValues(log.details)
  }));

  return { logs: sanitized, nextCursor };
}

export async function exportWorkflowAuditLogsAction(input: unknown) {
  const rawInput = (input ?? {}) as Record<string, unknown>;
  const format = String(rawInput.format ?? 'csv').toLowerCase() === 'json' ? 'json' : 'csv';
  const parsed = ListWorkflowAuditLogsInput.parse({
    ...rawInput,
    limit: rawInput.limit ?? EXPORT_AUDIT_LIMIT,
    cursor: 0
  });

  const result = await listWorkflowAuditLogsAction(parsed);
  const filenamePrefix = parsed.tableName === 'workflow_definitions' ? 'workflow-definition' : 'workflow-run';
  const filename = `${filenamePrefix}-${parsed.recordId}-audit.${format === 'json' ? 'json' : 'csv'}`;

  if (format === 'json') {
    return {
      body: JSON.stringify(result.logs, null, 2),
      contentType: 'application/json',
      filename
    };
  }

  const headers = ['timestamp', 'operation', 'user_id', 'table_name', 'record_id'];
  const rows = result.logs.map((log: any) => [
    log.timestamp,
    log.operation,
    log.user_id ?? '',
    log.table_name,
    log.record_id
  ]);
  return {
    body: buildCsv(headers, rows),
    contentType: 'text/csv',
    filename
  };
}

export async function listWorkflowRunStepsAction(input: unknown) {
  const user = await requireUser();
  const parsed = RunIdInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);
  const steps = await WorkflowRunStepModelV2.listByRun(knex, parsed.runId);
  const snapshots = await WorkflowRunSnapshotModelV2.listByRun(knex, parsed.runId);
  const invocations = await WorkflowActionInvocationModelV2.listByRun(knex, parsed.runId);
  const waits = await WorkflowRunWaitModelV2.listByRun(knex, parsed.runId);
  const canManage = await hasPermission(user, 'workflow', 'manage', knex);
  const canAdmin = await hasPermission(user, 'workflow', 'admin', knex);
  const canViewSensitive = canManage || canAdmin;

  const redactedInvocations = canViewSensitive
    ? invocations
    : invocations.map((invocation) => ({
        ...invocation,
        input_json: invocation.input_json ? { redacted: true } : null,
        output_json: invocation.output_json ? { redacted: true } : null
      }));

  return { steps, snapshots, invocations: redactedInvocations, waits };
}

export async function exportWorkflowRunDetailAction(input: unknown) {
  const user = await requireUser();
  const parsed = RunIdInput.parse(input);
  const { knex, tenant } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);

  const run = await WorkflowRunModelV2.getById(knex, parsed.runId);
  if (!run) {
    return throwHttpError(404, 'Not found');
  }
  if (tenant && run.tenant_id && run.tenant_id !== tenant) {
    return throwHttpError(404, 'Not found');
  }

  const steps = await WorkflowRunStepModelV2.listByRun(knex, parsed.runId);
  const snapshots = await WorkflowRunSnapshotModelV2.listByRun(knex, parsed.runId);
  const invocations = await WorkflowActionInvocationModelV2.listByRun(knex, parsed.runId);
  const waits = await WorkflowRunWaitModelV2.listByRun(knex, parsed.runId);
  const canManage = await hasPermission(user!, 'workflow', 'manage', knex);
  const canAdmin = await hasPermission(user!, 'workflow', 'admin', knex);
  const canViewSensitive = canManage || canAdmin;

  const sanitizedInvocations = canViewSensitive
    ? invocations
    : invocations.map((invocation) => ({
        ...invocation,
        input_json: invocation.input_json ? { redacted: true } : null,
        output_json: invocation.output_json ? { redacted: true } : null
      }));

  const sanitizedSnapshots = snapshots.map((snapshot) => ({
    ...snapshot,
    envelope_json: redactSensitiveValues(snapshot.envelope_json)
  }));

  const sanitizedRun = {
    ...run,
    input_json: redactSensitiveValues(run.input_json),
    resume_event_payload: redactSensitiveValues(run.resume_event_payload),
    resume_error: redactSensitiveValues(run.resume_error),
    error_json: redactSensitiveValues(run.error_json)
  };

  return {
    run: sanitizedRun,
    steps,
    snapshots: sanitizedSnapshots,
    invocations: sanitizedInvocations,
    waits
  };
}

export async function cancelWorkflowRunAction(input: unknown) {
  const user = await requireUser();
  const parsed = RunActionInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'admin', knex);

  await WorkflowRunModelV2.update(knex, parsed.runId, {
    status: 'CANCELED',
    node_path: null,
    completed_at: new Date().toISOString()
  });

  const runRecord = await WorkflowRunModelV2.getById(knex, parsed.runId);
  const waits = await knex('workflow_run_waits').where({ run_id: parsed.runId, status: 'WAITING' });
  for (const wait of waits) {
    await WorkflowRunWaitModelV2.update(knex, wait.wait_id, {
      status: 'CANCELED',
      resolved_at: new Date().toISOString()
    });
  }

  await WorkflowRunLogModelV2.create(knex, {
    run_id: parsed.runId,
    tenant_id: runRecord?.tenant_id ?? null,
    level: 'WARN',
    message: 'Run canceled by operator',
    context_json: { reason: parsed.reason },
    source: parsed.source ?? 'api'
  });

  await auditWorkflowEvent(knex, user, {
    operation: 'workflow_run_cancel',
    tableName: 'workflow_runs',
    recordId: parsed.runId,
    changedData: { status: 'CANCELED' },
    details: { reason: parsed.reason },
    source: parsed.source ?? 'api'
  });

  return { ok: true };
}

export async function resumeWorkflowRunAction(input: unknown) {
  const user = await requireUser();
  initializeWorkflowRuntimeV2();
  const parsed = RunActionInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'admin', knex);

  const waits = await WorkflowRunWaitModelV2.listByRun(knex, parsed.runId);
  const waiting = waits.filter((wait) => wait.status === 'WAITING');
  const primaryWait = waiting[0] ?? null;
  if (waiting.length > 0) {
    const resolvedAt = new Date().toISOString();
    for (const wait of waiting) {
      await WorkflowRunWaitModelV2.update(knex, wait.wait_id, {
        status: 'RESOLVED',
        resolved_at: resolvedAt
      });
    }
  }

  const resumePayload = {
    __admin_override: true,
    reason: parsed.reason,
    waitId: primaryWait?.wait_id ?? null,
    waitType: primaryWait?.wait_type ?? null
  };

  await WorkflowRunModelV2.update(knex, parsed.runId, {
    status: 'RUNNING',
    resume_event_name: primaryWait?.event_name ?? 'ADMIN_RESUME',
    resume_event_payload: resumePayload,
    resume_error: null
  });

  const processedAt = new Date().toISOString();
  const runRecord = await WorkflowRunModelV2.getById(knex, parsed.runId);
  await WorkflowRuntimeEventModelV2.create(knex, {
    tenant_id: runRecord?.tenant_id ?? null,
    event_name: 'ADMIN_RESUME',
    correlation_key: parsed.runId,
    payload: resumePayload,
    processed_at: processedAt,
    matched_run_id: parsed.runId,
    matched_wait_id: primaryWait?.wait_id ?? null,
    matched_step_path: primaryWait?.step_path ?? null
  });

  const runtime = new WorkflowRuntimeV2();
  await runtime.executeRun(knex, parsed.runId, `admin-${user.user_id}`);

  await WorkflowRunModelV2.update(knex, parsed.runId, {
    resume_event_name: primaryWait?.event_name ?? 'ADMIN_RESUME',
    resume_event_payload: resumePayload
  });

  await WorkflowRunLogModelV2.create(knex, {
    run_id: parsed.runId,
    tenant_id: runRecord?.tenant_id ?? null,
    level: 'INFO',
    message: 'Run resumed by operator',
    context_json: {
      reason: parsed.reason,
      waitId: primaryWait?.wait_id ?? null,
      waitType: primaryWait?.wait_type ?? null
    },
    source: parsed.source ?? 'api'
  });

  await auditWorkflowEvent(knex, user, {
    operation: 'workflow_run_resume',
    tableName: 'workflow_runs',
    recordId: parsed.runId,
    changedData: { status: 'RUNNING' },
    details: { reason: parsed.reason },
    source: parsed.source ?? 'api'
  });

  return { ok: true };
}

export async function retryWorkflowRunAction(input: unknown) {
  const user = await requireUser();
  initializeWorkflowRuntimeV2();
  const parsed = RunActionInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'admin', knex);

  const run = await WorkflowRunModelV2.getById(knex, parsed.runId);
  if (!run) {
    return throwHttpError(404, 'Run not found');
  }
  if (run.status !== 'FAILED') {
    return throwHttpError(409, 'Run is not failed');
  }

  const failedStep = await knex('workflow_run_steps')
    .where({ run_id: parsed.runId, status: 'FAILED' })
    .orderBy('completed_at', 'desc')
    .first();
  const nodePath =
    failedStep?.step_path ?? (run.error_json as { nodePath?: string } | null)?.nodePath ?? null;
  if (!nodePath) {
    return throwHttpError(409, 'Failed step not found');
  }

  await WorkflowRunModelV2.update(knex, parsed.runId, {
    status: 'RUNNING',
    node_path: nodePath,
    completed_at: null,
    error_json: null,
    resume_error: null,
    resume_event_name: null,
    resume_event_payload: null
  });

  await WorkflowRunLogModelV2.create(knex, {
    run_id: parsed.runId,
    tenant_id: run.tenant_id ?? null,
    level: 'INFO',
    message: 'Run retry requested',
    context_json: { reason: parsed.reason, nodePath },
    source: parsed.source ?? 'api'
  });

  await auditWorkflowEvent(knex, user, {
    operation: 'workflow_run_retry',
    tableName: 'workflow_runs',
    recordId: parsed.runId,
    changedData: { status: 'RUNNING' },
    details: { reason: parsed.reason, nodePath },
    source: parsed.source ?? 'api'
  });

  const runtime = new WorkflowRuntimeV2();
  await runtime.executeRun(knex, parsed.runId, `admin-retry-${user.user_id}`);

  return { ok: true };
}

export async function replayWorkflowRunAction(input: unknown) {
  const user = await requireUser();
  initializeWorkflowRuntimeV2();
  const parsed = ReplayWorkflowRunInput.parse(input);
  const { knex, tenant } = await createTenantKnex();
  await requireWorkflowPermission(user, 'admin', knex);

  const run = await WorkflowRunModelV2.getById(knex, parsed.runId);
  if (!run) {
    return throwHttpError(404, 'Run not found');
  }

  const runtime = new WorkflowRuntimeV2();
  const newRunId = await runtime.startRun(knex, {
    workflowId: run.workflow_id,
    version: run.workflow_version,
    payload: parsed.payload,
    tenantId: run.tenant_id ?? tenant
  });

  await WorkflowRunLogModelV2.create(knex, {
    run_id: newRunId,
    tenant_id: run.tenant_id ?? tenant,
    level: 'INFO',
    message: 'Run replayed from previous run',
    context_json: { sourceRunId: run.run_id, reason: parsed.reason },
    source: parsed.source ?? 'api'
  });

  await WorkflowRunLogModelV2.create(knex, {
    run_id: run.run_id,
    tenant_id: run.tenant_id ?? null,
    level: 'INFO',
    message: 'Run replay created',
    context_json: { newRunId, reason: parsed.reason },
    source: parsed.source ?? 'api'
  });

  await auditWorkflowEvent(knex, user, {
    operation: 'workflow_run_replay',
    tableName: 'workflow_runs',
    recordId: run.run_id,
    changedData: { replayedRunId: newRunId },
    details: { reason: parsed.reason, newRunId },
    source: parsed.source ?? 'api'
  });

  await runtime.executeRun(knex, newRunId, `admin-replay-${user.user_id}`);

  return { ok: true, runId: newRunId };
}

export async function requeueWorkflowRunEventWaitAction(input: unknown) {
  const user = await requireUser();
  initializeWorkflowRuntimeV2();
  const parsed = RunActionInput.parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'admin', knex);

  const run = await WorkflowRunModelV2.getById(knex, parsed.runId);
  if (!run) {
    return throwHttpError(404, 'Run not found');
  }

  const wait = await knex('workflow_run_waits')
    .where({ run_id: parsed.runId, wait_type: 'event' })
    .orderBy('created_at', 'desc')
    .first();
  if (!wait) {
    return throwHttpError(409, 'No event wait found for run');
  }

  await WorkflowRunWaitModelV2.update(knex, wait.wait_id, {
    status: 'WAITING',
    resolved_at: null
  });

  await WorkflowRunModelV2.update(knex, parsed.runId, {
    status: 'WAITING',
    node_path: wait.step_path ?? run.node_path ?? null,
    completed_at: null,
    error_json: null,
    resume_error: null,
    resume_event_name: null,
    resume_event_payload: null
  });

  await WorkflowRunLogModelV2.create(knex, {
    run_id: parsed.runId,
    tenant_id: run.tenant_id ?? null,
    level: 'INFO',
    message: 'Event wait requeued by operator',
    context_json: { reason: parsed.reason, waitId: wait.wait_id },
    source: parsed.source ?? 'api'
  });

  await auditWorkflowEvent(knex, user, {
    operation: 'workflow_run_requeue_event',
    tableName: 'workflow_runs',
    recordId: parsed.runId,
    changedData: { status: 'WAITING' },
    details: { reason: parsed.reason, waitId: wait.wait_id },
    source: parsed.source ?? 'api'
  });

  return { ok: true };
}

export async function listWorkflowRegistryNodesAction() {
  const user = await requireUser();
  initializeWorkflowRuntimeV2();
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);
  const registry = getNodeTypeRegistry();
  return registry.list().map((node) => ({
    id: node.id,
    ui: node.ui,
    configSchema: zodToJsonSchema(node.configSchema, { name: node.id }),
    examples: node.examples ?? null,
    defaultRetry: node.defaultRetry ?? null
  }));
}

export async function listWorkflowRegistryActionsAction() {
  const user = await requireUser();
  initializeWorkflowRuntimeV2();
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);
  const registry = getActionRegistryV2();
  return registry.list().map((action) => ({
    id: action.id,
    version: action.version,
    sideEffectful: action.sideEffectful,
    retryHint: action.retryHint ?? null,
    idempotency: action.idempotency,
    ui: action.ui,
    inputSchema: zodToJsonSchema(action.inputSchema, { name: `${action.id}@${action.version}.input` }),
    outputSchema: zodToJsonSchema(action.outputSchema, { name: `${action.id}@${action.version}.output` }),
    examples: action.examples ?? null
  }));
}

export async function getWorkflowSchemaAction(input: unknown) {
  const user = await requireUser();
  initializeWorkflowRuntimeV2();
  const parsed = SchemaRefInput.parse(input);
  const registry = getSchemaRegistry();
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);
  if (!registry.has(parsed.schemaRef)) {
    return throwHttpError(404, 'Not found');
  }
  return { ref: parsed.schemaRef, schema: registry.toJsonSchema(parsed.schemaRef) };
}

export async function submitWorkflowEventAction(input: unknown) {
  const user = await requireUser();
  initializeWorkflowRuntimeV2();
  const parsed = SubmitWorkflowEventInput.parse(input);

  const { knex, tenant } = await createTenantKnex();
  await requireWorkflowPermission(user, 'manage', knex);
  let runId: string | null = null;
  let eventRecord: Awaited<ReturnType<typeof WorkflowRuntimeEventModelV2.create>> | null = null;
  let ingestionError: string | null = null;
  const processedAt = new Date().toISOString();

  await knex.transaction(async (trx) => {
    eventRecord = await WorkflowRuntimeEventModelV2.create(trx, {
      tenant_id: tenant,
      event_name: parsed.eventName,
      correlation_key: parsed.correlationKey,
      payload: parsed.payload,
      processed_at: processedAt
    });

    try {
      const wait = await WorkflowRunWaitModelV2.findEventWait(
        trx,
        parsed.eventName,
        parsed.correlationKey,
        tenant,
        ['event', 'human']
      );
      if (!wait) {
        return;
      }

      await WorkflowRunWaitModelV2.update(trx, wait.wait_id, {
        status: 'RESOLVED',
        resolved_at: new Date().toISOString()
      });

      await WorkflowRunModelV2.update(trx, wait.run_id, {
        status: 'RUNNING',
        resume_event_name: parsed.eventName,
        resume_event_payload: parsed.payload
      });

      const stepRecord = await WorkflowRunStepModelV2.getLatestByRunAndPath(trx, wait.run_id, wait.step_path);
      await WorkflowRunLogModelV2.create(trx, {
        run_id: wait.run_id,
        tenant_id: tenant,
        step_id: stepRecord?.step_id ?? null,
        step_path: wait.step_path,
        level: 'INFO',
        message: 'Event wait resolved',
        correlation_key: parsed.correlationKey,
        event_name: parsed.eventName,
        context_json: {
          waitId: wait.wait_id
        },
        source: 'event'
      });

      await WorkflowRuntimeEventModelV2.update(trx, eventRecord.event_id, {
        matched_run_id: wait.run_id,
        matched_wait_id: wait.wait_id,
        matched_step_path: wait.step_path,
        processed_at: processedAt
      });

      runId = wait.run_id;
    } catch (error) {
      ingestionError = error instanceof Error ? error.message : String(error);
      if (eventRecord) {
        await WorkflowRuntimeEventModelV2.update(trx, eventRecord.event_id, {
          error_message: ingestionError,
          processed_at: processedAt
        });
      }
    }
  });

  if (ingestionError) {
    return throwHttpError(500, 'Failed to process workflow event', { error: ingestionError });
  }

  const runtime = new WorkflowRuntimeV2();
  if (runId) {
    await runtime.executeRun(knex, runId, `event-${Date.now()}`);
  }

  const triggered = await WorkflowDefinitionModelV2.list(knex);
  const matching = triggered.filter(
    (workflow) => workflow.trigger?.eventName === parsed.eventName && workflow.status === 'published'
  );

  const schemaRegistry = getSchemaRegistry();
  const startedRuns: string[] = [];
  for (const workflow of matching) {
    const versions = await WorkflowDefinitionVersionModelV2.listByWorkflow(knex, workflow.workflow_id);
    const latest = versions[0];
    if (!latest) continue;
    const schemaRef =
      (latest.definition_json as { payloadSchemaRef?: string } | null | undefined)?.payloadSchemaRef
      ?? workflow.payload_schema_ref;
    if (schemaRef && schemaRegistry.has(schemaRef)) {
      const validation = schemaRegistry.get(schemaRef).safeParse(parsed.payload);
      if (!validation.success) {
        continue;
      }
    }
    const newRunId = await runtime.startRun(knex, {
      workflowId: workflow.workflow_id,
      version: latest.version,
      payload: parsed.payload,
      tenantId: tenant
    });
    startedRuns.push(newRunId);
    await runtime.executeRun(knex, newRunId, `event-${Date.now()}`);
  }

  return { status: runId ? 'resumed' : 'no_wait', runId, startedRuns };
}

export async function listWorkflowEventsAction(input: unknown) {
  const user = await requireUser();
  const parsed = ListWorkflowEventsInput.parse(input ?? {});
  const { knex, tenant } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);

  const rows = await WorkflowRuntimeEventModelV2.list(knex, {
    tenantId: tenant ?? null,
    eventName: parsed.eventName,
    correlationKey: parsed.correlationKey,
    from: parsed.from,
    to: parsed.to,
    status: parsed.status,
    limit: parsed.limit,
    cursor: parsed.cursor
  });

  const hasMore = rows.length > parsed.limit;
  const events = hasMore ? rows.slice(0, parsed.limit) : rows;
  const nextCursor = hasMore ? parsed.cursor + parsed.limit : null;

  const sanitized = events.map((event) => ({
    ...event,
    payload: redactSensitiveValues(event.payload),
    status: event.error_message
      ? 'error'
      : event.matched_run_id
        ? 'matched'
        : 'unmatched'
  }));

  return { events: sanitized, nextCursor };
}

export async function exportWorkflowEventsAction(input: unknown) {
  const rawInput = (input ?? {}) as Record<string, unknown>;
  const format = String(rawInput.format ?? 'csv').toLowerCase() === 'json' ? 'json' : 'csv';
  const result = await listWorkflowEventsAction({
    ...rawInput,
    limit: rawInput.limit ?? EXPORT_EVENTS_LIMIT,
    cursor: 0
  });

  if (format === 'json') {
    return {
      body: JSON.stringify(result.events, null, 2),
      contentType: 'application/json',
      filename: 'workflow-events.json'
    };
  }

  const headers = [
    'event_id',
    'event_name',
    'correlation_key',
    'status',
    'matched_run_id',
    'matched_wait_id',
    'matched_step_path',
    'error_message',
    'created_at',
    'processed_at',
    'payload'
  ];

  const rows = result.events.map((event: any) => [
    event.event_id,
    event.event_name,
    event.correlation_key ?? '',
    event.status,
    event.matched_run_id ?? '',
    event.matched_wait_id ?? '',
    event.matched_step_path ?? '',
    event.error_message ?? '',
    event.created_at,
    event.processed_at ?? '',
    event.payload ? JSON.stringify(event.payload) : ''
  ]);

  return {
    body: buildCsv(headers, rows),
    contentType: 'text/csv',
    filename: 'workflow-events.csv'
  };
}

export async function listWorkflowEventSummaryAction(input: unknown) {
  const user = await requireUser();
  const parsed = ListWorkflowEventsInput.parse(input);
  const { knex, tenant } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);

  const query = knex('workflow_runtime_events')
    .select(
      knex.raw('count(*) as total'),
      knex.raw('count(case when matched_run_id is not null then 1 end) as matched'),
      knex.raw("count(case when matched_run_id is null and error_message is null then 1 end) as unmatched"),
      knex.raw('count(case when error_message is not null then 1 end) as error')
    );

  if (tenant) {
    query.where('tenant_id', tenant);
  }
  if (parsed.eventName) {
    query.where('event_name', parsed.eventName);
  }
  if (parsed.correlationKey) {
    query.where('correlation_key', parsed.correlationKey);
  }
  if (parsed.from) {
    query.where('created_at', '>=', parsed.from);
  }
  if (parsed.to) {
    query.where('created_at', '<=', parsed.to);
  }

  const row = await query.first() as unknown as { total: string | number; matched: string | number; unmatched: string | number; error: string | number } | undefined;
  return {
    total: Number(row?.total ?? 0),
    matched: Number(row?.matched ?? 0),
    unmatched: Number(row?.unmatched ?? 0),
    error: Number(row?.error ?? 0)
  };
}

export async function getWorkflowEventAction(input: unknown) {
  const user = await requireUser();
  const parsed = EventIdInput.parse(input);
  const { knex, tenant } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);

  const event = await WorkflowRuntimeEventModelV2.getById(knex, parsed.eventId);
  if (!event) {
    return throwHttpError(404, 'Event not found');
  }
  if (tenant && event.tenant_id && event.tenant_id !== tenant) {
    return throwHttpError(404, 'Event not found');
  }

  const wait = event.matched_wait_id
    ? await knex('workflow_run_waits').where({ wait_id: event.matched_wait_id }).first()
    : null;
  const run = event.matched_run_id ? await WorkflowRunModelV2.getById(knex, event.matched_run_id) : null;

  return {
    event: {
      ...event,
      payload: redactSensitiveValues(event.payload),
      status: event.error_message
        ? 'error'
        : event.matched_run_id
          ? 'matched'
          : 'unmatched'
    },
    wait,
    run
  };
}
