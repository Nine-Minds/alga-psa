import { portableSnapshotTransaction, type CoManagedPortableSnapshot } from './portableSnapshot';
import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { withCoManagedExportAdmin } from './portableExport';
import { hasCoManagedLocalPermission } from './localPermission';
import { validatePortableRecordSection } from './portableRecordValidation';
import { authorizeCoManagedLocalRecord, CoManagedSharedWorkError, isCoManagedUuid,
  snapshotCoManagedSessionActor, type CoManagedSessionActor } from './sharedWorkIdentity';
import { CO_MANAGED_PORTABLE_ASSET_COLUMNS as COLUMNS, type CoManagedPortableAssetRecords,
  type CoManagedPortableAssetTable } from './portableAssetCatalog';

export const CO_MANAGED_PORTABLE_ASSET_REFERENCES = [
  ...(['workstation_assets', 'server_assets', 'network_device_assets', 'printer_assets', 'mobile_device_assets',
    'asset_software', 'asset_history', 'asset_facts', 'asset_service_history', 'asset_maintenance_schedules',
    'asset_maintenance_history', 'asset_maintenance_occurrences', 'asset_document_associations',
    'asset_ticket_associations', 'asset_associations'] as const).map(table => [table, 'asset_id', 'assets', 'asset_id'] as const),
  ['asset_relationships', 'parent_asset_id', 'assets', 'asset_id'], ['asset_relationships', 'child_asset_id', 'assets', 'asset_id'],
  ['asset_software', 'software_id', 'software_catalog', 'software_id'],
  ['asset_maintenance_history', 'schedule_id', 'asset_maintenance_schedules', 'schedule_id'],
  ['asset_maintenance_occurrences', 'schedule_id', 'asset_maintenance_schedules', 'schedule_id'],
  ['asset_maintenance_occurrences', 'history_id', 'asset_maintenance_history', 'history_id'],
  ['asset_maintenance_occurrences', 'ticket_id', 'tickets', 'ticket_id'],
  ['asset_service_history', 'ticket_id', 'tickets', 'ticket_id'],
  ['asset_document_associations', 'document_id', 'documents', 'document_id'],
  ['asset_ticket_associations', 'ticket_id', 'tickets', 'ticket_id'],
  ['assets', 'client_id', 'clients', 'client_id'], ['assets', 'location_id', 'client_locations', 'location_id'],
  ['assets', 'notes_document_id', 'documents', 'document_id'],
  ['asset_history', 'changed_by', 'users', 'user_id'], ['asset_service_history', 'performed_by', 'users', 'user_id'],
  ['asset_maintenance_schedules', 'created_by', 'users', 'user_id'], ['asset_maintenance_history', 'performed_by', 'users', 'user_id'],
  ['asset_maintenance_occurrences', 'closed_by', 'users', 'user_id'],
  ['asset_document_associations', 'created_by', 'users', 'user_id'], ['asset_ticket_associations', 'created_by', 'users', 'user_id'],
  ['asset_associations', 'created_by', 'users', 'user_id'],
] as const;

const ENTITY_REFERENCES = { user: ['users', 'user_id'], team: ['teams', 'team_id'], client: ['clients', 'client_id'],
  contact: ['contacts', 'contact_name_id'], ticket: ['tickets', 'ticket_id'], project: ['projects', 'project_id'],
  asset: ['assets', 'asset_id'], document: ['documents', 'document_id'] } as const;
const BUILTIN_TYPES = new Set(['workstation', 'server', 'network_device', 'printer', 'mobile_device', 'unknown']);

export function validateCoManagedPortableAssetRecords(input: unknown): asserts input is CoManagedPortableAssetRecords {
  validatePortableRecordSection(input, { columns: COLUMNS, references: CO_MANAGED_PORTABLE_ASSET_REFERENCES,
    identities: { asset_software: ['asset_id', 'software_id'], asset_relationships: ['parent_asset_id', 'child_asset_id'], asset_associations: ['asset_id', 'entity_id', 'entity_type'] },
    valueTypes: { asset_associations: { entity_type: 'text' } } });
  const records = input as CoManagedPortableAssetRecords;
  for (const row of records.asset_associations) {
    if (!isCoManagedUuid(row.entity_id) || typeof row.entity_type !== 'string' || !Object.hasOwn(ENTITY_REFERENCES, row.entity_type)) throw new Error('Invalid portable asset association');
    if (row.entity_type === 'asset' && !records.assets.some(asset => asset.asset_id === row.entity_id)) throw new Error('Portable asset association target is missing');
  }
  const types = new Set<string>();
  for (const row of records.asset_type_registry) {
    if (typeof row.slug !== 'string' || !row.slug || types.has(row.slug)) throw new Error('Invalid portable asset type');
    types.add(row.slug);
  }
  const schedules = new Map(records.asset_maintenance_schedules.map(row => [row.schedule_id, row.asset_id]));
  const histories = new Map(records.asset_maintenance_history.map(row => [row.history_id, row]));
  for (const row of [...records.asset_maintenance_history, ...records.asset_maintenance_occurrences]) {
    if (schedules.get(row.schedule_id) !== row.asset_id) throw new Error('Portable asset maintenance source does not match');
  }
  for (const row of records.asset_maintenance_occurrences) {
    const history = row.history_id ? histories.get(row.history_id) : null;
    if (history && (history.asset_id !== row.asset_id || history.schedule_id !== row.schedule_id)) throw new Error('Portable asset maintenance history does not match');
  }
  for (const row of records.assets) if (typeof row.asset_type !== 'string' || (!types.has(row.asset_type) && !BUILTIN_TYPES.has(row.asset_type))) throw new Error('Portable asset type is missing');
}

// Native asset history stores the input patch. Project only operational patch
// fields, including typed detail patches, so historical RMM IDs cannot restore a binding.
function portableHistory(changes: unknown): Record<string, unknown> {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return {};
  const source = changes as Record<string, unknown>;
  const detailTables = ['workstation_assets', 'server_assets', 'network_device_assets', 'printer_assets', 'mobile_device_assets'] as const;
  const allowed = new Set<string>([...COLUMNS.assets, ...detailTables.flatMap(table => [...COLUMNS[table]])]);
  const projected = Object.fromEntries(Object.entries(source).filter(([key]) => allowed.has(key)));
  for (const table of detailTables) {
    const key = table.replace(/_assets$/, '');
    for (const nested of [key, `${key}_details`]) {
      if (source[nested] && typeof source[nested] === 'object' && !Array.isArray(source[nested])) {
        projected[nested] = Object.fromEntries(Object.entries(source[nested] as Record<string, unknown>).filter(([column]) => (COLUMNS[table] as readonly string[]).includes(column)));
      }
    }
  }
  return projected;
}

/** Inventory records component only; provider credentials, RMM identities,
 * procurement links and maintenance dispatch queues are outside this component. */
export async function exportCoManagedPortableAssets(db: Knex, inputActor: CoManagedSessionActor, packageId: string, snapshot?: CoManagedPortableSnapshot) {
  if (db.isTransaction) throw new Error('Portable export requires a root database connection');
  const actor = snapshotCoManagedSessionActor(inputActor);
  if (!isCoManagedUuid(packageId)) throw new CoManagedSharedWorkError();
  return portableSnapshotTransaction(db, snapshot, trx => retainCoManagedPortableAssets(trx, actor, packageId, snapshot?.capturedAt));
}

/** Internal retained collector for a final package-wide current-source check. */
export async function retainCoManagedPortableAssets(trx: Knex.Transaction, inputActor: CoManagedSessionActor, packageId: string, capturedAt?: string) {
  if (!trx.isTransaction) throw new Error('Portable retention requires a transaction');
  const actor = snapshotCoManagedSessionActor(inputActor);
  if (!isCoManagedUuid(packageId)) throw new CoManagedSharedWorkError();
  return withCoManagedExportAdmin(trx, actor, async (current, verified, subject) => {
    if (!await hasCoManagedLocalPermission(current, verified, 'asset', 'read', true)) throw new CoManagedSharedWorkError();
    const own = tenantDb(current, verified.tenant), records = {} as CoManagedPortableAssetRecords;
    for (const table of Object.keys(COLUMNS) as CoManagedPortableAssetTable[]) {
      const ordering = table === 'asset_associations' ? ['asset_id', 'entity_id', 'entity_type']
        : table === 'asset_relationships' ? ['parent_asset_id', 'child_asset_id']
        : table === 'asset_software' ? ['asset_id', 'software_id'] : [COLUMNS[table][0]];
      records[table] = await own.table(table).select(...COLUMNS[table]).orderBy(ordering).limit(100_001).forShare();
    }
    const linksByAsset = new Map<unknown, Record<string, unknown>[]>();
    for (const row of records.asset_associations) {
      const links = linksByAsset.get(row.asset_id) ?? [];
      links.push(row); linksByAsset.set(row.asset_id, links);
    }
    for (const asset of records.assets) {
      // Matches native resolveAssetAuthorizationRecords using the retained actual associations.
      const links = linksByAsset.get(asset.asset_id) ?? [];
      const assignedUserIds = links.filter(row => row.entity_type === 'user').map(row => String(row.entity_id));
      const teamIds = links.filter(row => row.entity_type === 'team').map(row => String(row.entity_id));
      const decision = await authorizeCoManagedLocalRecord(current, verified, subject, 'asset', 'read', {
        id: String(asset.asset_id), clientId: asset.client_id as string | null,
        ownerUserId: assignedUserIds[0] ?? null, assignedUserIds, teamIds,
      });
      if (decision.redactedFields.length) throw new CoManagedSharedWorkError();
    }
    records.asset_history = records.asset_history.map(row => ({ ...row, changes: portableHistory(row.changes) }));
    validateCoManagedPortableAssetRecords(records);
    const [{ captured_at }] = (await current.raw('SELECT transaction_timestamp() AS captured_at')).rows;
    const payload = JSON.parse(JSON.stringify({ kind: 'alga-workspace-assets', version: 1, packageId, sourceTenant: verified.tenant,
      capturedAt: capturedAt ?? captured_at, records, references: CO_MANAGED_PORTABLE_ASSET_REFERENCES,
      polymorphicReferences: [{ table: 'asset_associations', column: 'entity_id', discriminator: 'entity_type', targets: ENTITY_REFERENCES }],
      typeReferences: [{ table: 'assets', column: 'asset_type', parent: 'asset_type_registry', parentColumn: 'slug', builtins: [...BUILTIN_TYPES] }],
      restorePolicy: { sponsorship: 'none', integrations: 'reauthorize', assetFacts: 'historical_snapshot', maintenanceSchedules: 'paused', maintenanceDispatch: 'none', procurement: 'excluded' } }));
    return { ...payload, sha256: createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
  });
}
