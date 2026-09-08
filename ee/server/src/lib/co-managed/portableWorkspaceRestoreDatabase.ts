import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { isCoManagedUuid } from '../../../../../packages/co-managed/src/sharedWorkIdentity';
import { validateCoManagedPortableWorkspaceRecords } from '../../../../../packages/co-managed/src/portableWorkspaceGraph';
import { CO_MANAGED_PORTABLE_RESTORE_GLOBALS, CO_MANAGED_PORTABLE_RESTORE_SECTIONS,
  type prepareCoManagedPortableWorkspaceRecords, type CoManagedPortableDestinationCatalogMappings } from '../../../../../packages/co-managed/src/portableWorkspaceRestoreRecords';
import type { prepareCoManagedPortableWorkspaceVault } from './portableWorkspaceRestoreVault';
import { coManagedPortableNativeFilePath } from '../../../../../packages/co-managed/src/portableNativeFilePath';

type Row = Record<string, any>;
type Prepared = ReturnType<typeof prepareCoManagedPortableWorkspaceRecords>;
type Vault = Awaited<ReturnType<typeof prepareCoManagedPortableWorkspaceVault>>;
const fail = (reason: string): never => { throw new Error(`Portable database restore rejected: ${reason}`); };
const same = (a: unknown, b: unknown) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const GLOBALS = new Set<string>(CO_MANAGED_PORTABLE_RESTORE_GLOBALS);
const COLUMNS: Record<string, readonly string[]> = Object.assign({}, ...Object.values(CO_MANAGED_PORTABLE_RESTORE_SECTIONS));
const CATALOGS = {
  standard_statuses: { id: 'standard_status_id', fields: ['name', 'item_type', 'is_closed', 'is_default'] },
  shared_document_types: { id: 'type_id', fields: ['type_name'] },
  system_interaction_types: { id: 'type_id', fields: ['type_name'] },
  standard_service_types: { id: 'id', fields: ['name'] },
} as const;
const EXTRAS: Record<string, readonly string[]> = {
  external_files: ['tenant', 'file_id', 'file_name', 'original_name', 'mime_type', 'file_size', 'storage_path', 'uploaded_by_id', 'created_at', 'updated_at', 'is_deleted', 'deleted_at', 'deleted_by_id', 'metadata'],
  credentials: ['tenant', 'credential_id', 'client_id', 'name', 'username', 'url', 'description', 'is_restricted', 'created_by', 'created_at', 'updated_at', 'password_ciphertext', 'otp_secret_ciphertext', 'encryption_scheme'],
  credential_access_grants: ['tenant', 'grant_id', 'credential_id', 'subject_type', 'subject_id', 'created_by', 'created_at'],
  credential_associations: ['tenant', 'association_id', 'credential_id', 'credential_ref', 'entity_type', 'entity_id', 'created_at'],
};
const DEFAULT_COLUMNS: Record<string, readonly string[]> = {
  tenants: ['suspended_at', 'suspended_reason', 'product_code'], users: ['hashed_password'],
  time_entries: ['billing_mode', 'billable_duration', 'service_id', 'invoiced'],
  service_catalog: ['billing_method', 'default_rate', 'is_active'], online_meeting_artifacts: ['provider_artifact_id'],
};
const signature = (row: Row, columns: readonly string[]) => JSON.stringify(columns.map(column => row[column]));

/** Destination global definitions are matched by exact operational semantics.
 * Missing or ambiguous definitions require installer reconciliation; never seed
 * global records or accept source UUIDs as evidence of a semantic match. */
export async function resolveCoManagedPortableDestinationCatalogs(trx: Knex.Transaction, sections: Prepared['sections'], sourceTenant: string): Promise<CoManagedPortableDestinationCatalogMappings> {
  if (!trx.isTransaction) fail('retained transaction required');
  const { records } = validateCoManagedPortableWorkspaceRecords(structuredClone(sections), { sourceTenant });
  const result = {} as CoManagedPortableDestinationCatalogMappings;
  for (const [table, spec] of Object.entries(CATALOGS)) {
    const actual = await trx(table).select(spec.id, ...spec.fields).limit(100_001).forShare();
    if (actual.length > 100_000) fail('destination catalog limit');
    const byKey = new Map<string, Row[]>();
    for (const row of actual) { const key = signature(row, spec.fields); byKey.set(key, [...(byKey.get(key) ?? []), row]); }
    const mapped: Record<string, string> = {};
    for (const row of records[table]) {
      const candidates = byKey.get(signature(row, spec.fields));
      if (candidates?.length !== 1 || !isCoManagedUuid(candidates[0][spec.id])) fail('missing or ambiguous destination catalog');
      mapped[String(row[spec.id]).toLowerCase()] = candidates[0][spec.id];
    }
    result[table as keyof typeof result] = mapped;
  }
  return result;
}

interface Column { table_name: string; column_name: string; is_nullable: string; column_default: string | null; is_generated: string }
interface Constraint { name: string; table: string; parent: string; parent_schema: string; columns: string[]; parent_columns: string[]; kind: string; match: string }
async function schema(trx: Knex.Transaction, tables: string[]) {
  const columns: Column[] = await trx('information_schema.columns').where('table_schema', 'public').whereIn('table_name', tables)
    .select('table_name', 'column_name', 'is_nullable', 'column_default', 'is_generated');
  const { rows: constraints } = await trx.raw(`SELECT c.conname AS name, t.relname AS "table", p.relname AS parent,
    pn.nspname AS parent_schema, c.contype AS kind, c.confmatchtype AS match,
    ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(n,o) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.n ORDER BY k.o) AS columns,
    ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(n,o) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.n ORDER BY k.o) AS parent_columns
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace ns ON ns.oid=t.relnamespace
    LEFT JOIN pg_class p ON p.oid=c.confrelid LEFT JOIN pg_namespace pn ON pn.oid=p.relnamespace
    WHERE ns.nspname='public' AND t.relname=ANY(?::text[]) AND c.contype IN ('f','p')`, [tables]);
  return { columns, constraints: constraints as Constraint[] };
}

/** Native write foundation, not public admission. The installer must authorize
 * a fresh destination UUID before invoking this function. A savepoint ensures
 * even a caller that catches a failure cannot commit a partially restored tenant.
 * Inputs come from the trusted record/file/vault adapters after authentication;
 * only this fixed native table/column roster can reach INSERT. No provider I/O,
 * trust, sessions, subscriptions, event publication or activation occurs here. */
export async function insertCoManagedPortableWorkspaceDatabase(trx: Knex.Transaction, input: {
  preparedRecords: Prepared; externalFiles: readonly Row[]; vault: Vault;
}) {
  if (!trx.isTransaction) fail('retained transaction required');
  const request = structuredClone(input), prepared = request.preparedRecords, tenant = prepared.destinationTenant;
  if (!isCoManagedUuid(tenant) || !isCoManagedUuid(prepared.sourceTenant) || same(tenant, prepared.sourceTenant)) fail('fresh destination required');
  const validated = validateCoManagedPortableWorkspaceRecords(prepared.sections, { sourceTenant: tenant });
  if (JSON.stringify(validated.records) !== JSON.stringify(prepared.records)) fail('record sections disagree');
  const records: Record<string, Row[]> = validated.records;
  // The portable handoff section is historical evidence, not a native live
  // relationship table. Preserve it as ticket activity without creating trust.
  for (const row of records.handoff_history) {
    const local = same(row.actor_tenant, tenant) && records.users.some(user => same(user.user_id, row.actor_user_id));
    const reference = records.collaboration_actor_references.find(actor => same(actor.actor_tenant, row.actor_tenant) && same(actor.actor_user_id, row.actor_user_id));
    records.ticket_audit_logs.push({ audit_id: row.operation_id, ticket_id: row.ticket_id, event_type: 'TICKET_HANDOFF_RESTORED',
      entity_type: 'ticket', entity_id: row.ticket_id, actor_type: 'user', actor_user_id: local ? row.actor_user_id : null,
      actor_contact_id: null, actor_reference_id: local ? null : reference?.actor_reference_id ?? null,
      actor_display_name: row.actor_name, actor_organization_name: row.actor_organization, source: 'system',
      occurred_at: row.occurred_at, created_at: row.occurred_at, changes: {},
      details: { portable_handoff: { ...row }, is_internal: row.audience !== 'requester', collaboration_audience: row.audience } });
  }
  if (!same(request.vault.tenant, tenant)) fail('vault destination mismatch');
  records.external_files = request.externalFiles as Row[];
  for (const table of ['credentials', 'credential_access_grants', 'credential_associations'] as const) records[table] = request.vault[table];
  for (const [table, allowed] of Object.entries(EXTRAS)) {
    if (!Array.isArray(records[table]) || records[table].length > 100_000) fail('invalid adapter rows');
    for (const row of records[table]) if (!row || typeof row !== 'object' || !same(row.tenant, tenant) || Object.keys(row).some(column => !allowed.includes(column))) fail('invalid adapter projection');
  }
  if (records.users.some(row => row.is_inactive !== true) || records.workflow_definitions.some(row => row.is_paused !== true) ||
      records.asset_maintenance_schedules.some(row => row.is_active !== false) || records.comments.some(row => row.publish_state === 'scheduled') ||
      records.online_meetings.some(row => ['scheduled', 'ended', 'recording_pending', 'cancel_pending'].includes(row.status)) ||
      records.availability_settings.some(row => row.config_json?.auto_approval_enabled === true)) fail('destination dispatch must remain inactive');
  for (const row of records.external_files) {
    if (!isCoManagedUuid(row.file_id) || row.is_deleted !== false || row.deleted_at !== null || row.deleted_by_id !== null ||
        !Number.isSafeInteger(row.file_size) || row.file_size < 0 || !same(row.file_name, row.file_id)) fail('invalid native file metadata');
    coManagedPortableNativeFilePath(tenant, row.storage_path);
    if (!row.storage_path.startsWith(`${tenant}/portable-restores/`)) fail('file outside restore allocation');
  }
  return trx.transaction(async retained => {
    await retained.raw('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [`portable-restore:${tenant.toLowerCase()}`]);
    const own = tenantDb(retained, tenant);
    if (await own.table('tenants').first('tenant')) fail('destination already exists');
    for (let offset = 0; offset < records.users.length; offset += 500) {
      if (await retained('users').whereIn('user_id', records.users.slice(offset, offset + 500).map(row => row.user_id)).first('user_id')) fail('destination user identity already exists');
    }
    for (const [table, spec] of Object.entries(CATALOGS)) {
      const actual = await retained(table).select(spec.id, ...spec.fields).forShare();
      const byId = new Map(actual.map(row => [String(row[spec.id]).toLowerCase(), row]));
      for (const row of records[table]) {
        const current = byId.get(String(row[spec.id]).toLowerCase());
        if (!current || signature(current, spec.fields) !== signature(row, spec.fields)) fail('destination catalog changed');
      }
    }
    const tables = [...Object.keys(COLUMNS).filter(table => !GLOBALS.has(table) && table !== 'handoff_history'), ...Object.keys(EXTRAS)];
    const metadata = await schema(retained, tables), byTable = new Map<string, Map<string, Column>>();
    for (const column of metadata.columns) {
      if (!byTable.has(column.table_name)) byTable.set(column.table_name, new Map());
      byTable.get(column.table_name)!.set(column.column_name, column);
    }
    const primary = new Map(metadata.constraints.filter(c => c.kind === 'p').map(c => [c.table, c.columns]));
    const foreign = metadata.constraints.filter(c => c.kind === 'f');
    for (const table of tables) {
      const columns = byTable.get(table), projected = EXTRAS[table] ?? ['tenant', ...COLUMNS[table], ...(DEFAULT_COLUMNS[table] ?? [])];
      if (!columns || !primary.has(table) || projected.some(column => !columns.has(column))) fail(`unsupported destination schema: ${table}`);
      for (const row of records[table]) {
        row.tenant = tenant;
        if (table === 'tenants') Object.assign(row, { suspended_at: new Date().toISOString(), suspended_reason: 'portable_restore_pending_activation', product_code: 'psa' });
        if (table === 'users') row.hashed_password = '!portable-restore-disabled';
        if (table === 'time_entries') Object.assign(row, { billing_mode: 'operational', billable_duration: 0, service_id: null, invoiced: false });
        if (table === 'service_catalog') Object.assign(row, { billing_method: 'hourly', default_rate: null, is_active: false });
        if (table === 'online_meeting_artifacts') row.provider_artifact_id = `portable-restored:${row.artifact_id}`;
        for (const column of columns.values()) {
          if (column.is_nullable === 'NO' && column.column_default === null && column.is_generated === 'NEVER' && row[column.column_name] == null) fail(`missing required native value: ${table}.${column.column_name}`);
        }
      }
    }
    // Check every actual FK against the included native destination graph,
    // including legacy FKs which reference a globally unique ID without tenant.
    const parentIndexes = new Map<string, Set<string>>();
    for (const fk of foreign) for (const row of records[fk.table]) {
      const values = fk.columns.map(column => row[column]);
      if (values.some(value => value == null)) {
        if (fk.columns.some((column, i) => values[i] === undefined && byTable.get(fk.table)!.get(column)!.column_default !== null)) fail('unsupported foreign key default');
        continue;
      }
      if (fk.parent_schema !== 'public' || !records[fk.parent]) fail('foreign key requires unsupported section');
      const indexKey = JSON.stringify([fk.parent, fk.parent_columns]);
      if (!parentIndexes.has(indexKey)) parentIndexes.set(indexKey, new Set(records[fk.parent].map(parent => signature(parent, fk.parent_columns))));
      if (!parentIndexes.get(indexKey)!.has(JSON.stringify(values))) fail('native foreign key leaves restored graph');
    }
    // Topological insertion uses actual FK metadata. Only nullable columns on a
    // detected cycle are held aside; normal source values are inserted once.
    const pending = new Set(tables.filter(table => records[table].length)), order: string[] = [], deferred = new Map<string, Set<string>>();
    const active = (fk: Constraint) => pending.has(fk.table) && pending.has(fk.parent) && !fk.columns.some(column => deferred.get(fk.table)?.has(column)) &&
      records[fk.table].some(row => fk.columns.every(column => row[column] != null));
    while (pending.size) {
      const ready = [...pending].filter(table => !foreign.some(fk => fk.table === table && active(fk)));
      if (ready.length) { for (const table of ready) { pending.delete(table); order.push(table); } continue; }
      // Find an edge in an actual cycle, not an unrelated nullable owner link.
      const edges = foreign.filter(active);
      const reaches = (from: string, target: string, seen = new Set<string>()): boolean => {
        if (from === target) return true; if (seen.has(from)) return false; seen.add(from);
        return edges.some(edge => edge.table === from && reaches(edge.parent, target, seen));
      };
      const candidate = edges.find(fk => fk.match === 's' && reaches(fk.parent, fk.table) && fk.columns.some(column =>
        column !== 'tenant' && !primary.get(fk.table)!.includes(column) && byTable.get(fk.table)!.get(column)!.is_nullable === 'YES'));
      if (!candidate) fail('unsupported nonnullable foreign key cycle');
      const column = candidate.columns.find(column => column !== 'tenant' && !primary.get(candidate.table)!.includes(column) && byTable.get(candidate.table)!.get(column)!.is_nullable === 'YES')!;
      if (!deferred.has(candidate.table)) deferred.set(candidate.table, new Set()); deferred.get(candidate.table)!.add(column);
    }
    for (const table of order) {
      const held = deferred.get(table), computed = [...byTable.get(table)!.values()].filter(column => column.is_generated !== 'NEVER' && COLUMNS[table]?.includes(column.column_name)).map(column => column.column_name);
      const rows = records[table].map(row => {
        const native = { ...row, ...Object.fromEntries([...(held ?? [])].map(column => [column, null])) };
        for (const column of computed) delete native[column];
        return native;
      });
      const originals = new Map(records[table].map(row => [signature(row, primary.get(table)!), row]));
      for (let offset = 0; offset < rows.length; offset += 200) {
        const query = own.table(table).insert(rows.slice(offset, offset + 200));
        if (!computed.length) { await query; continue; }
        const inserted = await query.returning([...primary.get(table)!, ...computed]);
        for (const row of inserted) {
          const source = originals.get(signature(row, primary.get(table)!));
          if (!source || signature(row, computed) !== signature(source, computed)) fail('generated destination value differs from source');
        }
      }
    }
    for (const [table, columns] of deferred) for (const row of records[table]) {
      const update = Object.fromEntries([...columns].map(column => [column, row[column]]));
      if (Object.values(update).every(value => value == null)) continue;
      const key = Object.fromEntries(primary.get(table)!.map(column => [column, row[column]]));
      if (Object.values(key).some(value => value == null) || await own.table(table).where(key).update(update) !== 1) fail('cycle repair lost native row');
    }
    return { tenant, inserted: Object.fromEntries(tables.map(table => [table, records[table].length])), suspended: true as const };
  });
}
