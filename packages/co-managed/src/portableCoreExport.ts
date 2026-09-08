import { portableSnapshotTransaction, type CoManagedPortableSnapshot } from './portableSnapshot';
import { validatePortableRecordSection } from './portableRecordValidation';
import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { withCoManagedExportAdmin } from './portableExport';
import { hasCoManagedLocalPermission } from './localPermission';
import { authorizeCoManagedLocalRecord, CoManagedSharedWorkError, isCoManagedUuid,
  snapshotCoManagedSessionActor, type CoManagedSessionActor } from './sharedWorkIdentity';

/** Versioned restore projections. New database columns are never implicitly
 * exported. In particular, user authentication, billing, OAuth and provider
 * configuration are not part of these portable identity records. */
export const CO_MANAGED_PORTABLE_CORE_COLUMNS = {
  tenants: ['client_name', 'phone_number', 'email', 'industry', 'created_at', 'updated_at'],
  users: ['user_id', 'username', 'first_name', 'last_name', 'email', 'created_at', 'updated_at', 'is_inactive',
    'user_type', 'contact_id', 'needs_contact_association', 'phone', 'timezone', 'reports_to', 'phone_extension'],
  teams: ['team_id', 'team_name', 'manager_id', 'created_at', 'updated_at'],
  team_members: ['team_id', 'user_id', 'created_at', 'role'],
  roles: ['role_id', 'role_name', 'description', 'created_at', 'updated_at', 'msp', 'client'],
  permissions: ['permission_id', 'resource', 'action', 'created_at', 'msp', 'client', 'description'],
  user_roles: ['user_id', 'role_id', 'created_at'],
  role_permissions: ['role_id', 'permission_id', 'created_at'],
  clients: ['client_id', 'client_name', 'url', 'properties', 'created_at', 'updated_at', 'is_inactive',
    'client_type', 'notes', 'timezone', 'notes_document_id', 'account_manager_id', 'lifecycle_status'],
  client_locations: ['location_id', 'client_id', 'location_name', 'address_line1', 'address_line2', 'address_line3',
    'city', 'state_province', 'postal_code', 'country_code', 'country_name', 'region_code', 'is_billing_address',
    'is_shipping_address', 'is_default', 'phone', 'fax', 'email', 'notes', 'is_active', 'created_at', 'updated_at', 'phone_extension', 'fax_extension'],
  contacts: ['contact_name_id', 'full_name', 'email', 'role', 'approver', 'created_at', 'updated_at', 'is_inactive',
    'notes', 'is_client_admin', 'client_id', 'notes_document_id', 'primary_email_canonical_type', 'primary_email_custom_type_id'],
  contact_phone_numbers: ['contact_phone_number_id', 'contact_name_id', 'phone_number', 'canonical_type',
    'custom_phone_type_id', 'is_default', 'display_order', 'created_at', 'updated_at', 'normalized_phone_number', 'extension'],
  contact_additional_email_addresses: ['contact_additional_email_address_id', 'contact_name_id', 'email_address',
    'canonical_type', 'custom_email_type_id', 'display_order', 'created_at', 'updated_at', 'normalized_email_address'],
  contact_email_type_definitions: ['contact_email_type_id', 'label', 'normalized_label', 'created_at', 'updated_at'],
  contact_phone_type_definitions: ['contact_phone_type_id', 'label', 'normalized_label', 'created_at', 'updated_at'],
  collaboration_actor_references: ['actor_reference_id', 'actor_tenant', 'actor_user_id', 'display_name', 'organization_name', 'created_at', 'updated_at'],
} as const;

export type CoManagedPortableCoreTable = keyof typeof CO_MANAGED_PORTABLE_CORE_COLUMNS;
export type CoManagedPortableCoreRecords = Record<CoManagedPortableCoreTable, Record<string, unknown>[]>;

/** These references are restore dependencies, not instructions to query a
 * source tenant or revive an external user's login. Document references are
 * resolved when the enclosing workspace manifest includes its document section. */
export const CO_MANAGED_PORTABLE_CORE_REFERENCES = [
  ['users', 'contact_id', 'contacts', 'contact_name_id'],
  ['users', 'reports_to', 'users', 'user_id'],
  ['teams', 'manager_id', 'users', 'user_id'],
  ['team_members', 'team_id', 'teams', 'team_id'], ['team_members', 'user_id', 'users', 'user_id'],
  ['user_roles', 'user_id', 'users', 'user_id'], ['user_roles', 'role_id', 'roles', 'role_id'],
  ['role_permissions', 'role_id', 'roles', 'role_id'], ['role_permissions', 'permission_id', 'permissions', 'permission_id'],
  ['clients', 'account_manager_id', 'users', 'user_id'], ['clients', 'notes_document_id', 'documents', 'document_id'],
  ['client_locations', 'client_id', 'clients', 'client_id'],
  ['contacts', 'client_id', 'clients', 'client_id'], ['contacts', 'notes_document_id', 'documents', 'document_id'],
  ['contacts', 'primary_email_custom_type_id', 'contact_email_type_definitions', 'contact_email_type_id'],
  ['contact_phone_numbers', 'contact_name_id', 'contacts', 'contact_name_id'],
  ['contact_phone_numbers', 'custom_phone_type_id', 'contact_phone_type_definitions', 'contact_phone_type_id'],
  ['contact_additional_email_addresses', 'contact_name_id', 'contacts', 'contact_name_id'],
  ['contact_additional_email_addresses', 'custom_email_type_id', 'contact_email_type_definitions', 'contact_email_type_id'],
] as const;

export function validateCoManagedPortableCoreRecords(input: unknown): asserts input is CoManagedPortableCoreRecords {
  validatePortableRecordSection(input, { columns: CO_MANAGED_PORTABLE_CORE_COLUMNS,
    identities: { tenants: [], team_members: ['team_id', 'user_id'], user_roles: ['user_id', 'role_id'], role_permissions: ['role_id', 'permission_id'] },
    counts: { tenants: { min: 1, max: 1 } }, references: CO_MANAGED_PORTABLE_CORE_REFERENCES });
}

/** Captures identities and local directory configuration in one database
 * snapshot. A later assembler must combine this with operational records,
 * document blobs and the encrypted vault before calling it a workspace backup. */
export async function exportCoManagedPortableCore(db: Knex, inputActor: CoManagedSessionActor, packageId: string, snapshot?: CoManagedPortableSnapshot) {
  if (db.isTransaction) throw new Error('Portable export requires a root database connection');
  const actor = snapshotCoManagedSessionActor(inputActor);
  if (!isCoManagedUuid(packageId)) throw new CoManagedSharedWorkError();
  return portableSnapshotTransaction(db, snapshot, trx => retainCoManagedPortableCore(trx, actor, packageId, snapshot?.capturedAt));
}

/** Internal retained collector for a final package-wide current-source check. */
export async function retainCoManagedPortableCore(trx: Knex.Transaction, inputActor: CoManagedSessionActor, packageId: string, capturedAt?: string) {
  if (!trx.isTransaction) throw new Error('Portable retention requires a transaction');
  const actor = snapshotCoManagedSessionActor(inputActor);
  if (!isCoManagedUuid(packageId)) throw new CoManagedSharedWorkError();
  return withCoManagedExportAdmin(trx, actor, async (current, verified, subject) => {
    for (const resource of ['user', 'team', 'client', 'contact', 'security_settings']) {
      if (!await hasCoManagedLocalPermission(current, verified, resource, 'read', true)) throw new CoManagedSharedWorkError();
    }
    const security = await authorizeCoManagedLocalRecord(current, verified, subject, 'security_settings', 'read', { id: verified.tenant });
    if (security.redactedFields.length) throw new CoManagedSharedWorkError();
    const own = tenantDb(current, verified.tenant);
    const records = {} as CoManagedPortableCoreRecords;
    for (const table of Object.keys(CO_MANAGED_PORTABLE_CORE_COLUMNS) as CoManagedPortableCoreTable[]) {
      const columns = CO_MANAGED_PORTABLE_CORE_COLUMNS[table];
      const query = own.table(table).select(...columns).limit(100_001).forShare();
      // Fixed projection order gives a stable digest; table identities and
      // compound membership keys precede descriptive fields in each projection.
      for (const column of columns.slice(0, table === 'tenants' ? 1 : 2)) query.orderBy(column);
      records[table] = await query;
    }
    for (const [table, resource, id] of [['users', 'user', 'user_id'], ['teams', 'team', 'team_id'],
      ['clients', 'client', 'client_id'], ['contacts', 'contact', 'contact_name_id']] as const) {
      for (const row of records[table]) {
        const decision = await authorizeCoManagedLocalRecord(current, verified, subject, resource, 'read', {
          id: String(row[id]), clientId: table === 'clients' ? String(row[id]) : row.client_id as string | undefined,
          ownerUserId: table === 'users' ? String(row[id]) : row.manager_id as string | undefined,
          teamIds: table === 'teams' ? [String(row[id])] : undefined,
        });
        if (decision.redactedFields.length) throw new CoManagedSharedWorkError();
      }
    }
    validateCoManagedPortableCoreRecords(records);
    const [{ captured_at }] = (await current.raw('SELECT transaction_timestamp() AS captured_at')).rows;
    const payload = JSON.parse(JSON.stringify({ kind: 'alga-workspace-core', version: 1, packageId,
      sourceTenant: verified.tenant, capturedAt: capturedAt ?? captured_at, records, references: CO_MANAGED_PORTABLE_CORE_REFERENCES,
      restorePolicy: { authentication: 'reauthorize', sponsorship: 'none' } }));
    return { ...payload, sha256: createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
  });
}
