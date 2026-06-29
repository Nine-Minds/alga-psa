import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { TaggedEntityType } from '@alga-psa/types';
import TagMapping from '@alga-psa/tags/models/tagMapping';
import type { ProjectWebhookInternalEvent } from './webhookProjectEventMap';

const PROJECT_WEBHOOK_CACHE_TTL_MS = 60_000;
const PROJECT_WEBHOOK_CACHE_MAX_ENTRIES = 256;
const PROJECT_TASK_TAGGED_ENTITY_TYPE: TaggedEntityType = 'project_task';

type NormalizedWebhookChange = {
  previous: unknown;
  new: unknown;
};

export type ProjectWebhookPhasePayload = {
  phase_id: string;
  phase_name: string | null;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  status_id: string | null;
  status_name: string | null;
  order_key: string | null;
  order_number: number | null;
  wbs_code: string | null;
};

export type ProjectWebhookTaskCountsPayload = {
  total: number;
  completed: number;
  overdue: number;
  by_status: Record<string, number>;
};

export type ProjectWebhookPayload = {
  project_id: string;
  project_name: string | null;
  wbs_code: string | null;
  description: string | null;
  status_id: string | null;
  status_name: string | null;
  is_closed: boolean;
  client_id: string | null;
  client_name: string | null;
  contact_name_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  start_date: string | null;
  end_date: string | null;
  budgeted_hours: number | null;
  url: string;
  previous_status_id?: string | null;
  previous_status_name?: string | null;
  changes?: Record<string, NormalizedWebhookChange>;
  phases?: ProjectWebhookPhasePayload[];
  task_counts?: ProjectWebhookTaskCountsPayload;
};

export type ProjectTaskWebhookPayload = {
  project_id: string;
  project_name: string | null;
  client_id: string | null;
  client_name: string | null;
  task_id: string;
  phase_id: string | null;
  phase_name: string | null;
  task_name: string | null;
  description: string | null;
  status_id: string | null;
  status_name: string | null;
  is_closed: boolean;
  assigned_to: string | null;
  assigned_to_name: string | null;
  estimated_hours: number | null;
  actual_hours: number | null;
  due_date: string | null;
  priority_id: string | null;
  priority_name: string | null;
  wbs_code: string | null;
  url: string;
  tags: string[];
  previous_status_id?: string | null;
  previous_status_name?: string | null;
  changes?: Record<string, NormalizedWebhookChange>;
};

type ProjectWebhookRow = Omit<ProjectWebhookPayload, 'url' | 'changes' | 'phases' | 'task_counts'>;
type ProjectTaskWebhookRow = Omit<ProjectTaskWebhookPayload, 'url' | 'tags' | 'changes'>;
type CachedProjectWebhookPayload = Omit<ProjectWebhookPayload, 'changes' | 'phases' | 'task_counts'>;
type CachedProjectTaskWebhookPayload = Omit<ProjectTaskWebhookPayload, 'changes'>;

export type ProjectWebhookSourceEvent = {
  eventType: ProjectWebhookInternalEvent;
  timestamp?: string;
  payload: {
    tenantId: string;
    projectId: string;
    projectTaskId?: string;
    taskId?: string;
    occurredAt?: string;
    changes?: unknown;
    previousStatusId?: string;
    previousStatus?: string;
    [key: string]: unknown;
  };
};

const projectWebhookCache = new Map<
  string,
  { value: CachedProjectWebhookPayload; expiresAt: number }
>();

const projectTaskWebhookCache = new Map<
  string,
  { value: CachedProjectTaskWebhookPayload; expiresAt: number }
>();

export async function buildProjectWebhookPayload(
  internalEvent: ProjectWebhookSourceEvent,
  knex: Knex
): Promise<ProjectWebhookPayload> {
  const tenantId = internalEvent.payload.tenantId;
  const projectId = internalEvent.payload.projectId;

  if (!tenantId || !projectId) {
    throw new Error('Project webhook payload requires payload.tenantId and payload.projectId');
  }

  const payload: ProjectWebhookPayload = {
    ...(await getCachedProjectWebhookPayload(knex, tenantId, projectId)),
  };

  if (internalEvent.eventType === 'PROJECT_STATUS_CHANGED') {
    // PROJECT_STATUS_CHANGED carries `previousStatus` as a project status id
    // (the `projects.status` column is a status_id), so resolve the name from
    // that id rather than treating the raw value as a display name.
    const previousStatusId = resolvePreviousProjectStatusId(internalEvent);
    payload.previous_status_id = previousStatusId;
    payload.previous_status_name = previousStatusId
      ? await fetchProjectStatusName(knex, tenantId, previousStatusId)
      : null;
  }

  const changes = normalizeChanges(internalEvent.payload.changes);
  if (changes && internalEvent.eventType === 'PROJECT_UPDATED') {
    payload.changes = changes;
  }

  return payload;
}

export async function buildProjectTaskWebhookPayload(
  internalEvent: ProjectWebhookSourceEvent,
  knex: Knex
): Promise<ProjectTaskWebhookPayload> {
  const tenantId = internalEvent.payload.tenantId;
  const taskId = resolveTaskId(internalEvent);

  if (!tenantId || !taskId) {
    throw new Error('Project task webhook payload requires payload.tenantId and payload.projectTaskId/taskId');
  }

  const payload: ProjectTaskWebhookPayload = {
    ...(await getCachedProjectTaskWebhookPayload(knex, tenantId, taskId)),
  };

  if (internalEvent.eventType === 'PROJECT_TASK_STATUS_CHANGED') {
    // PROJECT_TASK_STATUS_CHANGED carries `previousStatus` as an already
    // resolved status name (project_status_mappings -> custom_name/status
    // name); the previous mapping id is not in the event, so `previous_status_id`
    // is only populated when an explicit id is supplied.
    payload.previous_status_id = resolveExplicitPreviousStatusId(internalEvent);
    payload.previous_status_name = resolvePreviousStatusName(internalEvent);
  }

  const changes = normalizeChanges(internalEvent.payload.changes);
  if (changes && internalEvent.eventType === 'PROJECT_TASK_UPDATED') {
    payload.changes = changes;

    // F008 tag mutations emit PROJECT_TASK_UPDATED with changes.tags carrying
    // the authoritative post-change tag set. The cached `tags` snapshot can be
    // up to PROJECT_WEBHOOK_CACHE_TTL_MS stale, so reconcile the body with the
    // diff to avoid a payload that contradicts its own changes.tags.new.
    const newTags = changes.tags?.new;
    if (Array.isArray(newTags) && newTags.every((tag) => typeof tag === 'string')) {
      payload.tags = newTags as string[];
    }
  }

  return payload;
}

export function clearProjectWebhookPayloadCache(): void {
  projectWebhookCache.clear();
  projectTaskWebhookCache.clear();
}

async function getCachedProjectWebhookPayload(
  knex: Knex,
  tenantId: string,
  projectId: string
): Promise<CachedProjectWebhookPayload> {
  return getCached(projectWebhookCache, `${tenantId}:${projectId}`, () =>
    fetchProjectWebhookPayload(knex, tenantId, projectId)
  );
}

async function getCachedProjectTaskWebhookPayload(
  knex: Knex,
  tenantId: string,
  taskId: string
): Promise<CachedProjectTaskWebhookPayload> {
  return getCached(projectTaskWebhookCache, `${tenantId}:${taskId}`, () =>
    fetchProjectTaskWebhookPayload(knex, tenantId, taskId)
  );
}

async function getCached<T>(
  cache: Map<string, { value: T; expiresAt: number }>,
  cacheKey: string,
  fetcher: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const cached = cache.get(cacheKey);

  if (cached && cached.expiresAt > now) {
    cache.delete(cacheKey);
    cache.set(cacheKey, cached);
    return cached.value;
  }

  const value = await fetcher();
  cache.set(cacheKey, {
    value,
    expiresAt: now + PROJECT_WEBHOOK_CACHE_TTL_MS,
  });

  while (cache.size > PROJECT_WEBHOOK_CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }

  return value;
}

async function fetchProjectWebhookPayload(
  knex: Knex,
  tenantId: string,
  projectId: string
): Promise<CachedProjectWebhookPayload> {
  const project = await fetchProjectWebhookRow(knex, tenantId, projectId);

  if (!project) {
    throw new Error(`Project ${projectId} not found for tenant ${tenantId}`);
  }

  return {
    project_id: project.project_id,
    project_name: project.project_name ?? null,
    wbs_code: project.wbs_code ?? null,
    description: project.description ?? null,
    status_id: project.status_id ?? null,
    status_name: project.status_name ?? null,
    is_closed: Boolean(project.is_closed),
    client_id: project.client_id ?? null,
    client_name: project.client_name ?? null,
    contact_name_id: project.contact_name_id ?? null,
    contact_name: project.contact_name ?? null,
    contact_email: project.contact_email ?? null,
    assigned_to: project.assigned_to ?? null,
    assigned_to_name: project.assigned_to_name ?? null,
    start_date: toIsoStringOrNull(project.start_date),
    end_date: toIsoStringOrNull(project.end_date),
    budgeted_hours: numberOrNull(project.budgeted_hours),
    url: buildProjectUrl(project.project_id),
  };
}

async function fetchProjectTaskWebhookPayload(
  knex: Knex,
  tenantId: string,
  taskId: string
): Promise<CachedProjectTaskWebhookPayload> {
  const [task, tags] = await Promise.all([
    fetchProjectTaskWebhookRow(knex, tenantId, taskId),
    fetchProjectTaskTags(knex, tenantId, taskId),
  ]);

  if (!task) {
    throw new Error(`Project task ${taskId} not found for tenant ${tenantId}`);
  }

  return {
    project_id: task.project_id,
    project_name: task.project_name ?? null,
    client_id: task.client_id ?? null,
    client_name: task.client_name ?? null,
    task_id: task.task_id,
    phase_id: task.phase_id ?? null,
    phase_name: task.phase_name ?? null,
    task_name: task.task_name ?? null,
    description: task.description ?? null,
    status_id: task.status_id ?? null,
    status_name: task.status_name ?? null,
    is_closed: Boolean(task.is_closed),
    assigned_to: task.assigned_to ?? null,
    assigned_to_name: task.assigned_to_name ?? null,
    estimated_hours: numberOrNull(task.estimated_hours),
    actual_hours: numberOrNull(task.actual_hours),
    due_date: toIsoStringOrNull(task.due_date),
    priority_id: task.priority_id ?? null,
    priority_name: task.priority_name ?? null,
    wbs_code: task.wbs_code ?? null,
    url: buildProjectTaskUrl(task.project_id, task.task_id),
    tags,
  };
}

async function fetchProjectWebhookRow(
  knex: Knex,
  tenantId: string,
  projectId: string
): Promise<ProjectWebhookRow | undefined> {
  const db = tenantDb(knex, tenantId);
  const query = db.table('projects as p');
  db.tenantJoin(query, 'clients as c', 'p.client_id', 'c.client_id', { type: 'left' });
  db.tenantJoin(query, 'contacts as co', 'p.contact_name_id', 'co.contact_name_id', { type: 'left' });
  db.tenantJoin(query, 'users as au', 'p.assigned_to', 'au.user_id', { type: 'left' });
  db.tenantJoin(query, 'statuses as s', 'p.status', 's.status_id', { type: 'left' });

  return query
    .select(
      'p.project_id',
      'p.project_name',
      'p.wbs_code',
      'p.description',
      'p.status as status_id',
      's.name as status_name',
      knex.raw('COALESCE(s.is_closed, false) as is_closed'),
      'p.client_id',
      'c.client_name',
      'p.contact_name_id',
      'co.full_name as contact_name',
      'co.email as contact_email',
      'p.assigned_to',
      knex.raw(
        "NULLIF(TRIM(CONCAT(COALESCE(au.first_name, ''), ' ', COALESCE(au.last_name, ''))), '') as assigned_to_name"
      ),
      'p.start_date',
      'p.end_date',
      'p.budgeted_hours'
    )
    .where({
      'p.project_id': projectId,
    })
    .first();
}

async function fetchProjectTaskWebhookRow(
  knex: Knex,
  tenantId: string,
  taskId: string
): Promise<ProjectTaskWebhookRow | undefined> {
  const db = tenantDb(knex, tenantId);
  const query = db.table('project_tasks as pt');
  db.tenantJoin(query, 'project_phases as pp', 'pt.phase_id', 'pp.phase_id');
  db.tenantJoin(query, 'projects as p', 'pp.project_id', 'p.project_id', { rootTenantColumn: 'pp.tenant' });
  db.tenantJoin(query, 'clients as c', 'p.client_id', 'c.client_id', {
    type: 'left',
    rootTenantColumn: 'p.tenant',
  });
  db.tenantJoin(query, 'project_status_mappings as psm', 'pt.project_status_mapping_id', 'psm.project_status_mapping_id', {
    type: 'left',
  });
  db.tenantJoin(query, 'statuses as s', 'psm.status_id', 's.status_id', {
    type: 'left',
    rootTenantColumn: 'psm.tenant',
  });
  db.tenantJoin(query, 'standard_statuses as ss', 'psm.standard_status_id', 'ss.standard_status_id', { type: 'left' });
  db.tenantJoin(query, 'users as au', 'pt.assigned_to', 'au.user_id', { type: 'left' });
  db.tenantJoin(query, 'priorities as pr', 'pt.priority_id', 'pr.priority_id', { type: 'left' });

  return query
    .select(
      'p.project_id',
      'p.project_name',
      'p.client_id',
      'c.client_name',
      'pt.task_id',
      'pt.phase_id',
      'pp.phase_name',
      'pt.task_name',
      'pt.description',
      'pt.project_status_mapping_id as status_id',
      knex.raw('COALESCE(psm.custom_name, s.name, ss.name, pt.project_status_mapping_id::text) as status_name'),
      knex.raw('COALESCE(s.is_closed, ss.is_closed, false) as is_closed'),
      'pt.assigned_to',
      knex.raw(
        "NULLIF(TRIM(CONCAT(COALESCE(au.first_name, ''), ' ', COALESCE(au.last_name, ''))), '') as assigned_to_name"
      ),
      'pt.estimated_hours',
      'pt.actual_hours',
      'pt.due_date',
      'pt.priority_id',
      'pr.priority_name',
      'pt.wbs_code'
    )
    .where({
      'pt.task_id': taskId,
    })
    .first();
}

async function fetchProjectTaskTags(
  knex: Knex,
  tenantId: string,
  taskId: string
): Promise<string[]> {
  const tags = await TagMapping.getByEntity(knex, tenantId, taskId, PROJECT_TASK_TAGGED_ENTITY_TYPE);
  return tags.map((tag) => tag.tag_text).filter(Boolean);
}

export async function fetchProjectPhasesForWebhook(
  knex: Knex,
  tenantId: string,
  projectId: string
): Promise<ProjectWebhookPhasePayload[]> {
  const db = tenantDb(knex, tenantId);
  const query = db.table('project_phases as pp');
  db.tenantJoin(query, 'statuses as s', 'pp.status', 's.status_id', { type: 'left' });

  const rows = await query
    .select({ phase_id: 'pp.phase_id', phase_name: 'pp.phase_name', description: 'pp.description', start_date: 'pp.start_date', end_date: 'pp.end_date', status_id: 'pp.status', status_name: 's.name', order_key: 'pp.order_key', order_number: 'pp.order_number', wbs_code: 'pp.wbs_code' })
    .where({
      'pp.project_id': projectId,
    })
    .orderByRaw('COALESCE(pp.order_key, pp.order_number::text) asc');

  return rows.map((row: any) => ({
    phase_id: row.phase_id,
    phase_name: row.phase_name ?? null,
    description: row.description ?? null,
    start_date: toIsoStringOrNull(row.start_date),
    end_date: toIsoStringOrNull(row.end_date),
    status_id: row.status_id ?? null,
    status_name: row.status_name ?? null,
    order_key: row.order_key ?? null,
    order_number: numberOrNull(row.order_number),
    wbs_code: row.wbs_code ?? null,
  }));
}

export async function fetchProjectTaskCountsForWebhook(
  knex: Knex,
  tenantId: string,
  projectId: string
): Promise<ProjectWebhookTaskCountsPayload> {
  const db = tenantDb(knex, tenantId);
  const query = db.table('project_tasks as pt');
  db.tenantJoin(query, 'project_phases as pp', 'pt.phase_id', 'pp.phase_id');
  db.tenantJoin(query, 'project_status_mappings as psm', 'pt.project_status_mapping_id', 'psm.project_status_mapping_id', {
    type: 'left',
  });
  db.tenantJoin(query, 'statuses as s', 'psm.status_id', 's.status_id', {
    type: 'left',
    rootTenantColumn: 'psm.tenant',
  });
  db.tenantJoin(query, 'standard_statuses as ss', 'psm.standard_status_id', 'ss.standard_status_id', { type: 'left' });

  const rows = await query
    .select(
      knex.raw('COALESCE(psm.custom_name, s.name, ss.name, pt.project_status_mapping_id::text) as status_name'),
      knex.raw('COALESCE(s.is_closed, ss.is_closed, false) as is_closed'),
      'pt.due_date'
    )
    .where({
      'pp.project_id': projectId,
    });

  const now = Date.now();
  const byStatus: Record<string, number> = {};
  let completed = 0;
  let overdue = 0;

  for (const row of rows as any[]) {
    const statusName = String(row.status_name ?? 'Unknown');
    byStatus[statusName] = (byStatus[statusName] ?? 0) + 1;
    const isClosed = Boolean(row.is_closed);
    if (isClosed) {
      completed += 1;
    }
    const dueDate = row.due_date ? new Date(row.due_date).getTime() : NaN;
    if (!isClosed && Number.isFinite(dueDate) && dueDate < now) {
      overdue += 1;
    }
  }

  return {
    total: rows.length,
    completed,
    overdue,
    by_status: byStatus,
  };
}

async function fetchProjectStatusName(
  knex: Knex,
  tenantId: string,
  statusId: string
): Promise<string | null> {
  const db = tenantDb(knex, tenantId);
  const mappingQuery = db.table('project_status_mappings as psm');
  db.tenantJoin(mappingQuery, 'statuses as s', 'psm.status_id', 's.status_id', {
    type: 'left',
    rootTenantColumn: 'psm.tenant',
  });
  db.tenantJoin(mappingQuery, 'standard_statuses as ss', 'psm.standard_status_id', 'ss.standard_status_id', { type: 'left' });

  const mapping = await mappingQuery
    .where({
      'psm.project_status_mapping_id': statusId,
    })
    .select(knex.raw('COALESCE(psm.custom_name, s.name, ss.name) as status_name'))
    .first<{ status_name: string | null }>();

  if (mapping?.status_name) {
    return mapping.status_name;
  }

  const status = await db.table('statuses')
    .where({ status_id: statusId })
    .select('name')
    .first<{ name: string | null }>();

  return status?.name ?? null;
}

function normalizeChanges(
  changes: unknown
): Record<string, NormalizedWebhookChange> | undefined {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    return undefined;
  }

  const normalizedEntries = Object.entries(changes).flatMap(([field, value]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return [];
    }

    const candidate = value as { previous?: unknown; old?: unknown; from?: unknown; new?: unknown };
    const previous = candidate.previous ?? candidate.old ?? candidate.from;

    if (!('new' in candidate)) {
      return [];
    }

    return [[field, { previous, new: candidate.new }] as const];
  });

  return normalizedEntries.length > 0 ? Object.fromEntries(normalizedEntries) : undefined;
}

function resolveTaskId(internalEvent: ProjectWebhookSourceEvent): string | undefined {
  const taskId = internalEvent.payload.projectTaskId ?? internalEvent.payload.taskId;
  return typeof taskId === 'string' && taskId.length > 0 ? taskId : undefined;
}

/**
 * Previous status id from explicit/legacy carriers only: an explicit
 * `previousStatusId`, or a `changes` diff entry. Deliberately does NOT read
 * `previousStatus` — for PROJECT_TASK_STATUS_CHANGED that field is a resolved
 * status *name*, not an id.
 */
function resolveExplicitPreviousStatusId(internalEvent: ProjectWebhookSourceEvent): string | null {
  const payload = internalEvent.payload as {
    previousStatusId?: unknown;
    changes?: {
      status_id?: { from?: unknown; previous?: unknown; old?: unknown };
      project_status_mapping_id?: { from?: unknown; previous?: unknown; old?: unknown };
      status?: { from?: unknown; previous?: unknown; old?: unknown };
    };
  };

  if (typeof payload.previousStatusId === 'string' && payload.previousStatusId.length > 0) {
    return payload.previousStatusId;
  }

  const previousFromChanges =
    payload.changes?.status_id?.from
    ?? payload.changes?.status_id?.previous
    ?? payload.changes?.status_id?.old
    ?? payload.changes?.project_status_mapping_id?.from
    ?? payload.changes?.project_status_mapping_id?.previous
    ?? payload.changes?.project_status_mapping_id?.old
    ?? payload.changes?.status?.from
    ?? payload.changes?.status?.previous
    ?? payload.changes?.status?.old;

  return typeof previousFromChanges === 'string' && previousFromChanges.length > 0
    ? previousFromChanges
    : null;
}

/**
 * Previous status id for project-level PROJECT_STATUS_CHANGED. The domain
 * event carries `previousStatus` as a project status_id (the `projects.status`
 * column), so accept that in addition to explicit/legacy id carriers.
 */
function resolvePreviousProjectStatusId(internalEvent: ProjectWebhookSourceEvent): string | null {
  const explicit = resolveExplicitPreviousStatusId(internalEvent);
  if (explicit) {
    return explicit;
  }

  const previousStatus = internalEvent.payload.previousStatus;
  return typeof previousStatus === 'string' && previousStatus.length > 0 ? previousStatus : null;
}

/**
 * Previous status display name. Used for PROJECT_TASK_STATUS_CHANGED, whose
 * `previousStatus` field is an already resolved status name.
 */
function resolvePreviousStatusName(internalEvent: ProjectWebhookSourceEvent): string | null {
  const previousStatus = internalEvent.payload.previousStatus;
  return typeof previousStatus === 'string' && previousStatus.length > 0 ? previousStatus : null;
}

function toIsoStringOrNull(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return String(value);
}

function numberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function buildProjectUrl(projectId: string): string {
  const baseUrl = (process.env.NEXTAUTH_URL || 'http://localhost:3000').replace(/\/+$/, '');
  return `${baseUrl}/msp/projects/${projectId}`;
}

function buildProjectTaskUrl(projectId: string, taskId: string): string {
  return `${buildProjectUrl(projectId)}?taskId=${encodeURIComponent(taskId)}`;
}
