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
import { CO_MANAGED_PORTABLE_WORKFLOW_COLUMNS as COLUMNS, type CoManagedPortableWorkflowRecords,
  type CoManagedPortableWorkflowTable } from './portableWorkflowCatalog';

export const CO_MANAGED_PORTABLE_WORKFLOW_REFERENCES = [
  ['workflow_definition_versions', 'workflow_id', 'workflow_definitions', 'workflow_id'],
  ['workflow_definitions', 'created_by', 'users', 'user_id'], ['workflow_definitions', 'updated_by', 'users', 'user_id'],
  ['workflow_definition_versions', 'published_by', 'users', 'user_id'],
  ['workflow_form_schemas', 'form_id', 'workflow_form_definitions', 'form_id'],
  ['workflow_task_definitions', 'created_by', 'users', 'user_id'],
] as const;

export const CO_MANAGED_PORTABLE_WORKFLOW_VALUE_TYPES = {
  workflow_form_definitions: { form_id: 'text' }, workflow_form_schemas: { schema_id: 'text', form_id: 'text' },
} as const;

export function validateCoManagedPortableWorkflowRecords(input: unknown): asserts input is CoManagedPortableWorkflowRecords {
  validatePortableRecordSection(input, { columns: COLUMNS, references: CO_MANAGED_PORTABLE_WORKFLOW_REFERENCES,
    valueTypes: CO_MANAGED_PORTABLE_WORKFLOW_VALUE_TYPES });
  const records = input as CoManagedPortableWorkflowRecords;
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

/** Internal authored-configuration component, with no runtime histories,
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
    for (const table of Object.keys(COLUMNS) as CoManagedPortableWorkflowTable[]) {
      records[table] = await own.table(table).select(...COLUMNS[table]).orderBy(COLUMNS[table][0]).limit(100_001).forShare();
    }
    for (const table of ['workflow_definitions', 'workflow_form_definitions', 'workflow_task_definitions'] as const) {
      for (const row of records[table]) {
        const decision = await authorizeCoManagedLocalRecord(current, verified, subject, 'workflow', 'read', {
          id: String(row[COLUMNS[table][0]]), ownerUserId: isCoManagedUuid(row.created_by) ? row.created_by : null,
        });
        if (decision.redactedFields.length) throw new CoManagedSharedWorkError();
      }
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
        validation: 'rerun', secretReferences: 'reauthorize', connections: 'reauthorize', executionState: 'none', embeddedIdentityRemapping: 'review_before_activation', authoredContent: 'encrypted_package_required' } }));
    return { ...payload, sha256: createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
  });
}
