'use server';

import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { EventCatalogModel } from 'server/src/models/eventCatalog';
import { getSchemaRegistry } from '@shared/workflow/runtime';
import { initializeWorkflowRuntimeV2 } from '@shared/workflow/runtime/init';
import WorkflowDefinitionModelV2 from '@shared/workflow/persistence/workflowDefinitionModelV2';
import WorkflowDefinitionVersionModelV2 from '@shared/workflow/persistence/workflowDefinitionVersionModelV2';
import { auditLog } from 'server/src/lib/logging/auditLog';
import { submitWorkflowEventAction, createWorkflowDefinitionAction, publishWorkflowDefinitionAction } from 'server/src/lib/actions/workflow-runtime-v2-actions';
import { createEventCatalogEntry } from 'server/src/lib/actions/event-catalog-actions';

type PermissionLevel = 'read' | 'manage' | 'publish' | 'admin';

const SENSITIVE_KEY_PATTERN = /(secret|token|password|api[_-]?key|authorization)/i;

const requireUser = async () => {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }
  return user;
};

const requireWorkflowPermission = async (
  user: Awaited<ReturnType<typeof getCurrentUser>>,
  action: PermissionLevel,
  knex: Awaited<ReturnType<typeof createTenantKnex>>['knex']
) => {
  const allowed = await hasPermission(user!, 'workflow', action as any, knex);
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
  throw new Error('Forbidden');
};

const audit = async (
  knex: Awaited<ReturnType<typeof createTenantKnex>>['knex'],
  user: Awaited<ReturnType<typeof getCurrentUser>>,
  params: {
    operation: string;
    tableName: string;
    recordId: string;
    changedData?: Record<string, unknown>;
    details?: Record<string, unknown>;
    source?: string | null;
  }
) => {
  if (!user) return;
  await auditLog(knex, {
    userId: user.user_id,
    operation: params.operation,
    tableName: params.tableName,
    recordId: params.recordId,
    changedData: params.changedData ?? {},
    details: {
      ...params.details,
      actorRoles: user.roles?.map((r) => r.role_name) ?? [],
      source: params.source ?? 'ui'
    }
  });
};

export type WorkflowEventCatalogEntryV2 = {
  event_id: string;
  event_type: string;
  name: string;
  description?: string | null;
  category?: string | null;
  payload_schema_ref?: string | null;
  payload_schema?: Record<string, unknown> | null;
  payload_schema_ref_status: 'known' | 'unknown' | 'missing';
  source: 'system' | 'tenant';
  status: 'active' | 'beta' | 'draft' | 'deprecated';
  attached_workflows_count: number;
  metrics_7d: {
    executions: number | null;
    successRate: number | null;
    avgLatencyMs: number | null;
  };
};

export type WorkflowEventCatalogOptionV2 = {
  event_id: string;
  event_type: string;
  name: string;
  description?: string | null;
  category?: string | null;
  payload_schema_ref?: string | null;
  payload_schema_ref_status: 'known' | 'unknown' | 'missing';
  source: 'system' | 'tenant';
  status: 'active' | 'beta' | 'draft' | 'deprecated';
};

const STATUS_VALUES = ['active', 'beta', 'draft', 'deprecated'] as const;
type CatalogStatus = (typeof STATUS_VALUES)[number];

const normalizeStatus = (entry: any): CatalogStatus => {
  const raw = typeof entry?.status === 'string' ? entry.status.toLowerCase() : null;
  if (raw && (STATUS_VALUES as readonly string[]).includes(raw)) return raw as CatalogStatus;
  return 'active';
};

const normalizeCategory = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const toIso = (d: Date) => d.toISOString();

const buildDefaultRange = () => {
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { from: toIso(from), to: toIso(to) };
};

const redactSensitiveValues = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitiveValues(entry));
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      if (key === 'secretRef' || SENSITIVE_KEY_PATTERN.test(key)) {
        result[key] = '***';
      } else {
        result[key] = redactSensitiveValues(val);
      }
    }
    return result;
  }
  return value;
};

export async function listEventCatalogCategoriesV2Action() {
  const user = await requireUser();
  const { knex, tenant } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);
  if (!tenant) return { categories: [] as string[] };

  const tenantRows = await knex('event_catalog')
    .distinct('category')
    .whereNotNull('category')
    .where({ tenant })
    .orderBy('category', 'asc');

  const systemRows = await knex('system_event_catalog')
    .distinct('category')
    .whereNotNull('category')
    .orderBy('category', 'asc');

  const set = new Set<string>();
  tenantRows.forEach((r: any) => {
    if (typeof r.category === 'string' && r.category.trim()) set.add(r.category.trim());
  });
  systemRows.forEach((r: any) => {
    if (typeof r.category === 'string' && r.category.trim()) set.add(r.category.trim());
  });

  return { categories: Array.from(set).sort((a, b) => a.localeCompare(b)) };
}

export async function listEventCatalogOptionsV2Action(input: unknown) {
  initializeWorkflowRuntimeV2();
  const user = await requireUser();
  const parsed = z.object({
    search: z.string().optional(),
    source: z.enum(['all', 'system', 'tenant']).optional().default('all'),
    status: z.enum(['all', ...STATUS_VALUES]).optional().default('all'),
    limit: z.number().int().min(1).max(2000).optional().default(500)
  }).parse(input ?? {});

  const { knex, tenant } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);
  if (!tenant) return { events: [] as WorkflowEventCatalogOptionV2[] };

  const all = await EventCatalogModel.getAll(knex, tenant, {});
  const schemaRegistry = getSchemaRegistry();

  const searchLower = parsed.search?.trim().toLowerCase() ?? '';

  let events = all.map((entry: any) => {
    const isSystem = !entry.tenant;
    const schemaRef = typeof entry.payload_schema_ref === 'string' ? entry.payload_schema_ref : null;
    const payload_schema_ref_status: WorkflowEventCatalogOptionV2['payload_schema_ref_status'] =
      !schemaRef ? 'missing' : (schemaRegistry.has(schemaRef) ? 'known' : 'unknown');

    return {
      event_id: String(entry.event_id),
      event_type: String(entry.event_type),
      name: String(entry.name),
      description: entry.description ?? null,
      category: normalizeCategory(entry.category),
      payload_schema_ref: schemaRef,
      payload_schema_ref_status,
      source: isSystem ? 'system' : 'tenant',
      status: normalizeStatus(entry)
    } satisfies WorkflowEventCatalogOptionV2;
  });

  if (parsed.source !== 'all') {
    events = events.filter((e) => e.source === parsed.source);
  }
  if (parsed.status !== 'all') {
    events = events.filter((e) => e.status === parsed.status);
  }
  if (searchLower) {
    events = events.filter((e) => {
      const hay = `${e.name} ${e.event_type} ${e.description ?? ''} ${e.category ?? ''}`.toLowerCase();
      return hay.includes(searchLower);
    });
  }

  events.sort((a, b) => {
    const ca = (a.category ?? '').toLowerCase();
    const cb = (b.category ?? '').toLowerCase();
    if (ca !== cb) return ca.localeCompare(cb);
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });

  return { events: events.slice(0, parsed.limit) };
}

export async function listEventCatalogWithMetricsAction(input: unknown) {
  initializeWorkflowRuntimeV2();
  const user = await requireUser();
  const parsed = z.object({
    search: z.string().optional(),
    category: z.string().optional(),
    status: z.enum(['all', ...STATUS_VALUES]).optional().default('all'),
    source: z.enum(['all', 'system', 'tenant']).optional().default('all'),
    sort: z.enum(['category_name', 'most_active']).optional().default('category_name'),
    limit: z.number().int().min(1).max(200).optional().default(24),
    offset: z.number().int().min(0).optional().default(0),
    metricsFrom: z.string().optional(),
    metricsTo: z.string().optional()
  }).parse(input ?? {});

  const { knex, tenant } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);
  if (!tenant) {
    return { events: [], total: 0 };
  }

  // Load catalog entries (system + tenant) in one shot via model (handles system fallback).
  const all = await EventCatalogModel.getAll(knex, tenant, {});
  const schemaRegistry = getSchemaRegistry();

  const searchLower = parsed.search?.trim().toLowerCase() ?? '';
  const category = normalizeCategory(parsed.category);

  let filtered = all.map((entry: any) => {
    const isSystem = !entry.tenant;
    return {
      ...entry,
      source: isSystem ? 'system' : 'tenant',
      status: normalizeStatus(entry),
      category: normalizeCategory(entry.category),
      payload_schema_ref: typeof entry.payload_schema_ref === 'string' ? entry.payload_schema_ref : null,
      payload_schema: (entry as any).payload_schema ?? null
    };
  });

  if (parsed.source !== 'all') {
    filtered = filtered.filter((e: any) => e.source === parsed.source);
  }
  if (parsed.status !== 'all') {
    filtered = filtered.filter((e: any) => e.status === parsed.status);
  }
  if (category) {
    filtered = filtered.filter((e: any) => normalizeCategory(e.category) === category);
  }
  if (searchLower) {
    filtered = filtered.filter((e: any) => {
      const hay = `${e.name ?? ''} ${e.event_type ?? ''} ${e.description ?? ''} ${e.category ?? ''}`.toLowerCase();
      return hay.includes(searchLower);
    });
  }

  const total = filtered.length;

  const range = {
    from: parsed.metricsFrom ?? buildDefaultRange().from,
    to: parsed.metricsTo ?? buildDefaultRange().to
  };

  const computeMapsForEventTypes = async (eventTypes: string[]) => {
    const attachedRows = eventTypes.length
      ? await knex('workflow_definitions')
        .select(knex.raw("trigger->>'eventName' as event_type"))
        .count('* as count')
        .where({ status: 'published' })
        .whereRaw("trigger->>'eventName' is not null")
        .whereIn(knex.raw("trigger->>'eventName'") as any, eventTypes)
        .groupByRaw("trigger->>'eventName'")
      : [];

    const attachedMap = new Map<string, number>();
    attachedRows.forEach((row: any) => attachedMap.set(String(row.event_type), Number(row.count ?? 0)));

    const execRows = eventTypes.length
      ? await knex('workflow_runtime_events')
        .select('event_name')
        .count('* as count')
        .where({ tenant_id: tenant })
        .whereIn('event_name', eventTypes)
        .where('created_at', '>=', range.from)
        .where('created_at', '<=', range.to)
        .groupBy('event_name')
      : [];

    const execMap = new Map<string, number>();
    execRows.forEach((row: any) => execMap.set(String(row.event_name), Number(row.count ?? 0)));

    const runRows = eventTypes.length
      ? await knex('workflow_runs')
        .select(
          'event_type',
          knex.raw('count(*)::int as total'),
          knex.raw("count(case when status = 'SUCCEEDED' then 1 end)::int as succeeded"),
          knex.raw("avg(case when completed_at is not null then extract(epoch from (completed_at - started_at)) * 1000 end) as avg_ms")
        )
        .where({ tenant_id: tenant })
        .whereIn('event_type', eventTypes)
        .where('started_at', '>=', range.from)
        .where('started_at', '<=', range.to)
        .groupBy('event_type')
      : [];

    const runMap = new Map<string, { total: number; succeeded: number; avgMs: number | null }>();
    runRows.forEach((row: any) => {
      runMap.set(String(row.event_type), {
        total: Number(row.total ?? 0),
        succeeded: Number(row.succeeded ?? 0),
        avgMs: row.avg_ms == null ? null : Number(row.avg_ms)
      });
    });

    return { attachedMap, execMap, runMap };
  };

  const buildEntry = (entry: any, maps: Awaited<ReturnType<typeof computeMapsForEventTypes>>) => {
    const eventType = String(entry.event_type);
    const runs = maps.runMap.get(eventType) ?? null;
    const succeeded = runs ? runs.succeeded : 0;
    const totalRuns = runs ? runs.total : 0;
    const successRate = totalRuns > 0 ? succeeded / totalRuns : null;
    const schemaRef = entry.payload_schema_ref ?? null;
    const payload_schema_ref_status: WorkflowEventCatalogEntryV2['payload_schema_ref_status'] =
      !schemaRef ? 'missing' : (schemaRegistry.has(schemaRef) ? 'known' : 'unknown');

    return {
      event_id: String(entry.event_id),
      event_type: eventType,
      name: String(entry.name),
      description: entry.description ?? null,
      category: entry.category ?? null,
      payload_schema_ref: entry.payload_schema_ref ?? null,
      payload_schema: entry.payload_schema ?? null,
      payload_schema_ref_status,
      source: entry.source,
      status: entry.status,
      attached_workflows_count: maps.attachedMap.get(eventType) ?? 0,
      metrics_7d: {
        executions: maps.execMap.get(eventType) ?? 0,
        successRate,
        avgLatencyMs: runs?.avgMs ?? null
      }
    } satisfies WorkflowEventCatalogEntryV2;
  };

  if (parsed.sort === 'most_active') {
    const eventTypes = filtered.map((e: any) => String(e.event_type));
    const maps = await computeMapsForEventTypes(eventTypes);
    const enriched = filtered.map((entry: any) => buildEntry(entry, maps));
    enriched.sort((a, b) => {
      const ea = a.metrics_7d.executions ?? 0;
      const eb = b.metrics_7d.executions ?? 0;
      if (eb !== ea) return eb - ea;
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });
    const events = enriched.slice(parsed.offset, parsed.offset + parsed.limit);
    return { events, total };
  }

  // Default: category/name sorting does not depend on metrics; compute metrics only for the returned page.
  filtered.sort((a: any, b: any) => {
    const ca = (a.category ?? '').toLowerCase();
    const cb = (b.category ?? '').toLowerCase();
    if (ca !== cb) return ca.localeCompare(cb);
    return String(a.name ?? '').toLowerCase().localeCompare(String(b.name ?? '').toLowerCase());
  });

  const page = filtered.slice(parsed.offset, parsed.offset + parsed.limit);
  const pageEventTypes = page.map((e: any) => String(e.event_type));
  const maps = await computeMapsForEventTypes(pageEventTypes);
  const events: WorkflowEventCatalogEntryV2[] = page.map((entry: any) => buildEntry(entry, maps));
  return { events, total };
}

export async function listSchemaRegistryRefsAction() {
  initializeWorkflowRuntimeV2();
  const user = await requireUser();
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);
  const registry = getSchemaRegistry();
  return { refs: registry.listRefs() };
}

export async function getEventCatalogPermissionsAction() {
  const user = await requireUser();
  const { knex } = await createTenantKnex();

  const canAdmin = await hasPermission(user, 'workflow', 'admin', knex);
  const canPublish = canAdmin || await hasPermission(user, 'workflow', 'publish', knex);
  const canManage = canAdmin || await hasPermission(user, 'workflow', 'manage', knex);
  const canRead =
    canAdmin ||
    canManage ||
    canPublish ||
    await hasPermission(user, 'workflow', 'read', knex) ||
    await hasPermission(user, 'workflow', 'view', knex);

  return { canRead, canManage, canPublish, canAdmin };
}

export async function listAttachedWorkflowsByEventTypeAction(input: unknown) {
  const user = await requireUser();
  const parsed = z.object({ eventType: z.string().min(1) }).parse(input);
  const { knex, tenant } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);

  const rows = await knex('workflow_definitions')
    .select(
      'workflow_id',
      'name',
      'status',
      'is_system',
      'is_paused',
      'is_visible'
    )
    .where({ status: 'published' })
    .whereRaw("trigger->>'eventName' = ?", [parsed.eventType]);

  // published version is max from versions table
  const ids = rows.map((r: any) => r.workflow_id);
  const versions = ids.length
    ? await knex('workflow_definition_versions')
      .select('workflow_id')
      .max('version as published_version')
      .whereIn('workflow_id', ids)
      .groupBy('workflow_id')
    : [];
  const versionMap = new Map<string, number>();
  versions.forEach((r: any) => versionMap.set(String(r.workflow_id), Number(r.published_version ?? 0)));

  const canAdmin = await hasPermission(user, 'workflow', 'admin', knex);
  const visible = canAdmin ? rows : rows.filter((r: any) => r.is_visible !== false);

  return {
    workflows: visible.map((r: any) => ({
      workflow_id: String(r.workflow_id),
      name: String(r.name),
      status: String(r.status),
      published_version: versionMap.get(String(r.workflow_id)) ?? null,
      is_system: Boolean(r.is_system),
      is_paused: Boolean(r.is_paused),
      is_visible: r.is_visible !== false
    }))
  };
}

export async function getEventSchemaByRefAction(input: unknown) {
  initializeWorkflowRuntimeV2();
  const user = await requireUser();
  const parsed = z.object({ schemaRef: z.string().min(1) }).parse(input);
  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);
  const registry = getSchemaRegistry();
  if (!registry.has(parsed.schemaRef)) {
    return { ref: parsed.schemaRef, schema: null };
  }
  return { ref: parsed.schemaRef, schema: registry.toJsonSchema(parsed.schemaRef) };
}

export async function simulateWorkflowEventAction(input: unknown) {
  const user = await requireUser();
  const parsed = z.object({
    eventName: z.string().min(1),
    payload: z.record(z.any()).optional().default({}),
    correlationKey: z.string().optional(),
    payloadSchemaRef: z.string().optional()
  }).parse(input);

  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'manage', knex);

  const result = await submitWorkflowEventAction({
    eventName: parsed.eventName,
    correlationKey: parsed.correlationKey,
    payload: parsed.payload,
    payloadSchemaRef: parsed.payloadSchemaRef
  });

  await audit(knex, user, {
    operation: 'workflow_event_simulate',
    tableName: 'workflow_runtime_events',
    recordId: uuidv4(),
    changedData: { eventName: parsed.eventName },
    details: {
      correlationKey: parsed.correlationKey ?? null,
      payloadSchemaRef: parsed.payloadSchemaRef ?? null,
      startedRuns: (result as any)?.startedRuns ?? [],
      status: (result as any)?.status ?? null
    },
    source: 'ui'
  });

  return result;
}

export async function createWorkflowFromEventAction(input: unknown) {
  const user = await requireUser();
  const parsed = z.object({
    eventType: z.string().min(1),
    name: z.string().trim().min(1).optional(),
    payloadSchemaRef: z.string().trim().optional(),
    sourcePayloadSchemaRef: z.string().trim().optional()
  }).parse(input);

  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'manage', knex);

  const workflowName = parsed.name ?? `New workflow for ${parsed.eventType}`;
  const definition = {
    id: uuidv4(),
    version: 1,
    name: workflowName,
    description: '',
    payloadSchemaRef: parsed.payloadSchemaRef ?? '',
    trigger: {
      type: 'event',
      eventName: parsed.eventType,
      ...(parsed.sourcePayloadSchemaRef ? { sourcePayloadSchemaRef: parsed.sourcePayloadSchemaRef } : {})
    },
    steps: []
  };

  const created = await createWorkflowDefinitionAction({ definition });

  await audit(knex, user, {
    operation: 'workflow_event_attach_new_workflow',
    tableName: 'workflow_definitions',
    recordId: created.workflowId,
    changedData: { triggerEventName: parsed.eventType },
    details: { payloadSchemaRef: parsed.payloadSchemaRef ?? null },
    source: 'ui'
  });

  return created;
}

export async function detachWorkflowTriggerFromEventAction(input: unknown) {
  const user = await requireUser();
  const parsed = z.object({
    workflowId: z.string().uuid(),
    eventType: z.string().min(1)
  }).parse(input);

  const { knex } = await createTenantKnex();
  await requireWorkflowPermission(user, 'publish', knex);

  const workflow = await WorkflowDefinitionModelV2.getById(knex, parsed.workflowId);
  if (!workflow) {
    throw new Error('Workflow not found');
  }
  if (workflow.is_system) {
    await requireWorkflowPermission(user, 'admin', knex);
  }

  // Get latest published version definition.
  const versions = await WorkflowDefinitionVersionModelV2.listByWorkflow(knex, parsed.workflowId);
  const latest = versions[0];
  if (!latest) {
    throw new Error('Workflow has no published versions');
  }
  const nextVersion = Number(latest.version) + 1;
  const definition = latest.definition_json as any;
  const nextDefinition = {
    ...definition,
    version: nextVersion,
    trigger: null
  };

  const publishResult = await publishWorkflowDefinitionAction({
    workflowId: parsed.workflowId,
    version: nextVersion,
    definition: nextDefinition
  });

  await audit(knex, user, {
    operation: 'workflow_event_detach',
    tableName: 'workflow_definitions',
    recordId: parsed.workflowId,
    changedData: { triggerRemoved: true },
    details: {
      eventType: parsed.eventType,
      publishedVersion: nextVersion,
      publishOk: (publishResult as any)?.ok ?? null
    },
    source: 'ui'
  });

  return publishResult;
}

export async function createCustomEventAction(input: unknown) {
  initializeWorkflowRuntimeV2();
  const user = await requireUser();
  const parsed = z.object({
    eventType: z.string().trim().min(1),
    name: z.string().trim().min(1),
    description: z.string().optional(),
    category: z.string().optional(),
    payloadSchemaRef: z.string().trim().optional(),
    payloadSchemaJson: z.record(z.any()).optional()
  }).parse(input);

  const { knex, tenant } = await createTenantKnex();
  await requireWorkflowPermission(user, 'manage', knex);
  if (!tenant) throw new Error('Missing tenant');

  const existing = await EventCatalogModel.getByEventType(knex, parsed.eventType, tenant);
  if (existing && (existing as any)?.tenant) {
    throw new Error(`Event type "${parsed.eventType}" already exists for this tenant`);
  }

  if (parsed.payloadSchemaRef) {
    const registry = getSchemaRegistry();
    if (!registry.has(parsed.payloadSchemaRef)) {
      throw new Error(`Unknown schema ref "${parsed.payloadSchemaRef}"`);
    }
  } else if (!parsed.payloadSchemaJson) {
    throw new Error('Provide payloadSchemaRef or payloadSchemaJson');
  }

  const entry = await createEventCatalogEntry({
    event_type: parsed.eventType as any,
    name: parsed.name,
    description: parsed.description,
    category: parsed.category,
    payload_schema: (parsed.payloadSchemaJson ?? {}) as any,
    payload_schema_ref: parsed.payloadSchemaRef,
    tenant
  } as any);

  await audit(knex, user, {
    operation: 'workflow_event_custom_create',
    tableName: 'event_catalog',
    recordId: (entry as any)?.event_id ?? uuidv4(),
    changedData: { eventType: parsed.eventType },
    details: { payloadSchemaRef: parsed.payloadSchemaRef ?? null },
    source: 'ui'
  });

  return entry;
}

export async function getEventMetricsAction(input: unknown) {
  const user = await requireUser();
  const parsed = z.object({
    eventType: z.string().min(1),
    from: z.string().optional(),
    to: z.string().optional(),
    recentLimit: z.number().int().min(1).max(200).optional().default(25),
    recentOffset: z.number().int().min(0).optional().default(0)
  }).parse(input ?? {});

  const { knex, tenant } = await createTenantKnex();
  await requireWorkflowPermission(user, 'read', knex);
  if (!tenant) {
    return { summary: null, series: [], recent: [], runStats: null };
  }

  const range = {
    from: parsed.from ?? buildDefaultRange().from,
    to: parsed.to ?? buildDefaultRange().to
  };

  const summaryRow = await knex('workflow_runtime_events')
    .select(
      knex.raw('count(*)::int as total'),
      knex.raw('count(case when matched_run_id is not null then 1 end)::int as matched'),
      knex.raw("count(case when matched_run_id is null and error_message is null then 1 end)::int as unmatched"),
      knex.raw('count(case when error_message is not null then 1 end)::int as error')
    )
    .where({ tenant_id: tenant, event_name: parsed.eventType })
    .where('created_at', '>=', range.from)
    .where('created_at', '<=', range.to)
    .first();

  const seriesRows = await knex('workflow_runtime_events')
    .select(knex.raw("date_trunc('day', created_at) as day"))
    .count('* as count')
    .where({ tenant_id: tenant, event_name: parsed.eventType })
    .where('created_at', '>=', range.from)
    .where('created_at', '<=', range.to)
    .groupByRaw("date_trunc('day', created_at)")
    .orderBy('day', 'asc');

  const runStatsRow = await knex('workflow_runs')
    .select(
      knex.raw('count(*)::int as total'),
      knex.raw("count(case when status = 'SUCCEEDED' then 1 end)::int as succeeded"),
      knex.raw("avg(case when completed_at is not null then extract(epoch from (completed_at - started_at)) * 1000 end) as avg_ms")
    )
    .where({ tenant_id: tenant, event_type: parsed.eventType })
    .where('started_at', '>=', range.from)
    .where('started_at', '<=', range.to)
    .first();

  const recentRows = await knex('workflow_runtime_events')
    .select(
      'event_id',
      'event_name',
      'correlation_key',
      'payload_schema_ref',
      'schema_ref_conflict',
      'created_at',
      'processed_at',
      'matched_run_id',
      'error_message',
      'payload'
    )
    .where({ tenant_id: tenant, event_name: parsed.eventType })
    .where('created_at', '>=', range.from)
    .where('created_at', '<=', range.to)
    .orderBy('created_at', 'desc')
    .orderBy('event_id', 'desc')
    .limit(parsed.recentLimit)
    .offset(parsed.recentOffset);

  const totalRecent = Number(summaryRow?.total ?? 0);
  const recent = recentRows.map((row: any) => ({
    ...row,
    payload: redactSensitiveValues(row.payload ?? null),
    status: row.error_message
      ? 'error'
      : row.matched_run_id
        ? 'matched'
        : 'unmatched'
  }));

  return {
    range,
    summary: summaryRow ? {
      total: Number(summaryRow.total ?? 0),
      matched: Number(summaryRow.matched ?? 0),
      unmatched: Number(summaryRow.unmatched ?? 0),
      error: Number(summaryRow.error ?? 0)
    } : null,
    runStats: runStatsRow ? {
      total: Number(runStatsRow.total ?? 0),
      succeeded: Number(runStatsRow.succeeded ?? 0),
      successRate: Number(runStatsRow.total ?? 0) > 0 ? Number(runStatsRow.succeeded ?? 0) / Number(runStatsRow.total ?? 0) : null,
      avgDurationMs: runStatsRow.avg_ms == null ? null : Number(runStatsRow.avg_ms)
    } : null,
    series: seriesRows.map((row: any) => ({
      day: row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day).slice(0, 10),
      count: Number(row.count ?? 0)
    })),
    recent,
    recentTotal: totalRecent
  };
}
