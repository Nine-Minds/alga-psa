import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { isCoManagedUuid } from '../../../../../packages/co-managed/src/sharedWorkIdentity';
import type { CoManagedPortableWorkspaceManifest } from '../../../../../packages/co-managed/src/portableWorkspaceManifest';
import { portableRestoreGlobalCatalogs, type PortableDestinationCatalogMappings, type PortableRestoreProfile,
  type PreparedPortableWorkspaceRecords } from '../../../../../packages/co-managed/src/portableWorkspaceRestoreRecords';
import type { prepareCoManagedPortableWorkspaceVault } from './portableWorkspaceRestoreVault';
import { coManagedPortableNativeFilePath } from '../../../../../packages/co-managed/src/portableNativeFilePath';

type Row = Record<string, any>;
type Prepared = PreparedPortableWorkspaceRecords;
type Vault = Awaited<ReturnType<typeof prepareCoManagedPortableWorkspaceVault>>;
const fail = (reason: string): never => { throw new Error(`Portable database restore rejected: ${reason}`); };
const same = (a: unknown, b: unknown) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const EXTRAS: Record<string, readonly string[]> = {
  audit_logs: ['tenant', 'audit_id', 'user_id', 'operation', 'table_name', 'record_id', 'changed_data', 'details', 'timestamp'],
  external_files: ['tenant', 'file_id', 'file_name', 'original_name', 'mime_type', 'file_size', 'storage_path', 'uploaded_by_id', 'created_at', 'updated_at', 'is_deleted', 'deleted_at', 'deleted_by_id', 'metadata'],
  credentials: ['tenant', 'credential_id', 'client_id', 'name', 'username', 'url', 'description', 'is_restricted', 'created_by', 'created_at', 'updated_at', 'password_ciphertext', 'otp_secret_ciphertext', 'encryption_scheme'],
  credential_access_grants: ['tenant', 'grant_id', 'credential_id', 'subject_type', 'subject_id', 'created_by', 'created_at'],
  credential_associations: ['tenant', 'association_id', 'credential_id', 'credential_ref', 'entity_type', 'entity_id', 'created_at'],
};
// Native columns the portable projection deliberately omits; each gets an inert, fixed value.
const DEFAULT_COLUMNS: Record<string, readonly string[]> = { tenants: ['product_code'], users: ['hashed_password'] };
const signature = (row: Row, columns: readonly string[]) => JSON.stringify(columns.map(column => row[column]));

/** Destination global definitions are matched by exact operational semantics (the specs come from the
 * archive's restore profiles). Missing or ambiguous definitions require installer reconciliation; never
 * seed global records or accept source UUIDs as evidence of a semantic match. */
export async function resolveCoManagedPortableDestinationCatalogs(trx: Knex.Transaction, manifest: CoManagedPortableWorkspaceManifest,
  profiles?: readonly PortableRestoreProfile[]): Promise<PortableDestinationCatalogMappings> {
  if (!trx.isTransaction) fail('retained transaction required');
  const records: Record<string, Row[]> = Object.assign({}, ...manifest.sections.map(section => section.records));
  const result: PortableDestinationCatalogMappings = {};
  for (const [table, spec] of Object.entries(portableRestoreGlobalCatalogs(manifest, profiles))) {
    const actual = await trx(table).select(spec.id, ...spec.fields).limit(100_001).forShare();
    if (actual.length > 100_000) fail('destination catalog limit');
    const byKey = new Map<string, Row[]>();
    for (const row of actual) { const key = signature(row, spec.fields); byKey.set(key, [...(byKey.get(key) ?? []), row]); }
    const mapped: Record<string, string> = {};
    for (const row of records[table]) {
      const candidates = byKey.get(signature(row, spec.fields));
      const only = candidates?.length === 1 ? candidates[0] : undefined;
      if (!only || !isCoManagedUuid(only[spec.id])) fail('missing or ambiguous destination catalog');
      mapped[String(row[spec.id]).toLowerCase()] = only![spec.id];
    }
    result[table] = mapped;
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

/** The destination's actual foreign keys between the archive's tables, as per-column reference edges (the
 * `tenant` half of a composite key is the namespace, not an identity). Read with the same metadata reader the
 * graph check uses, so what the remap rewrites is exactly what the check will require. */
export async function portableRestoreDestinationReferences(trx: Knex.Transaction, manifest: CoManagedPortableWorkspaceManifest) {
  const tables = [...new Set(manifest.sections.flatMap(section => Object.keys(section.columns)))];
  const included = new Set(tables), references: [string, string, string, string][] = [];
  for (const fk of (await schema(trx, tables)).constraints) {
    if (fk.kind !== 'f' || fk.parent_schema !== 'public' || !included.has(fk.parent)) continue;
    fk.columns.forEach((column, i) => { if (column !== 'tenant' && fk.parent_columns[i] !== 'tenant') references.push([fk.table, column, fk.parent, fk.parent_columns[i]]); });
  }
  return references;
}

/** Whether each destination column accepts NULL, for reconciling external references before remapping. */
export async function portableRestoreColumnNullability(trx: Knex.Transaction, manifest: CoManagedPortableWorkspaceManifest) {
  const tables = [...new Set(manifest.references.filter(edge => edge.status === 'external').map(edge => edge.table))];
  const columns: Column[] = tables.length ? await trx('information_schema.columns').where('table_schema', 'public').whereIn('table_name', tables)
    .select('table_name', 'column_name', 'is_nullable', 'column_default', 'is_generated') : [];
  const nullable = new Map(columns.map(column => [`${column.table_name}.${column.column_name}`, column.is_nullable === 'YES']));
  return (table: string, column: string) => nullable.get(`${table}.${column}`) === true;
}

/** Native write foundation, not public admission. The coordinator authorizes a fresh destination, holds
 * the restore lock and owns the receipt/suspension; this inserts the restored graph. A savepoint ensures
 * even a caller that catches a failure cannot commit a partially restored tenant. Inputs come from the
 * trusted record/file/vault adapters after authentication; only the declared native table/column roster
 * can reach INSERT, and every row is stamped with the destination tenant. No provider I/O, trust,
 * sessions, subscriptions, event publication or activation occurs here.
 * Returns the full accounting of how every archive table was handled. */
export async function insertCoManagedPortableWorkspaceDatabase(trx: Knex.Transaction, input: {
  preparedRecords: Prepared; externalFiles: readonly Row[]; vault: Vault;
}) {
  if (!trx.isTransaction) fail('retained transaction required');
  const prepared = input.preparedRecords, tenant = prepared.destinationTenant;
  if (!isCoManagedUuid(tenant) || !isCoManagedUuid(prepared.sourceTenant) || same(tenant, prepared.sourceTenant)) fail('fresh destination required');
  const records: Record<string, Row[]> = structuredClone(prepared.records);
  const globals = new Set<string>(Object.keys(prepared.globalCatalogs));
  const historical = new Set<string>(prepared.profiles.flatMap(profile => [...(profile.historical ?? [])]));
  for (const profile of prepared.profiles) for (const [table, rows] of Object.entries(profile.project?.(prepared) ?? {})) {
    if (!EXTRAS[table] && !records[table]) fail(`projection targets unknown table ${table}`);
    records[table] = [...(records[table] ?? []), ...rows];
  }
  if (!same(input.vault.tenant, tenant)) fail('vault destination mismatch');
  records.external_files = input.externalFiles as Row[];
  records.audit_logs = records.audit_logs ?? [];
  for (const table of ['credentials', 'credential_access_grants', 'credential_associations'] as const) records[table] = input.vault[table];
  for (const row of records.audit_logs) row.tenant = tenant;
  for (const [table, allowed] of Object.entries(EXTRAS)) {
    if (!Array.isArray(records[table]) || records[table].length > 100_000) fail('invalid adapter rows');
    for (const row of records[table]) if (!row || typeof row !== 'object' || (table !== 'audit_logs' && !same(row.tenant, tenant)) ||
        Object.keys(row).some(column => !allowed.includes(column))) fail('invalid adapter projection');
  }
  if (records.users.some(row => row.is_inactive !== true) || (records.workflow_definitions ?? []).some(row => row.is_paused !== true) ||
      (records.asset_maintenance_schedules ?? []).some(row => row.is_active !== false) || (records.comments ?? []).some(row => row.publish_state === 'scheduled')) fail('destination dispatch must remain inactive');
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
    for (const [table, spec] of Object.entries(prepared.globalCatalogs)) {
      const actual = await retained(table).select(spec.id, ...spec.fields).forShare();
      const byId = new Map(actual.map(row => [String(row[spec.id]).toLowerCase(), row]));
      for (const row of records[table]) {
        const current = byId.get(String(row[spec.id]).toLowerCase());
        if (!current || signature(current, spec.fields) !== signature(row, spec.fields)) fail('destination catalog changed');
      }
    }
    const tables = [...prepared.tables.filter(table => !globals.has(table) && !historical.has(table)), ...Object.keys(EXTRAS)];
    const metadata = await schema(retained, tables), byTable = new Map<string, Map<string, Column>>();
    for (const column of metadata.columns) {
      if (!byTable.has(column.table_name)) byTable.set(column.table_name, new Map());
      byTable.get(column.table_name)!.set(column.column_name, column);
    }
    const primary = new Map(metadata.constraints.filter(c => c.kind === 'p').map(c => [c.table, c.columns]));
    const foreign = metadata.constraints.filter(c => c.kind === 'f');
    for (const table of tables) {
      const columns = byTable.get(table), projected = EXTRAS[table] ?? ['tenant', ...prepared.columns[table]];
      if (!columns || !primary.has(table) || projected.some(column => !columns.has(column))) fail(`unsupported destination schema: ${table}`);
      for (const row of records[table]) {
        row.tenant = tenant;
        // The destination tenant is NOT suspended through `tenants`; the dedicated restore-suspension row
        // (written by the coordinator in this same transaction) holds it until the operator activates it.
        if (table === 'tenants') row.product_code = 'psa';
        if (table === 'users') row.hashed_password = '!portable-restore-disabled';
        for (const column of columns!.values()) {
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
      const picked = candidate!, column = picked.columns.find(column => column !== 'tenant' && !primary.get(picked.table)!.includes(column) && byTable.get(picked.table)!.get(column)!.is_nullable === 'YES')!;
      if (!deferred.has(picked.table)) deferred.set(picked.table, new Set()); deferred.get(picked.table)!.add(column);
    }
    for (const table of order) {
      const held = deferred.get(table), computed = [...byTable.get(table)!.values()].filter(column => column.is_generated !== 'NEVER' && prepared.columns[table]?.includes(column.column_name)).map(column => column.column_name);
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
    const written = Object.fromEntries(tables.map(table => [table, records[table].length]));
    // Every archive table must be accounted for: written natively, projected from history, or matched to a destination global.
    const accounted = new Set([...tables, ...historical, ...globals]);
    if (prepared.tables.some(table => !accounted.has(table))) fail('archive table was not accounted for');
    return { tenant, written, historical: [...historical].sort(), globals: [...globals].sort(), suspended: true as const };
  });
}
