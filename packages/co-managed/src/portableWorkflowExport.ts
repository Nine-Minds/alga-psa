import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { collectWorkflowDefinitionDependencySummaryV1, mergeDependencySummariesV1 } from '../../../shared/workflow/bundle/dependencySummaryV1';
import { withCoManagedExportAdmin } from './portableExport';
import { portableSnapshotTransaction, type CoManagedPortableSnapshot } from './portableSnapshot';
import { hasCoManagedLocalPermission } from './localPermission';
import { validatePortableRecordSection } from './portableRecordValidation';
import { authorizeCoManagedLocalRecord, CoManagedSharedWorkError, isCoManagedUuid,
  snapshotCoManagedSessionActor, type CoManagedSessionActor } from './sharedWorkIdentity';
import { CO_MANAGED_PORTABLE_WORKFLOW_COLUMNS as COLUMNS, CO_MANAGED_PORTABLE_WORKFLOW_HISTORY_TABLES, type CoManagedPortableWorkflowRecords,
  type CoManagedPortableWorkflowTable } from './portableWorkflowCatalog';

export const CO_MANAGED_PORTABLE_WORKFLOW_REFERENCES = [
  ['workflow_definition_versions', 'workflow_id', 'workflow_definitions', 'workflow_id'],
  ['workflow_definitions', 'created_by', 'users', 'user_id'], ['workflow_definitions', 'updated_by', 'users', 'user_id'],
  ['workflow_definition_versions', 'published_by', 'users', 'user_id'],
  ['workflow_form_schemas', 'form_id', 'workflow_form_definitions', 'form_id'],
  ['workflow_task_definitions', 'created_by', 'users', 'user_id'],
  ['workflow_tasks', 'tenant_task_definition_id', 'workflow_task_definitions', 'task_definition_id'],
  ['workflow_task_history', 'task_id', 'workflow_tasks', 'task_id'],
] as const;

export const CO_MANAGED_PORTABLE_WORKFLOW_VALUE_TYPES = {
  workflow_form_definitions: { form_id: 'text' }, workflow_form_schemas: { schema_id: 'text', form_id: 'text' },
} as const;

export function validateCoManagedPortableWorkflowRecords(input: unknown): asserts input is CoManagedPortableWorkflowRecords {
  // Earlier v1 packages have configuration only. Accept that exact earlier
  // roster, but never a partial history section or unknown additional table.
  const legacy = Boolean(input && typeof input === 'object' && CO_MANAGED_PORTABLE_WORKFLOW_HISTORY_TABLES.every(table => !Object.hasOwn(input, table)));
  const columns = legacy ? Object.fromEntries(Object.entries(COLUMNS).filter(([table]) => !(CO_MANAGED_PORTABLE_WORKFLOW_HISTORY_TABLES as readonly string[]).includes(table))) : COLUMNS;
  validatePortableRecordSection(input, { columns, references: CO_MANAGED_PORTABLE_WORKFLOW_REFERENCES.filter(([table]) => Object.hasOwn(columns, table)),
    valueTypes: CO_MANAGED_PORTABLE_WORKFLOW_VALUE_TYPES });
  const records = input as CoManagedPortableWorkflowRecords;
  if ((records.workflow_tasks?.length ?? 0) + (records.workflow_task_history?.length ?? 0) > 100_000) throw new Error('Portable task history limit exceeded');
  const versions = new Set<string>(), forms = new Set(records.workflow_form_definitions.map(row => row.form_id));
  for (const row of records.workflow_definition_versions) {
    if (!Number.isSafeInteger(row.version) || Number(row.version) < 1) throw new Error('Invalid portable workflow version');
    const key = JSON.stringify([String(row.workflow_id).toLowerCase(), row.version]);
    if (versions.has(key)) throw new Error('Duplicate portable workflow version');
    versions.add(key);
  }
  for (const row of records.workflow_definitions) {
    if (!Number.isSafeInteger(row.draft_version) || Number(row.draft_version) < 1) throw new Error('Invalid portable workflow draft version');
  }
  for (const row of records.workflow_task_definitions) {
    if (!['tenant', 'system'].includes(String(row.form_type))) throw new Error('Invalid portable workflow task form type');
    if (row.form_id !== null && (typeof row.form_id !== 'string' || !row.form_id || (row.form_type === 'tenant' && !forms.has(row.form_id)))) throw new Error('Portable workflow task form is missing');
  }
  for (const row of records.workflow_tasks ?? []) {
    if (!((row.task_definition_type === 'tenant' && isCoManagedUuid(row.tenant_task_definition_id) && row.system_task_definition_task_type === null) ||
      (row.task_definition_type === 'system' && row.tenant_task_definition_id === null && typeof row.system_task_definition_task_type === 'string' && row.system_task_definition_task_type))) throw new Error('Invalid portable task definition');
    for (const field of ['created_by', 'completed_by']) if (row[field] !== null && !isCoManagedUuid(row[field])) throw new Error('Invalid portable historical task actor');
    for (const field of ['created_by_name', 'completed_by_name']) if (row[field] !== null && typeof row[field] !== 'string') throw new Error('Invalid portable historical task attribution');
  }
  for (const row of records.workflow_task_history ?? []) {
    if ((row.user_id !== null && !isCoManagedUuid(row.user_id)) || (row.user_name !== null && typeof row.user_name !== 'string')) throw new Error('Invalid portable historical task actor');
    if (JSON.stringify(row.details) !== JSON.stringify(portableTaskHistoryDetails(row.action, row.details))) throw new Error('Invalid portable task history details');
  }
}

/** Completion forms are user-authored business content. Other opaque task
 * details may contain execution/provider context and are not portable data. */
export function portableTaskHistoryDetails(action: unknown, value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const details = value as Record<string, unknown>;
  if (action === 'complete' && Object.hasOwn(details, 'formData')) return { formData: details.formData };
  if (action === 'dismiss' && typeof details.dismissed === 'boolean') return { dismissed: details.dismissed };
  return null;
}

/** Secret names are dependencies, never invitations to resolve a provider. The
 * original authored JSON (including arbitrary literals) remains unchanged and
 * requires encrypted package transport plus review before activation. */
function secretNames(values: unknown[]): string[] {
  const found = new Set<string>(), pending = [...values];
  let visited = 0;
  while (pending.length) {
    if (++visited > 1_000_000) throw new Error('Portable workflow content limit exceeded');
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    if (!Array.isArray(value) && typeof (value as Record<string, unknown>).$secret === 'string') found.add(String((value as Record<string, unknown>).$secret));
    for (const child of Object.values(value)) if (child && typeof child === 'object') pending.push(child);
  }
  return [...found].sort();
}

/** Internal authored-configuration and task business-history component, with no
 * execution leases, tenant secret values or integration credentials collected. */
export async function exportCoManagedPortableWorkflows(db: Knex, inputActor: CoManagedSessionActor, packageId: string,
  snapshot?: CoManagedPortableSnapshot) {
  if (db.isTransaction) throw new Error('Portable export requires a root database connection');
  const actor = snapshotCoManagedSessionActor(inputActor);
  if (!isCoManagedUuid(packageId)) throw new CoManagedSharedWorkError();
  return portableSnapshotTransaction(db, snapshot, trx => retainCoManagedPortableWorkflows(trx, actor, packageId, snapshot?.capturedAt));
}

/** Internal retained collector for a final package-wide current-source check. */
export async function retainCoManagedPortableWorkflows(trx: Knex.Transaction, inputActor: CoManagedSessionActor, packageId: string, capturedAt?: string) {
  if (!trx.isTransaction) throw new Error('Portable retention requires a transaction');
  const actor = snapshotCoManagedSessionActor(inputActor);
  if (!isCoManagedUuid(packageId)) throw new CoManagedSharedWorkError();
  return withCoManagedExportAdmin(trx, actor, async (current, verified, subject) => {
    // The existing native workflow bundle export requires workflow.admin.
    for (const action of ['admin', 'read']) if (!await hasCoManagedLocalPermission(current, verified, 'workflow', action, true)) throw new CoManagedSharedWorkError();
    const own = tenantDb(current, verified.tenant), records = {} as CoManagedPortableWorkflowRecords;
    for (const table of Object.keys(COLUMNS).filter(table => !(CO_MANAGED_PORTABLE_WORKFLOW_HISTORY_TABLES as readonly string[]).includes(table)) as CoManagedPortableWorkflowTable[]) {
      records[table] = await own.table(table).select(...COLUMNS[table]).orderBy(COLUMNS[table][0]).limit(100_001).forShare();
    }
    const tasks = own.table('workflow_tasks as task');
    own.tenantJoin(tasks, 'users as creator', 'task.created_by', 'creator.user_id', { type: 'left' });
    own.tenantJoin(tasks, 'users as completer', 'task.completed_by', 'completer.user_id', { type: 'left' });
    records.workflow_tasks = await tasks.select(...COLUMNS.workflow_tasks.filter(column => !column.endsWith('_name')).map(column => `task.${column}`),
      { created_by_name: current.raw("nullif(trim(concat_ws(' ', creator.first_name, creator.last_name)), '')"),
        completed_by_name: current.raw("nullif(trim(concat_ws(' ', completer.first_name, completer.last_name)), '')") })
      .orderBy('task.task_id').limit(100_001).forShare('task');
    const history = own.table('workflow_task_history as history');
    own.tenantJoin(history, 'users as actor', 'history.user_id', 'actor.user_id', { type: 'left' });
    records.workflow_task_history = (await history.select(...COLUMNS.workflow_task_history.filter(column => column !== 'user_name').map(column => `history.${column}`),
      { user_name: current.raw("nullif(trim(concat_ws(' ', actor.first_name, actor.last_name)), '')") }).orderBy('history.history_id').limit(100_001).forShare('history'))
      .map(row => ({ ...row, details: portableTaskHistoryDetails(row.action, row.details) }));
    for (const table of ['workflow_definitions', 'workflow_form_definitions', 'workflow_task_definitions'] as const) {
      for (const row of records[table]) {
        const decision = await authorizeCoManagedLocalRecord(current, verified, subject, 'workflow', 'read', {
          id: String(row[COLUMNS[table][0]]), ownerUserId: isCoManagedUuid(row.created_by) ? row.created_by : null,
        });
        if (decision.redactedFields.length) throw new CoManagedSharedWorkError();
      }
    }
    for (const row of records.workflow_tasks) {
      const decision = await authorizeCoManagedLocalRecord(current, verified, subject, 'workflow', 'read', {
        id: String(row.task_id), ownerUserId: isCoManagedUuid(row.created_by) ? row.created_by : null,
      });
      if (decision.redactedFields.length) throw new CoManagedSharedWorkError();
    }
    validateCoManagedPortableWorkflowRecords(records);
    const versions = new Map<unknown, Record<string, unknown>[]>();
    for (const row of records.workflow_definition_versions) {
      const entries = versions.get(row.workflow_id) ?? []; entries.push(row); versions.set(row.workflow_id, entries);
    }
    const dependencies = records.workflow_definitions.map(row => {
      const content = [row.draft_definition, ...(versions.get(row.workflow_id) ?? []).map(version => version.definition_json)];
      const summary = mergeDependencySummariesV1(content.map(collectWorkflowDefinitionDependencySummaryV1));
      summary.schemaRefs = [...new Set([...summary.schemaRefs, row.payload_schema_ref, row.pinned_payload_schema_ref]
        .filter((value): value is string => typeof value === 'string' && Boolean(value)))].sort();
      return { workflowId: row.workflow_id, ...summary, secretNames: secretNames(content) };
    });
    const [{ captured_at }] = (await current.raw('SELECT transaction_timestamp() AS captured_at')).rows;
    const payload = JSON.parse(JSON.stringify({ kind: 'alga-workspace-workflows', version: 1, packageId, sourceTenant: verified.tenant,
      capturedAt: capturedAt ?? captured_at, records, references: CO_MANAGED_PORTABLE_WORKFLOW_REFERENCES, referenceValueTypes: CO_MANAGED_PORTABLE_WORKFLOW_VALUE_TYPES,
      conditionalReferences: [{ table: 'workflow_task_definitions', column: 'form_id', discriminator: 'form_type', equals: 'tenant', parent: 'workflow_form_definitions', parentColumn: 'form_id', valueType: 'text' },
        { table: 'workflow_form_definitions', column: 'created_by', when: 'uuid', parent: 'users', parentColumn: 'user_id', otherwise: 'historical_label' }],
      dependencies, systemForms: [...new Set(records.workflow_task_definitions.filter(row => row.form_type === 'system' && row.form_id).map(row => row.form_id))].sort(),
      restorePolicy: { sponsorship: 'none', workflowStatus: 'draft', workflowsPaused: true, publishedVersions: 'historical_only', forms: 'draft',
        validation: 'rerun', secretReferences: 'reauthorize', connections: 'reauthorize', executionState: 'none', taskBusinessHistory: 'native_audit_history',
        historicalTaskActors: 'source_qualified', embeddedIdentityRemapping: 'review_before_activation', authoredContent: 'encrypted_package_required' } }));
    return { ...payload, sha256: createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
  });
}
