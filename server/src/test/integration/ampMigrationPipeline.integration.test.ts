import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { tenantDb } from '@alga-psa/db';
import { convertSpreadsheets, inferSpreadsheetMapping } from '@alga-psa/migration-connectors/csv';
import { buildSamplePackage, sampleEntityRows } from '@alga-psa/migration-sdk';
import type { AmpPackageRows } from '@alga-psa/migration-spec';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import { MigrationStager } from '../../lib/migrations/MigrationStager';
import { loadMigrationConfigurationOptions } from '../../lib/migrations/migrationActions';
import { MigrationPlanner } from '../../lib/migrations/MigrationPlanner';
import { MigrationDomainApplier } from '../../lib/migrations/appliers/MigrationDomainApplier';
import type { MigrationJobConfiguration } from '../../lib/migrations/types';

const HOOK_TIMEOUT = 180_000;

const ALL_ENTITY_TYPES = [
  'organizations',
  'locations',
  'contacts',
  'tickets',
  'ticket_comments',
  'assets',
] as const;

type ColumnInfoMap = Record<string, unknown>;

type Fixture = {
  tenantId: string;
  ownerUserId: string;
  clientId: string;
  boardId: string;
  statusOpenId: string;
  priorityId: string;
};

let db: Knex;
const tenantsToCleanup = new Set<string>();
let packageDir: string;
let tenantColumns: ColumnInfoMap;
let userColumns: ColumnInfoMap;
let boardColumns: ColumnInfoMap;
let clientColumns: ColumnInfoMap;
let statusColumns: ColumnInfoMap;
let priorityColumns: ColumnInfoMap;

function hasColumn(columns: ColumnInfoMap, columnName: string): boolean {
  return Object.prototype.hasOwnProperty.call(columns, columnName);
}

function tenantTable(tenantId: string, table: string) {
  return tenantDb(db, tenantId).table(table);
}

function tenantRows() {
  return tenantDb(db, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture creates and removes tenant rows');
}

function schemaTable(table: string) {
  return tenantDb(db, '__test_schema__')
    .unscoped(table, 'columnInfo reads schema metadata, not tenant rows');
}

async function cleanupTenant(tenantId: string): Promise<void> {
  // Ledger first: identity mappings FK migration_jobs without cascade; the
  // rest of the migration_* rows cascade off migration_jobs.
  await tenantTable(tenantId, 'migration_identity_mappings').del();
  await tenantTable(tenantId, 'migration_jobs').del();
  await tenantTable(tenantId, 'asset_type_registry').del();
  // Domain rows, children before parents.
  await tenantTable(tenantId, 'asset_history').del();
  await tenantTable(tenantId, 'assets').del();
  await tenantTable(tenantId, 'comments').del();
  await tenantTable(tenantId, 'comment_threads').del();
  await tenantTable(tenantId, 'tickets').del();
  await tenantTable(tenantId, 'next_number').del();
  await tenantTable(tenantId, 'contact_phone_numbers').del();
  await tenantTable(tenantId, 'contact_additional_email_addresses').del();
  await tenantTable(tenantId, 'contacts').del();
  await tenantTable(tenantId, 'client_locations').del();
  await tenantTable(tenantId, 'statuses').del();
  await tenantTable(tenantId, 'priorities').del();
  await tenantTable(tenantId, 'boards').del();
  // ClientModel.createClient scaffolds billing/tax defaults per client.
  await tenantTable(tenantId, 'client_tax_settings').del();
  await tenantTable(tenantId, 'client_tax_rates').del();
  await tenantTable(tenantId, 'tax_rates').del();
  await tenantTable(tenantId, 'tax_regions').del();
  await tenantTable(tenantId, 'client_contracts').del();
  await tenantTable(tenantId, 'contracts').del();
  await tenantTable(tenantId, 'client_billing_profiles').del();
  await tenantTable(tenantId, 'clients').del();
  await tenantTable(tenantId, 'users').del();
  await tenantRows().where({ tenant: tenantId }).del();
}

async function createFixture(): Promise<Fixture> {
  const tenantId = uuidv4();
  const ownerUserId = uuidv4();
  const clientId = uuidv4();
  const boardId = uuidv4();
  const statusOpenId = uuidv4();
  const priorityId = uuidv4();

  tenantsToCleanup.add(tenantId);

  await tenantRows().insert({
    tenant: tenantId,
    ...(hasColumn(tenantColumns, 'company_name')
      ? { company_name: `Tenant ${tenantId.slice(0, 8)}` }
      : { client_name: `Tenant ${tenantId.slice(0, 8)}` }),
    email: `tenant-${tenantId.slice(0, 8)}@example.com`,
    ...(hasColumn(tenantColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(tenantColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await tenantTable(tenantId, 'users').insert({
    tenant: tenantId,
    user_id: ownerUserId,
    username: `owner-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    ...(hasColumn(userColumns, 'role') ? { role: 'admin' } : {}),
    ...(hasColumn(userColumns, 'email') ? { email: `owner-${tenantId.slice(0, 8)}@example.com` } : {}),
    ...(hasColumn(userColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(userColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  // ClientModel.createClient links each new client to the tenant's first
  // active tax rate; without one it falls into a legacy default-rate insert
  // that no longer matches the tax_rates schema. Seed a real rate.
  await tenantTable(tenantId, 'tax_regions').insert({
    tenant: tenantId,
    region_code: 'US-TEST',
    region_name: 'Test Region',
    is_active: true,
  });
  await tenantTable(tenantId, 'tax_rates').insert({
    tenant: tenantId,
    tax_rate_id: uuidv4(),
    tax_percentage: 0,
    region_code: 'US-TEST',
    description: 'Test default rate',
    start_date: '2020-01-01',
    is_active: true,
  });

  await tenantTable(tenantId, 'clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: `Fixture Client ${tenantId.slice(0, 8)}`,
    ...(hasColumn(clientColumns, 'is_inactive') ? { is_inactive: false } : {}),
    ...(hasColumn(clientColumns, 'billing_cycle') ? { billing_cycle: 'monthly' } : {}),
    ...(hasColumn(clientColumns, 'is_tax_exempt') ? { is_tax_exempt: false } : {}),
    ...(hasColumn(clientColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(clientColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await tenantTable(tenantId, 'boards').insert({
    tenant: tenantId,
    board_id: boardId,
    board_name: 'Migrated Tickets',
    ...(hasColumn(boardColumns, 'description') ? { description: 'AMP target board' } : {}),
    ...(hasColumn(boardColumns, 'display_order') ? { display_order: 10 } : {}),
    ...(hasColumn(boardColumns, 'is_default') ? { is_default: true } : {}),
    ...(hasColumn(boardColumns, 'is_inactive') ? { is_inactive: false } : {}),
    ...(hasColumn(boardColumns, 'is_active') ? { is_active: true } : {}),
    ...(hasColumn(boardColumns, 'category_type') ? { category_type: 'custom' } : {}),
    ...(hasColumn(boardColumns, 'priority_type') ? { priority_type: 'custom' } : {}),
    ...(hasColumn(boardColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(boardColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await tenantTable(tenantId, 'priorities').insert({
    tenant: tenantId,
    priority_id: priorityId,
    priority_name: 'High',
    ...(hasColumn(priorityColumns, 'item_type') ? { item_type: 'ticket' } : {}),
    ...(hasColumn(priorityColumns, 'order_number') ? { order_number: 10 } : {}),
    ...(hasColumn(priorityColumns, 'color') ? { color: '#EF4444' } : {}),
    ...(hasColumn(priorityColumns, 'created_by') ? { created_by: ownerUserId } : {}),
    ...(hasColumn(priorityColumns, 'updated_by') ? { updated_by: ownerUserId } : {}),
    ...(hasColumn(priorityColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(priorityColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await tenantTable(tenantId, 'statuses').insert({
    tenant: tenantId,
    status_id: statusOpenId,
    ...(hasColumn(statusColumns, 'board_id') ? { board_id: boardId } : {}),
    name: 'Open',
    ...(hasColumn(statusColumns, 'status_type') ? { status_type: 'ticket' } : {}),
    ...(hasColumn(statusColumns, 'item_type') ? { item_type: 'ticket' } : {}),
    is_closed: false,
    is_default: true,
    order_number: 10,
    created_by: ownerUserId,
    ...(hasColumn(statusColumns, 'is_custom') ? { is_custom: true } : {}),
    ...(hasColumn(statusColumns, 'standard_status_id') ? { standard_status_id: null } : {}),
    ...(hasColumn(statusColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(statusColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  return { tenantId, ownerUserId, clientId, boardId, statusOpenId, priorityId };
}

async function createJob(fixture: Fixture): Promise<string> {
  const migrationJobId = uuidv4();
  await tenantTable(fixture.tenantId, 'migration_jobs').insert({
    tenant: fixture.tenantId,
    migration_job_id: migrationJobId,
    owner_user_id: fixture.ownerUserId,
    source_file_name: 'test.amp',
    package_sha256: 'test',
    state: 'inspecting',
  });
  return migrationJobId;
}

function fullConfiguration(fixture: Fixture): MigrationJobConfiguration {
  return {
    defaultClientId: fixture.clientId,
    tickets: {
      boardId: fixture.boardId,
      statusMapping: { Open: fixture.statusOpenId },
      priorityMapping: { High: fixture.priorityId },
      defaultRequesterClientId: fixture.clientId,
    },
    assets: {
      // 'Firewall' maps to the built-in network_device slug, which
      // isBuiltinAssetTypeSlug accepts without an asset_type_registry row.
      assetTypeMapping: { Firewall: 'network_device' },
    },
  };
}

async function configureJob(
  fixture: Fixture,
  migrationJobId: string,
  configuration: MigrationJobConfiguration
): Promise<void> {
  await tenantTable(fixture.tenantId, 'migration_jobs')
    .where({ migration_job_id: migrationJobId })
    .update({ configuration: JSON.stringify(configuration) });
}

function buildPackage(name: string, rows?: AmpPackageRows): string {
  const packagePath = path.join(packageDir, `${name}-${uuidv4().slice(0, 8)}.amp`);
  buildSamplePackage(packagePath, {}, rows);
  return packagePath;
}

async function stagedCountsByEntity(
  tenantId: string,
  migrationJobId: string
): Promise<Record<string, number>> {
  const rows = await tenantTable(tenantId, 'migration_staged_records')
    .where({ migration_job_id: migrationJobId })
    .groupBy('entity_type')
    .select('entity_type')
    .count({ count: '*' });
  return Object.fromEntries(rows.map((row: any) => [row.entity_type, Number(row.count)]));
}

async function stageAndConfigure(fixture: Fixture, packagePath: string): Promise<string> {
  const migrationJobId = await createJob(fixture);
  const staging = await new MigrationStager(db, fixture.tenantId).stage(migrationJobId, packagePath);
  expect(staging.rejected).toBe(false);
  await configureJob(fixture, migrationJobId, fullConfiguration(fixture));
  return migrationJobId;
}

async function migratedClientId(tenantId: string): Promise<string> {
  const acme = await tenantTable(tenantId, 'clients')
    .where({ client_name: 'Acme Managed Networks' })
    .first();
  expect(acme).toBeDefined();
  return acme.client_id;
}

describe('AMP migration pipeline integration', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection({ runSeeds: false });
    packageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amp-pipeline-'));
    tenantColumns = await schemaTable('tenants').columnInfo();
    userColumns = await schemaTable('users').columnInfo();
    boardColumns = await schemaTable('boards').columnInfo();
    clientColumns = await schemaTable('clients').columnInfo();
    statusColumns = await schemaTable('statuses').columnInfo();
    priorityColumns = await schemaTable('priorities').columnInfo();
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    for (const tenantId of tenantsToCleanup) {
      await cleanupTenant(tenantId);
      tenantsToCleanup.delete(tenantId);
    }
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    if (packageDir) {
      fs.rmSync(packageDir, { recursive: true, force: true });
    }
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  it('stages, preflights ready, and applies every entity once', async () => {
    const fixture = await createFixture();
    const packagePath = buildPackage('happy-path');
    const migrationJobId = await createJob(fixture);

    const staging = await new MigrationStager(db, fixture.tenantId).stage(migrationJobId, packagePath);
    expect(staging.rejected).toBe(false);
    expect(staging.stagedCounts).toEqual({
      organizations: 1,
      locations: 1,
      contacts: 1,
      tickets: 1,
      ticket_comments: 1,
      assets: 1,
    });
    expect(await stagedCountsByEntity(fixture.tenantId, migrationJobId)).toEqual({
      organizations: 1,
      locations: 1,
      contacts: 1,
      tickets: 1,
      ticket_comments: 1,
      assets: 1,
    });

    const jobAfterStaging = await tenantTable(fixture.tenantId, 'migration_jobs')
      .where({ migration_job_id: migrationJobId })
      .first();
    expect(jobAfterStaging.state).toBe('needs_configuration');
    expect(jobAfterStaging.package_id).toBe('amp-sample-package');

    await configureJob(fixture, migrationJobId, fullConfiguration(fixture));

    const preflight = await new MigrationPlanner(db, fixture.tenantId).preflight(migrationJobId);
    expect(preflight.issues).toEqual([]);
    expect(preflight.state).toBe('ready');
    expect(preflight.plan).toHaveLength(ALL_ENTITY_TYPES.length);
    expect(preflight.plan.map((entry) => entry.entityType)).toEqual([...ALL_ENTITY_TYPES]);
    for (const entry of preflight.plan) {
      expect(entry).toMatchObject({
        stagedCount: 1,
        toCreate: 1,
        toSkipIdentityMapped: 0,
        blocked: 0,
      });
    }

    const result = await new MigrationDomainApplier(db, fixture.tenantId).applyJob(
      migrationJobId,
      fixture.ownerUserId
    );
    expect(result).toEqual({ cancelled: false, created: 6, skipped: 0, failed: 0 });

    // Domain rows exist and carry the operator-configured references.
    const acmeClientId = await migratedClientId(fixture.tenantId);

    const locations = await tenantTable(fixture.tenantId, 'client_locations')
      .where({ client_id: acmeClientId });
    expect(locations).toHaveLength(1);
    expect(locations[0].location_name).toBe('Headquarters');

    const contact = await tenantTable(fixture.tenantId, 'contacts')
      .where({ email: 'jane.doe@acme.example' })
      .first();
    expect(contact).toBeDefined();
    expect(contact.full_name).toBe('Jane Doe');
    expect(contact.client_id).toBe(acmeClientId);

    const ticket = await tenantTable(fixture.tenantId, 'tickets')
      .where({ title: 'VPN drops every afternoon' })
      .first();
    expect(ticket).toBeDefined();
    expect(ticket.board_id).toBe(fixture.boardId);
    expect(ticket.status_id).toBe(fixture.statusOpenId);
    expect(ticket.priority_id).toBe(fixture.priorityId);
    expect(ticket.client_id).toBe(acmeClientId);
    expect(ticket.contact_name_id).toBe(contact.contact_name_id);

    const comments = await tenantTable(fixture.tenantId, 'comments')
      .where({ ticket_id: ticket.ticket_id });
    expect(comments).toHaveLength(1);
    expect(comments[0].note).toBe('It happened again today at 3:10pm.');
    expect(comments[0].contact_id).toBe(contact.contact_name_id);

    const asset = await tenantTable(fixture.tenantId, 'assets')
      .where({ name: 'Edge Firewall' })
      .first();
    expect(asset).toBeDefined();
    expect(asset.asset_type).toBe('network_device');
    expect(asset.client_id).toBe(acmeClientId);
    expect(asset.serial_number).toBe('FW-0001');

    // The ledger records one identity mapping per created record...
    const mappings = await tenantTable(fixture.tenantId, 'migration_identity_mappings')
      .where({ migration_job_id: migrationJobId });
    expect(mappings).toHaveLength(6);
    const mappingByEntity = Object.fromEntries(
      mappings.map((row: any) => [row.entity_type, row])
    );
    expect(Object.keys(mappingByEntity).sort()).toEqual([...ALL_ENTITY_TYPES].sort());
    expect(mappingByEntity.organizations.target_entity_id).toBe(acmeClientId);
    expect(mappingByEntity.organizations.target_entity_type).toBe('client');
    expect(mappingByEntity.locations.target_entity_id).toBe(locations[0].location_id);
    expect(mappingByEntity.contacts.target_entity_id).toBe(contact.contact_name_id);
    expect(mappingByEntity.tickets.target_entity_id).toBe(ticket.ticket_id);
    expect(mappingByEntity.ticket_comments.target_entity_id).toBe(comments[0].comment_id);
    expect(mappingByEntity.assets.target_entity_id).toBe(asset.asset_id);

    // ...and one 'created' outcome per staged record on attempt 1.
    const outcomes = await tenantTable(fixture.tenantId, 'migration_record_outcomes')
      .where({ migration_job_id: migrationJobId });
    expect(outcomes).toHaveLength(6);
    for (const outcome of outcomes) {
      expect(outcome.attempt).toBe(1);
      expect(outcome.action).toBe('created');
      expect(outcome.target_entity_id).toBeTruthy();
    }

    const jobEntities = await tenantTable(fixture.tenantId, 'migration_job_entities')
      .where({ migration_job_id: migrationJobId });
    expect(jobEntities).toHaveLength(6);
    for (const entity of jobEntities) {
      expect(entity.state).toBe('completed');
      expect(entity.applied_count).toBe(1);
      expect(entity.failed_count).toBe(0);
    }
  }, HOOK_TIMEOUT);

  it('loads asset-type configuration options against the migrated registry schema', async () => {
    const fixture = await createFixture();
    const migrationJobId = await createJob(fixture);
    await tenantTable(fixture.tenantId, 'asset_type_registry').insert({
      tenant: fixture.tenantId,
      slug: 'door_access',
      name: 'Door Access',
      fields_schema: JSON.stringify([]),
    });

    const options = await loadMigrationConfigurationOptions(
      tenantDb(db, fixture.tenantId),
      db,
      migrationJobId,
    );

    expect(options.assetTypes).toContainEqual({ slug: 'door_access', name: 'Door Access' });
  }, HOOK_TIMEOUT);

  it('recognizes an otherwise valid AMP package with no importable records', () => {
    const packagePath = buildPackage('empty-package', {});
    expect(MigrationStager.hasImportableRecords(packagePath)).toBe(false);
  });

  it('stages a legacy asset CSV after conversion through the upload guard', async () => {
    const fixture = await createFixture();
    const inputPath = path.join(packageDir, `legacy-assets-${uuidv4()}.csv`);
    const packagePath = path.join(packageDir, `legacy-assets-${uuidv4()}.amp`);
    await fs.promises.writeFile(
      inputPath,
      'Asset Name,Asset Type,Serial Number,MAC Address\nrouter,network_device,R-1,00:11:22:33:44:55\n'
    );

    const mapping = await inferSpreadsheetMapping(inputPath, 'assets');
    const conversion = await convertSpreadsheets({
      outputPath: packagePath,
      namespace: `csv:${fixture.tenantId}`,
      sourceSystem: 'csv-upload',
      files: [{ entityType: 'assets', path: inputPath, mapping }],
    }, packageDir);

    expect(conversion.rowCounts).toEqual({ assets: 1 });
    expect(MigrationStager.hasImportableRecords(packagePath)).toBe(true);

    const migrationJobId = await createJob(fixture);
    const staging = await new MigrationStager(db, fixture.tenantId).stage(migrationJobId, packagePath);
    expect(staging.rejected).toBe(false);
    expect(staging.stagedCounts).toMatchObject({ assets: 1 });
    expect(await stagedCountsByEntity(fixture.tenantId, migrationJobId)).toEqual({ assets: 1 });

    const job = await tenantTable(fixture.tenantId, 'migration_jobs')
      .where({ migration_job_id: migrationJobId })
      .first();
    expect(job.state).toBe('needs_configuration');
  }, HOOK_TIMEOUT);

  it('re-running the same job creates no duplicates', async () => {
    const fixture = await createFixture();
    const packagePath = buildPackage('rerun');
    const migrationJobId = await stageAndConfigure(fixture, packagePath);
    const applier = new MigrationDomainApplier(db, fixture.tenantId);

    const first = await applier.applyJob(migrationJobId, fixture.ownerUserId);
    expect(first).toEqual({ cancelled: false, created: 6, skipped: 0, failed: 0 });

    const second = await applier.applyJob(migrationJobId, fixture.ownerUserId);
    expect(second).toEqual({ cancelled: false, created: 0, skipped: 6, failed: 0 });

    // Domain tables are unchanged: exactly one migrated row apiece.
    const acmeClientId = await migratedClientId(fixture.tenantId);
    expect(
      await tenantTable(fixture.tenantId, 'clients').where({ client_name: 'Acme Managed Networks' })
    ).toHaveLength(1);
    expect(
      await tenantTable(fixture.tenantId, 'client_locations').where({ client_id: acmeClientId })
    ).toHaveLength(1);
    expect(
      await tenantTable(fixture.tenantId, 'contacts').where({ email: 'jane.doe@acme.example' })
    ).toHaveLength(1);
    expect(
      await tenantTable(fixture.tenantId, 'tickets').where({ title: 'VPN drops every afternoon' })
    ).toHaveLength(1);
    expect(await tenantTable(fixture.tenantId, 'comments')).toHaveLength(1);
    expect(
      await tenantTable(fixture.tenantId, 'assets').where({ name: 'Edge Firewall' })
    ).toHaveLength(1);

    // The second attempt is fully recorded as skips.
    const secondAttemptOutcomes = await tenantTable(fixture.tenantId, 'migration_record_outcomes')
      .where({ migration_job_id: migrationJobId, attempt: 2 });
    expect(secondAttemptOutcomes).toHaveLength(6);
    for (const outcome of secondAttemptOutcomes) {
      expect(outcome.action).toBe('skipped');
      expect(outcome.target_entity_id).toBeTruthy();
    }

    // Identity mappings were not duplicated by the re-run.
    expect(
      await tenantTable(fixture.tenantId, 'migration_identity_mappings')
        .where({ migration_job_id: migrationJobId })
    ).toHaveLength(6);
  }, HOOK_TIMEOUT);

  it('a record failing mid-run leaves a truthful ledger and retry applies only unapplied work', async () => {
    const fixture = await createFixture();
    const rows = sampleEntityRows();
    rows.contacts = [
      ...(rows.contacts ?? []),
      {
        package_record_id: 'contact-bob',
        source_record_id: 'src-contact-2',
        external_identifier_namespace: 'fixture:instance-1',
        organization_package_record_id: 'org-acme',
        first_name: 'Bob',
        last_name: 'NoMail',
        // No email: the contact applier rejects this record while everything
        // else in the package applies.
      },
    ];
    const packagePath = buildPackage('partial-failure', rows);
    const migrationJobId = await stageAndConfigure(fixture, packagePath);
    const applier = new MigrationDomainApplier(db, fixture.tenantId);

    const first = await applier.applyJob(migrationJobId, fixture.ownerUserId);
    expect(first).toEqual({ cancelled: false, created: 6, skipped: 0, failed: 1 });

    const bobStaged = await tenantTable(fixture.tenantId, 'migration_staged_records')
      .where({ migration_job_id: migrationJobId, entity_type: 'contacts', package_record_id: 'contact-bob' })
      .first();
    expect(bobStaged).toBeDefined();

    const bobFirstOutcome = await tenantTable(fixture.tenantId, 'migration_record_outcomes')
      .where({ migration_staged_record_id: bobStaged.migration_staged_record_id, attempt: 1 })
      .first();
    expect(bobFirstOutcome.action).toBe('failed');
    expect(bobFirstOutcome.errors).toEqual([
      'Contact has no email address; the contact model requires one.',
    ]);
    expect(bobFirstOutcome.target_entity_id).toBeNull();

    // No identity mapping exists for the failed record.
    const bobMapping = await tenantTable(fixture.tenantId, 'migration_identity_mappings')
      .where({ entity_type: 'contacts', source_record_id: 'src-contact-2' })
      .first();
    expect(bobMapping).toBeUndefined();

    // Retry: everything already applied is skipped; the broken record is
    // retried (and fails again) without duplicating anything.
    const second = await applier.applyJob(migrationJobId, fixture.ownerUserId);
    expect(second).toEqual({ cancelled: false, created: 0, skipped: 6, failed: 1 });

    const bobSecondOutcome = await tenantTable(fixture.tenantId, 'migration_record_outcomes')
      .where({ migration_staged_record_id: bobStaged.migration_staged_record_id, attempt: 2 })
      .first();
    expect(bobSecondOutcome.action).toBe('failed');

    const contacts = await tenantTable(fixture.tenantId, 'contacts');
    expect(contacts).toHaveLength(1);
    expect(contacts[0].email).toBe('jane.doe@acme.example');
    expect(
      await tenantTable(fixture.tenantId, 'clients').where({ client_name: 'Acme Managed Networks' })
    ).toHaveLength(1);
  }, HOOK_TIMEOUT);

  it('cancellation stops at a checkpoint', async () => {
    const fixture = await createFixture();
    const packagePath = buildPackage('cancelled');
    const migrationJobId = await stageAndConfigure(fixture, packagePath);

    await tenantTable(fixture.tenantId, 'migration_jobs')
      .where({ migration_job_id: migrationJobId })
      .update({ cancel_requested_at: db.fn.now() });

    const result = await new MigrationDomainApplier(db, fixture.tenantId).applyJob(
      migrationJobId,
      fixture.ownerUserId
    );
    expect(result).toEqual({ cancelled: true, created: 0, skipped: 0, failed: 0 });

    // The checkpoint fired before the first batch: nothing was created.
    expect(
      await tenantTable(fixture.tenantId, 'clients').where({ client_name: 'Acme Managed Networks' })
    ).toHaveLength(0);
    expect(
      await tenantTable(fixture.tenantId, 'migration_identity_mappings')
        .where({ migration_job_id: migrationJobId })
    ).toHaveLength(0);
    expect(
      await tenantTable(fixture.tenantId, 'migration_record_outcomes')
        .where({ migration_job_id: migrationJobId })
    ).toHaveLength(0);

    const firstEntity = await tenantTable(fixture.tenantId, 'migration_job_entities')
      .where({ migration_job_id: migrationJobId, entity_type: 'organizations' })
      .first();
    expect(firstEntity.state).toBe('cancelled');

    // Later phases were never started.
    const laterEntities = await tenantTable(fixture.tenantId, 'migration_job_entities')
      .where({ migration_job_id: migrationJobId })
      .whereNot({ entity_type: 'organizations' });
    for (const entity of laterEntities) {
      expect(entity.state).toBe('pending');
    }
  }, HOOK_TIMEOUT);

  it('cross-tenant configuration is rejected at preflight', async () => {
    const tenantA = await createFixture();
    const tenantB = await createFixture();
    const packagePath = buildPackage('cross-tenant');
    const migrationJobId = await createJob(tenantA);

    const staging = await new MigrationStager(db, tenantA.tenantId).stage(migrationJobId, packagePath);
    expect(staging.rejected).toBe(false);

    // Everything valid for tenant A except the board, which belongs to tenant B.
    await configureJob(tenantA, migrationJobId, {
      ...fullConfiguration(tenantA),
      tickets: {
        ...fullConfiguration(tenantA).tickets!,
        boardId: tenantB.boardId,
      },
    });

    const preflight = await new MigrationPlanner(db, tenantA.tenantId).preflight(migrationJobId);
    expect(preflight.state).toBe('blocked');
    expect(preflight.issues.map((issue) => issue.code)).toContain('CONFIG_BOARD_NOT_FOUND');

    const jobAfterPreflight = await tenantTable(tenantA.tenantId, 'migration_jobs')
      .where({ migration_job_id: migrationJobId })
      .first();
    expect(jobAfterPreflight.state).toBe('blocked');

    // Tenant B cannot see tenant A's job through tenant-scoped access.
    const visibleToTenantB = await tenantTable(tenantB.tenantId, 'migration_jobs')
      .where({ migration_job_id: migrationJobId });
    expect(visibleToTenantB).toHaveLength(0);
  }, HOOK_TIMEOUT);

  it('identity mappings are tenant-scoped', async () => {
    const tenantA = await createFixture();
    const tenantB = await createFixture();
    const packagePath = buildPackage('two-tenants');

    const jobA = await stageAndConfigure(tenantA, packagePath);
    const jobB = await stageAndConfigure(tenantB, packagePath);

    const resultA = await new MigrationDomainApplier(db, tenantA.tenantId).applyJob(
      jobA,
      tenantA.ownerUserId
    );
    expect(resultA).toEqual({ cancelled: false, created: 6, skipped: 0, failed: 0 });

    // The same package (same namespace + source ids) applies fully in tenant B:
    // tenant A's identity mappings do not shadow tenant B's ledger.
    const resultB = await new MigrationDomainApplier(db, tenantB.tenantId).applyJob(
      jobB,
      tenantB.ownerUserId
    );
    expect(resultB).toEqual({ cancelled: false, created: 6, skipped: 0, failed: 0 });

    const clientA = await migratedClientId(tenantA.tenantId);
    const clientB = await migratedClientId(tenantB.tenantId);
    expect(clientA).not.toBe(clientB);

    const mappingsA = await tenantTable(tenantA.tenantId, 'migration_identity_mappings');
    const mappingsB = await tenantTable(tenantB.tenantId, 'migration_identity_mappings');
    expect(mappingsA).toHaveLength(6);
    expect(mappingsB).toHaveLength(6);
    for (const mapping of mappingsA) {
      expect(mapping.tenant).toBe(tenantA.tenantId);
      expect(mapping.migration_job_id).toBe(jobA);
    }
    for (const mapping of mappingsB) {
      expect(mapping.tenant).toBe(tenantB.tenantId);
      expect(mapping.migration_job_id).toBe(jobB);
    }

    // The two tenants resolved the same source records to disjoint targets.
    const targetsA = new Set(mappingsA.map((row: any) => row.target_entity_id));
    const targetsB = new Set(mappingsB.map((row: any) => row.target_entity_id));
    for (const target of targetsB) {
      expect(targetsA.has(target)).toBe(false);
    }
  }, HOOK_TIMEOUT);
});
