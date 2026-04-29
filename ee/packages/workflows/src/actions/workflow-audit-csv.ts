import type { Knex } from 'knex';

export const WORKFLOW_AUDIT_CSV_HEADERS = [
  'timestamp',
  'event',
  'actor',
  'source',
  'workflow_name',
  'workflow_key',
  'workflow_version',
  'run_status',
  'reason',
  'step_path',
  'action',
  'changed_fields',
  'summary',
  'additional_details',
  'actor_user_id',
  'workflow_id',
  'run_id',
  'record_type',
  'operation',
  'audit_id'
] as const;

type CsvHeader = (typeof WORKFLOW_AUDIT_CSV_HEADERS)[number];

type MaybeRecord = Record<string, unknown> | null | undefined;

export type WorkflowAuditCsvLog = {
  audit_id: string | number;
  timestamp: string | Date;
  operation: string;
  user_id: string | null;
  table_name: string;
  record_id: string;
  changed_data?: MaybeRecord;
  details?: MaybeRecord;
};

export type ActorUserRow = {
  user_id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
};

export type WorkflowAuditCsvContext = {
  workflowId: string | null;
  runId: string | null;
  workflowName: string | null;
  workflowKey: string | null;
  workflowVersion: number | string | null;
  runStatus: string | null;
};

export type WorkflowAuditCsvEnrichment = {
  actorByUserId: Map<string, string>;
  context: WorkflowAuditCsvContext;
};

const KNOWN_EVENT_LABELS: Record<string, string> = {
  workflow_definition_create: 'Workflow created',
  workflow_definition_update: 'Workflow draft saved',
  workflow_definition_metadata_update: 'Workflow settings updated',
  workflow_definition_delete: 'Workflow deleted',
  workflow_definition_publish: 'Workflow published',
  workflow_run_start: 'Run started',
  workflow_run_cancel: 'Run canceled',
  workflow_run_resume: 'Run resumed',
  workflow_run_retry: 'Run retried',
  workflow_run_replay: 'Run replayed',
  workflow_run_requeue_event: 'Event wait requeued'
};

const FIELD_GROUPS = [
  { label: 'status', keys: ['status', 'runStatus', 'run_status'] },
  { label: 'reason', keys: ['reason'] },
  {
    label: 'workflow version',
    keys: ['workflowVersion', 'workflow_version', 'draftVersion', 'draft_version', 'publishedVersion', 'published_version']
  },
  { label: 'step path', keys: ['stepPath', 'step_path', 'nodePath', 'node_path'] },
  { label: 'action id', keys: ['actionId', 'action_id'] },
  { label: 'action version', keys: ['actionVersion', 'action_version'] },
  { label: 'source', keys: ['source'] },
  { label: 'workflow name', keys: ['workflowName', 'workflow_name', 'name'] },
  { label: 'workflow key', keys: ['workflowKey', 'workflow_key', 'key'] }
] as const;

const KNOWN_FIELD_KEYS: Set<string> = new Set(FIELD_GROUPS.flatMap((group) => [...group.keys]));

const csvEscape = (value: unknown) => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

export const buildCsv = (headers: readonly string[], rows: Array<Array<unknown>>) =>
  [headers.join(','), ...rows.map((row) => row.map(csvEscape).join(','))].join('\n');

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const toDisplayText = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
};

const pickFirst = (...values: unknown[]): string => {
  for (const value of values) {
    const text = toDisplayText(value);
    if (text) return text;
  }
  return '';
};

const operationFallbackLabel = (operation: string): string => {
  const parts = operation
    .split('_')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1));
  return parts.length ? parts.join(' ') : 'Workflow audit event';
};

const summarizeUnmappedValue = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return `${value.length} items`;
  if (typeof value === 'object') return 'object';
  return String(value);
};

const pickField = (
  changedData: Record<string, unknown>,
  details: Record<string, unknown>,
  keys: readonly string[]
): string => pickFirst(...keys.flatMap((key) => [details[key], changedData[key]]));

const collectKnownFields = (changedData: Record<string, unknown>, details: Record<string, unknown>) => {
  const source = pickField(changedData, details, ['source']);
  const workflowVersion = pickField(changedData, details, [
    'workflowVersion',
    'workflow_version',
    'draftVersion',
    'draft_version',
    'publishedVersion',
    'published_version'
  ]);
  const runStatus = pickField(changedData, details, ['runStatus', 'run_status', 'status']);
  const reason = pickField(changedData, details, ['reason']);
  const stepPath = pickField(changedData, details, ['stepPath', 'step_path', 'nodePath', 'node_path']);
  const actionId = pickField(changedData, details, ['actionId', 'action_id']);
  const actionVersion = pickField(changedData, details, ['actionVersion', 'action_version']);
  const action = [actionId, actionVersion ? `v${actionVersion}` : ''].filter(Boolean).join(' ');
  const workflowName = pickField(changedData, details, ['workflowName', 'workflow_name', 'name']);
  const workflowKey = pickField(changedData, details, ['workflowKey', 'workflow_key', 'key']);

  return { source, workflowVersion, runStatus, reason, stepPath, action, workflowName, workflowKey };
};

const buildChangedFields = (changedData: Record<string, unknown>, details: Record<string, unknown>): string => {
  const labels: string[] = [];
  for (const group of FIELD_GROUPS) {
    const text = pickField(changedData, details, group.keys);
    if (!text) continue;
    labels.push(group.label);
  }
  return labels.join('; ');
};

const buildAdditionalDetails = (changedData: Record<string, unknown>, details: Record<string, unknown>): string => {
  const parts: string[] = [];
  const all = new Map<string, unknown>();
  for (const [key, value] of Object.entries(changedData)) {
    all.set(`changed_data.${key}`, value);
  }
  for (const [key, value] of Object.entries(details)) {
    all.set(`details.${key}`, value);
  }

  for (const [qualifiedKey, value] of all.entries()) {
    const key = qualifiedKey.split('.').slice(1).join('.');
    if (KNOWN_FIELD_KEYS.has(key)) continue;
    const summarized = summarizeUnmappedValue(value);
    if (!summarized) continue;
    parts.push(`${key}=${summarized}`);
  }

  return parts.join('; ');
};

const buildSummary = (event: string, fields: ReturnType<typeof collectKnownFields>): string => {
  const context: string[] = [];
  if (fields.workflowName) context.push(fields.workflowName);
  else if (fields.workflowKey) context.push(fields.workflowKey);
  if (fields.workflowVersion) context.push(`v${fields.workflowVersion}`);
  if (fields.runStatus) context.push(`status ${fields.runStatus}`);
  if (fields.reason) context.push(`reason ${fields.reason}`);
  if (fields.stepPath) context.push(`step ${fields.stepPath}`);

  return context.length ? `${event}: ${context.join(', ')}` : event;
};

export const formatActor = (user: ActorUserRow | null | undefined): string => {
  if (!user) return 'Unresolved user';
  const firstName = (user.first_name ?? '').trim();
  const lastName = (user.last_name ?? '').trim();
  const fullName = `${firstName} ${lastName}`.trim();
  const email = (user.email ?? '').trim();

  if (fullName && email) return `${fullName} <${email}>`;
  if (email) return email;
  if (fullName) return fullName;
  return 'Unresolved user';
};

export const buildActorMap = async (
  knex: Knex,
  userIds: string[],
  tenant?: string | null
): Promise<Map<string, string>> => {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (!ids.length) return new Map();

  const query = knex('users').whereIn('user_id', ids);
  if (tenant) {
    query.andWhere('tenant', tenant);
  }
  const users = await query.select<ActorUserRow[]>('user_id', 'first_name', 'last_name', 'email');

  const map = new Map<string, string>();
  for (const user of users) {
    map.set(user.user_id, formatActor(user));
  }
  return map;
};

export const buildWorkflowAuditCsvRows = (
  logs: WorkflowAuditCsvLog[],
  enrichment: WorkflowAuditCsvEnrichment
): Array<Record<CsvHeader, string | number>> => {
  return logs.map((log) => {
    const changedData = asRecord(log.changed_data);
    const details = asRecord(log.details);
    const known = collectKnownFields(changedData, details);
    const event = KNOWN_EVENT_LABELS[log.operation] ?? operationFallbackLabel(log.operation);
    const actor = log.user_id ? (enrichment.actorByUserId.get(log.user_id) ?? 'Unresolved user') : 'system';

    const workflowName = known.workflowName || enrichment.context.workflowName || '';
    const workflowKey = known.workflowKey || enrichment.context.workflowKey || '';
    const workflowVersion = known.workflowVersion || String(enrichment.context.workflowVersion ?? '');
    const runStatus = known.runStatus || enrichment.context.runStatus || '';
    const runId = enrichment.context.runId || (log.table_name === 'workflow_runs' ? log.record_id : '');
    const workflowId =
      enrichment.context.workflowId || (log.table_name === 'workflow_definitions' ? log.record_id : '');

    return {
      timestamp: typeof log.timestamp === 'string' ? log.timestamp : log.timestamp.toISOString(),
      event,
      actor,
      source: known.source,
      workflow_name: workflowName,
      workflow_key: workflowKey,
      workflow_version: workflowVersion,
      run_status: runStatus,
      reason: known.reason,
      step_path: known.stepPath,
      action: known.action,
      changed_fields: buildChangedFields(changedData, details),
      summary: buildSummary(event, known),
      additional_details: buildAdditionalDetails(changedData, details),
      actor_user_id: log.user_id ?? '',
      workflow_id: workflowId,
      run_id: runId,
      record_type: log.table_name,
      operation: log.operation,
      audit_id: String(log.audit_id)
    };
  });
};
