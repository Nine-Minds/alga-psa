import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AMP_LIMITS } from '@alga-psa/migration-spec';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { forcedValue } from '@alga-psa/core/capability';
import { createAmpTemporaryDirectory, validateAmpPackage } from '@alga-psa/migration-sdk';
import { MigrationStager } from './MigrationStager';
import { MigrationDomainApplier } from './appliers/MigrationDomainApplier';
import { migrationTargetPolicies, type MigrationJobConfiguration, type MigrationTargetPolicies } from './types';

export const WORKSPACE_TARGET_POLICIES: MigrationTargetPolicies = Object.freeze({
  createTargetTenant: true, deactivateImportedUsers: true, requireReauthForConnections: true, pauseDispatch: true,
});

/** Installation-only admission to the normal AMP staging/ledger/applier pipeline. No archive
 * decoder, restore receipts, source-user login, subscription or provider activation exists here. */
export class AmpWorkspaceImportService {
  constructor(private readonly knex: Knex) {}

  async importPackage(input: { packagePath: string; targetTenant: string; name: string; email: string }) {
    const forced = forcedValue(process.env.FORCE_CAPABILITIES, 'co-managed');
    if (forced === 'off' || forced === 'malformed') throw new Error('Co-managed capability disabled');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.targetTenant) || !input.name.trim() || !input.email.trim()) throw new Error('Fresh target UUID, name and email are required');
    const authority = await this.knex.raw(`SELECT r.rolsuper OR pg_has_role(current_user, d.datdba, 'MEMBER') AS allowed
      FROM pg_roles r CROSS JOIN pg_database d WHERE r.rolname=current_user AND d.datname=current_database()`);
    if (authority.rows.length !== 1 || authority.rows[0].allowed !== true) throw new Error('AMP workspace import requires installation database-owner authority');
    const directory = createAmpTemporaryDirectory('package'), path = join(directory, 'input.amp');
    try {
      let size = 0;
      await pipeline(createReadStream(input.packagePath), new Transform({ transform(chunk, _encoding, callback) {
        size += chunk.length;
        if (size > AMP_LIMITS.packageBytes) return callback(new Error('AMP package limit exceeded'));
        callback(null, chunk);
      } }), createWriteStream(path, { flags: 'wx', mode: 0o600 }));
      return await this.importImmutablePackage({ ...input, packagePath: path });
    } finally { await rm(directory, { recursive: true, force: true }); }
  }

  private async importImmutablePackage(input: { packagePath: string; targetTenant: string; name: string; email: string }) {
    const validation = validateAmpPackage(input.packagePath);
    if (!validation.valid || !validation.manifest) throw new Error(`AMP package rejected: ${validation.diagnostics.map(item => item.code).join(', ')}`);
    if (validation.manifest.source_instance_id?.toLowerCase() === input.targetTenant.toLowerCase()) throw new Error('Source and target tenants must differ');
    const sha256 = createHash('sha256').update(await readFile(input.packagePath)).digest('hex');
    // A dedicated session lock spans creation, staging and resumable application. Other destinations
    // remain independent; a second request cannot import a different package into this target.
    const connection = await this.knex.client.acquireConnection();
    const lock = `amp-workspace:${input.targetTenant.toLowerCase()}`;
    let admittedJobId: string | undefined;
    try {
      await this.knex.raw('SELECT pg_advisory_lock(hashtextextended(?, 0))', [lock]).connection(connection);
      const job = await this.knex.transaction(async trx => {
        const own = tenantDb(trx, input.targetTenant);
        const exists = await own.table('tenants').first();
        if (exists) {
          const previous = await own.table('migration_jobs').where({ package_sha256: sha256 }).first();
          if (!previous || !migrationTargetPolicies(previous)) throw new Error('Target tenant already exists and is not this AMP import');
          return previous;
        }
        await own.table('tenants').insert({ tenant: input.targetTenant, client_name: input.name, email: input.email, product_code: 'psa', suspended_at: trx.fn.now(), suspended_reason: 'amp_workspace_review' });
        const actor = randomUUID(), board = randomUUID(), client = randomUUID();
        await own.table('users').insert({ tenant: input.targetTenant, user_id: actor, username: `amp-import-${actor}`, email: `amp-import-${actor}@invalid`, hashed_password: randomBytes(64).toString('hex'), is_inactive: true, user_type: 'internal' });
        await own.table('clients').insert({ tenant: input.targetTenant, client_id: client, client_name: input.name });
        await own.table('boards').insert({ tenant: input.targetTenant, board_id: board, board_name: 'Imported workspace', is_default: true });
        const configuration: MigrationJobConfiguration = {
          defaultClientId: client,
          tickets: { boardId: board, statusMapping: {}, priorityMapping: {}, defaultRequesterClientId: client },
        };
        const [created] = await own.table('migration_jobs').insert({ tenant: input.targetTenant, migration_job_id: randomUUID(), owner_user_id: actor,
          source_file_name: 'workspace.amp', package_sha256: sha256, created_target: true, target_policies: JSON.stringify(WORKSPACE_TARGET_POLICIES), configuration: JSON.stringify(configuration), state: 'uploaded' }).returning('*');
        return created;
      });
      admittedJobId = job.migration_job_id;
      if (job.state === 'completed') return { targetTenant: input.targetTenant, migrationJobId: job.migration_job_id, state: 'completed', resumed: true };
      const staged = await new MigrationStager(this.knex, input.targetTenant).stage(job.migration_job_id, input.packagePath);
      if (staged.rejected) throw new Error('AMP staging rejected the package');
      await this.configureTicketReferences(input.targetTenant, job.migration_job_id);
      await tenantDb(this.knex, input.targetTenant).table('migration_jobs').where({ migration_job_id: job.migration_job_id }).update({ state: 'applying', error: null });
      const applied = await new MigrationDomainApplier(this.knex, input.targetTenant).applyJob(job.migration_job_id, job.owner_user_id);
      const state = applied.failed || applied.cancelled ? 'failed' : 'completed';
      await tenantDb(this.knex, input.targetTenant).table('migration_jobs').where({ migration_job_id: job.migration_job_id }).update({ state, completed_at: this.knex.fn.now(), updated_at: this.knex.fn.now() });
      return { targetTenant: input.targetTenant, migrationJobId: job.migration_job_id, state, ...applied };
    } catch (error) {
      if (admittedJobId) await tenantDb(this.knex, input.targetTenant).table('migration_jobs').where({ migration_job_id: admittedJobId }).update({ state: 'failed', error: (error as Error).message, updated_at: this.knex.fn.now() });
      throw error;
    } finally {
      try { await this.knex.raw('SELECT pg_advisory_unlock(hashtextextended(?, 0))', [lock]).connection(connection); }
      finally { await this.knex.client.releaseConnection(connection); }
    }
  }

  private async configureTicketReferences(tenant: string, jobId: string) {
    await this.knex.transaction(async trx => {
      const own = tenantDb(trx, tenant);
      const job = await own.table('migration_jobs').where({ migration_job_id: jobId }).forUpdate().first();
      const configuration = typeof job.configuration === 'string' ? JSON.parse(job.configuration) : job.configuration;
      const tickets = await own.table('migration_staged_records').where({ migration_job_id: jobId, entity_type: 'tickets' }).select('payload');
      for (const [field, table, key, nameColumn, mapping] of [
        ['status_name', 'statuses', 'status_id', 'name', 'statusMapping'],
        ['priority_name', 'priorities', 'priority_id', 'priority_name', 'priorityMapping'],
      ]) {
        const names = new Set(tickets.map(row => String((typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload)[field] ?? '')).filter(Boolean));
        for (const name of names) {
          if (configuration.tickets[mapping][name]) continue;
          const id = randomUUID();
          await own.table(table).insert({ tenant, [key]: id, [nameColumn]: name, ...(table === 'statuses' ? { status_type: 'ticket', item_type: 'ticket', order_number: 0, board_id: configuration.tickets.boardId } : {}) });
          configuration.tickets[mapping][name] = id;
        }
      }
      await own.table('migration_jobs').where({ migration_job_id: jobId }).update({ configuration: JSON.stringify(configuration) });
    });
  }
}
