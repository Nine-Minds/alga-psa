import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { portableSnapshotTransaction } from './portableSnapshot';
import { validatePortableRecordSection, type PortableRecords } from './portableRecordValidation';
import type { PortableContributor } from './portableContributorRegistry';
import { withCoManagedExportAdmin } from './portableExport';
import { hasCoManagedLocalPermission } from './localPermission';
import { CoManagedSharedWorkError, isCoManagedUuid, snapshotCoManagedSessionActor, type CoManagedSessionActor } from './sharedWorkIdentity';
import { CO_MANAGED_PORTABLE_ENGAGEMENT_COLUMNS, CO_MANAGED_PORTABLE_ENGAGEMENT_REFERENCES,
  type CoManagedPortableEngagementRecords, type CoManagedPortableEngagementTable } from './portableEngagementCatalog';

const LIMIT = 100_000, CHUNK = 1000;
type Rows = Record<string, unknown>[];
const DESCRIPTORS = ['service_catalog', 'service_types', 'service_categories'] as const;
const configBooleans = ['allow_client_preference', 'auto_approval_enabled'] as const;
const criteriaBooleans = ['require_availability', 'require_contract', 'check_conflicts', 'respect_buffers'] as const;
const configKeys = ['approver_user_ids', 'approver_team_ids', 'default_approver_id', 'default_duration', 'auto_approval_criteria', ...configBooleans];
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Availability JSON is a typed configuration projection: unknown (future
 * provider or authentication) keys cannot ride along with appointment settings. */
function portableAvailabilityConfig(input: unknown) {
  if (input == null) return null;
  const source = typeof input === 'string' ? JSON.parse(input) : input;
  if (!object(source)) throw new Error('Invalid portable availability configuration');
  const result = Object.fromEntries(configKeys.filter(key => Object.hasOwn(source, key)).map(key => [key, source[key]]));
  if (Object.hasOwn(result, 'auto_approval_criteria')) {
    if (!object(result.auto_approval_criteria)) throw new Error('Invalid portable availability criteria');
    const criteria = result.auto_approval_criteria;
    result.auto_approval_criteria = Object.fromEntries(criteriaBooleans.filter(key => Object.hasOwn(criteria, key)).map(key => [key, criteria[key]]));
  }
  return result;
}

export function validateCoManagedPortableEngagementRecords(input: unknown): asserts input is CoManagedPortableEngagementRecords {
  validatePortableRecordSection(input, { columns: CO_MANAGED_PORTABLE_ENGAGEMENT_COLUMNS, references: CO_MANAGED_PORTABLE_ENGAGEMENT_REFERENCES,
    identities: { } });
  const records = input as CoManagedPortableEngagementRecords;
  for (const row of records.availability_settings) {
    if (row.day_of_week !== null && (!Number.isInteger(row.day_of_week) || Number(row.day_of_week) < 0 || Number(row.day_of_week) > 6)) throw new Error('Invalid portable availability day');
    if (row.config_json === null) continue;
    const config = row.config_json;
    if (!object(config) || Object.keys(config).some(key => !configKeys.includes(key))) throw new Error('Invalid portable availability configuration');
    for (const key of ['approver_user_ids', 'approver_team_ids']) {
      if (Object.hasOwn(config, key) && (!Array.isArray(config[key]) || !config[key].every(isCoManagedUuid))) throw new Error('Invalid portable appointment approver');
    }
    if (config.default_approver_id != null && !isCoManagedUuid(config.default_approver_id)) throw new Error('Invalid portable appointment approver');
    if (config.default_duration != null && (!Number.isSafeInteger(config.default_duration) || Number(config.default_duration) < 1)) throw new Error('Invalid portable appointment duration');
    if (configBooleans.some(key => Object.hasOwn(config, key) && typeof config[key] !== 'boolean')) throw new Error('Invalid portable availability setting');
    if (Object.hasOwn(config, 'auto_approval_criteria') && (!object(config.auto_approval_criteria) || Object.entries(config.auto_approval_criteria).some(([key, value]) => !(criteriaBooleans as readonly string[]).includes(key) || typeof value !== 'boolean'))) throw new Error('Invalid portable availability criteria');
  }
}

async function retainCoManagedPortableEngagement(trx: Knex.Transaction, inputActor: CoManagedSessionActor, packageId: string) {
  if (!trx.isTransaction) throw new Error('Portable retention requires a transaction');
  const actor = snapshotCoManagedSessionActor(inputActor);
  if (!isCoManagedUuid(packageId)) throw new CoManagedSharedWorkError();
  return withCoManagedExportAdmin(trx, actor, async (current, verified) => {
    for (const resource of ['interaction', 'user_schedule']) {
      if (!await hasCoManagedLocalPermission(current, verified, resource, 'read', true)) throw new CoManagedSharedWorkError();
    }
    const own = tenantDb(current, verified.tenant), records = {} as CoManagedPortableEngagementRecords;
    for (const table of Object.keys(CO_MANAGED_PORTABLE_ENGAGEMENT_COLUMNS) as CoManagedPortableEngagementTable[]) {
      if ((DESCRIPTORS as readonly string[]).includes(table)) { records[table] = []; continue; }
      const columns = CO_MANAGED_PORTABLE_ENGAGEMENT_COLUMNS[table];
      records[table] = await own.table(table).select(...columns).orderBy(columns[0]).limit(LIMIT + 1).forShare();
      if (records[table].length > LIMIT) throw new Error('Invalid portable engagement record count');
    }
    // Only service descriptors that exported records (or project tasks, whose
    // service link belongs to the work section) actually reference. No commercial
    // catalog is exported.
    const taskServices: Rows = await own.table('project_tasks').whereNotNull('service_id').select('service_id').forShare();
    const serviceIds = [...new Set([...records.appointment_requests, ...records.availability_settings, ...taskServices]
      .map(row => row.service_id as string | null).filter((id): id is string => Boolean(id)))].sort();
    const fetch = async (table: typeof DESCRIPTORS[number], key: string, ids: readonly string[]) => {
      for (let offset = 0; offset < ids.length; offset += CHUNK) {
        records[table].push(...await own.table(table).whereIn(key, ids.slice(offset, offset + CHUNK)).forShare().select(...CO_MANAGED_PORTABLE_ENGAGEMENT_COLUMNS[table]));
      }
    };
    await fetch('service_catalog', 'service_id', serviceIds);
    const distinct = (rows: Rows, column: string) => [...new Set(rows.map(row => row[column] as string | null).filter((id): id is string => Boolean(id)))].sort();
    await fetch('service_types', 'id', distinct(records.service_catalog, 'custom_service_type_id'));
    await fetch('service_categories', 'category_id', distinct(records.service_catalog, 'category_id'));
    for (const table of DESCRIPTORS) {
      const first = CO_MANAGED_PORTABLE_ENGAGEMENT_COLUMNS[table][0];
      records[table].sort((a, b) => String(a[first]).localeCompare(String(b[first])));
    }
    records.availability_settings = records.availability_settings.map(row => ({ ...row, config_json: portableAvailabilityConfig(row.config_json) }));
    validateCoManagedPortableEngagementRecords(records);
    const exclusions = [
      { class: 'commercial', name: 'service_pricing', reason: 'Service descriptors carry no price, tax or billing method; only services referenced by exported records are included.' },
      { class: 'secret', name: 'availability_provider_config', reason: 'Availability configuration is projected to an allowlist; provider and authentication keys are dropped.' },
      { class: 'deferred_domain', name: 'system_interaction_types', reason: 'Global interaction and standard service types are not tenant data and are external edges.' },
      { class: 'msp_private', name: 'co_management_private_notes', reason: 'MSP-private notes live in the author tenant and are never part of this package.' },
    ];
    return { records: JSON.parse(JSON.stringify(records)) as PortableRecords,
      annotations: { exclusions, restorePolicy: { sponsorship: 'none', appointmentDispatch: 'paused', servicePricing: 'unconfigured' } } };
  });
}

// LEVERAGE: pattern portable-contributor-boilerplate — repeats the admission wrapper, permission check, tenantDb handle and JSON round-trip of the core/work/assets contributors.
export const portableEngagementContributor: PortableContributor = {
  id: 'engagement', version: 1, reason: 'customer-owned interactions, appointment requests, availability and referenced service descriptors',
  columns: CO_MANAGED_PORTABLE_ENGAGEMENT_COLUMNS, references: CO_MANAGED_PORTABLE_ENGAGEMENT_REFERENCES,
  export: async ctx => {
    if (ctx.db.isTransaction) throw new Error('Portable export requires a root database connection');
    const actor = snapshotCoManagedSessionActor(ctx.actor);
    if (!isCoManagedUuid(ctx.packageId)) throw new CoManagedSharedWorkError();
    // LEVERAGE: pattern portable-export-is-snapshot-retain — export is the retain run at the shared snapshot.
    return portableSnapshotTransaction(ctx.db, ctx.snapshot, trx => retainCoManagedPortableEngagement(trx, actor, ctx.packageId));
  },
  retain: ctx => retainCoManagedPortableEngagement(ctx.trx, ctx.actor, ctx.packageId),
  validate: records => validateCoManagedPortableEngagementRecords(records),
};
