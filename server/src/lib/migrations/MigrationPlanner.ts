import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import type { AmpEntityType } from '@alga-psa/migration-spec';
import {
  MIGRATION_PHASE_ORDER,
  type MigrationJobConfiguration,
  type PreflightEntityPlan,
  type PreflightIssue,
  type PreflightResult,
} from './types';

const SAMPLE_LIMIT = 20;

/**
 * Resolves operator configuration against tenant reference data and produces
 * the dry-run plan for all staged entities. Preflight never creates an Alga
 * entity; it only reads staging, the identity ledger, and tenant reference
 * tables, then records the plan.
 */
export class MigrationPlanner {
  constructor(
    private readonly knex: Knex,
    private readonly tenant: string
  ) {}

  async preflight(migrationJobId: string): Promise<PreflightResult> {
    const db = tenantDb(this.knex, this.tenant);
    const job = await db.table('migration_jobs').where({ migration_job_id: migrationJobId }).first();
    if (!job) {
      throw new Error(`Migration job ${migrationJobId} was not found in this tenant`);
    }
    const configuration = parseConfiguration(job.configuration);

    const stagedCounts = await this.stagedCountsByEntity(migrationJobId);
    const issues: PreflightIssue[] = [];

    await this.resetRecordBlocks(migrationJobId);

    if ((stagedCounts.tickets ?? 0) > 0) {
      issues.push(...(await this.checkTicketConfiguration(migrationJobId, configuration)));
    }
    if ((stagedCounts.assets ?? 0) > 0) {
      issues.push(...(await this.checkAssetConfiguration(migrationJobId, configuration)));
    }
    issues.push(...(await this.checkLocationRequirements(migrationJobId)));
    issues.push(...(await this.checkOrphanPlacement(migrationJobId, configuration, stagedCounts)));

    const skipCounts = await this.identityMappedCounts(migrationJobId);
    const blockedCounts = await this.blockedCounts(migrationJobId);

    const plan: PreflightEntityPlan[] = MIGRATION_PHASE_ORDER.filter(
      (entityType) => (stagedCounts[entityType] ?? 0) > 0
    ).map((entityType) => {
      const staged = stagedCounts[entityType] ?? 0;
      const skipped = skipCounts[entityType] ?? 0;
      const blocked = blockedCounts[entityType] ?? 0;
      return {
        entityType,
        stagedCount: staged,
        toSkipIdentityMapped: skipped,
        blocked,
        toCreate: Math.max(0, staged - skipped - blocked),
      };
    });

    const blocking = issues.filter((issue) => issue.severity === 'blocking');
    const state: PreflightResult['state'] = blocking.length > 0 ? 'blocked' : 'ready';
    const preflightedAt = new Date().toISOString();

    await withTransaction(this.knex, async (trx) => {
      const tx = tenantDb(trx, this.tenant);
      await tx.table('migration_jobs').where({ migration_job_id: migrationJobId }).update({
        state,
        preflighted_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });
      await tx
        .table('migration_reports')
        .where({ migration_job_id: migrationJobId, report_type: 'preflight' })
        .delete();
      await tx.table('migration_reports').insert({
        tenant: this.tenant,
        migration_job_id: migrationJobId,
        report_type: 'preflight',
        summary: JSON.stringify({ state, issues, plan, preflightedAt }),
      });
    });

    return { state, issues, plan, preflightedAt };
  }

  private async stagedCountsByEntity(
    migrationJobId: string
  ): Promise<Partial<Record<AmpEntityType, number>>> {
    const db = tenantDb(this.knex, this.tenant);
    const rows = await db
      .table('migration_staged_records')
      .where({ migration_job_id: migrationJobId })
      .groupBy('entity_type')
      .select('entity_type')
      .count({ count: '*' });
    return Object.fromEntries(rows.map((row) => [row.entity_type, Number(row.count)]));
  }

  private async resetRecordBlocks(migrationJobId: string): Promise<void> {
    const db = tenantDb(this.knex, this.tenant);
    await db
      .table('migration_staged_records')
      .where({ migration_job_id: migrationJobId })
      .update({ validation_state: 'valid', validation_errors: '[]' });
  }

  private async blockRecords(
    migrationJobId: string,
    entityType: AmpEntityType,
    where: (query: Knex.QueryBuilder) => Knex.QueryBuilder,
    reason: { code: string; message: string }
  ): Promise<{ count: number; sample: string[] }> {
    const db = tenantDb(this.knex, this.tenant);
    const base = () =>
      where(
        db
          .table('migration_staged_records')
          .where({ migration_job_id: migrationJobId, entity_type: entityType })
      );
    const sampleRows = await base()
      .orderBy('package_record_id')
      .limit(SAMPLE_LIMIT)
      .select('package_record_id');
    const updated = await base().update({
      validation_state: 'blocked',
      validation_errors: JSON.stringify([reason]),
    });
    return {
      count: Number(updated),
      sample: sampleRows.map((row: { package_record_id: string }) => row.package_record_id),
    };
  }

  private async distinctPayloadValues(
    migrationJobId: string,
    entityType: AmpEntityType,
    field: string
  ): Promise<string[]> {
    const db = tenantDb(this.knex, this.tenant);
    const rows = await db
      .table('migration_staged_records')
      .where({ migration_job_id: migrationJobId, entity_type: entityType })
      .whereRaw(`payload ->> ? IS NOT NULL`, [field])
      .distinct(this.knex.raw(`payload ->> ? AS value`, [field]));
    return rows.map((row: { value: string }) => row.value);
  }

  private async checkTicketConfiguration(
    migrationJobId: string,
    configuration: MigrationJobConfiguration
  ): Promise<PreflightIssue[]> {
    const issues: PreflightIssue[] = [];
    const db = tenantDb(this.knex, this.tenant);
    const ticketConfig = configuration.tickets;

    if (!ticketConfig) {
      issues.push({
        severity: 'blocking',
        code: 'CONFIG_TICKETS_MISSING',
        message: 'Tickets are staged but no ticket configuration (board, status and priority mappings, default requester client) has been provided.',
        entityType: 'tickets',
      });
      return issues;
    }

    const board = await db.table('boards').where({ board_id: ticketConfig.boardId }).first();
    if (!board) {
      issues.push({
        severity: 'blocking',
        code: 'CONFIG_BOARD_NOT_FOUND',
        message: 'The configured target board does not exist in this tenant.',
        entityType: 'tickets',
      });
    }

    const defaultRequester = await db
      .table('clients')
      .where({ client_id: ticketConfig.defaultRequesterClientId })
      .first();
    if (!defaultRequester) {
      issues.push({
        severity: 'blocking',
        code: 'CONFIG_DEFAULT_REQUESTER_NOT_FOUND',
        message: 'The configured default requester client does not exist in this tenant.',
        entityType: 'tickets',
      });
    }

    if (ticketConfig.defaultAssigneeId) {
      const assignee = await db.table('users').where({ user_id: ticketConfig.defaultAssigneeId }).first();
      if (!assignee) {
        issues.push({
          severity: 'blocking',
          code: 'CONFIG_DEFAULT_ASSIGNEE_NOT_FOUND',
          message: 'The configured default assignee does not exist in this tenant.',
          entityType: 'tickets',
        });
      }
    }

    issues.push(
      ...(await this.checkNameMapping(migrationJobId, 'tickets', 'status_name', ticketConfig.statusMapping, {
        table: 'statuses',
        idColumn: 'status_id',
        unmappedCode: 'TICKET_STATUS_UNMAPPED',
        missingTargetCode: 'CONFIG_STATUS_NOT_FOUND',
        label: 'status',
        targetFilter: (query) => query.where({ status_type: 'ticket' }),
      }))
    );
    issues.push(
      ...(await this.checkNameMapping(migrationJobId, 'tickets', 'priority_name', ticketConfig.priorityMapping, {
        table: 'priorities',
        idColumn: 'priority_id',
        unmappedCode: 'TICKET_PRIORITY_UNMAPPED',
        missingTargetCode: 'CONFIG_PRIORITY_NOT_FOUND',
        label: 'priority',
      }))
    );

    return issues;
  }

  private async checkAssetConfiguration(
    migrationJobId: string,
    configuration: MigrationJobConfiguration
  ): Promise<PreflightIssue[]> {
    const issues: PreflightIssue[] = [];
    const assetConfig = configuration.assets;
    if (!assetConfig) {
      issues.push({
        severity: 'blocking',
        code: 'CONFIG_ASSETS_MISSING',
        message: 'Assets are staged but no asset type mapping has been provided.',
        entityType: 'assets',
      });
      return issues;
    }

    const names = await this.distinctPayloadValues(migrationJobId, 'assets', 'asset_type_name');
    const unmapped = names.filter((name) => !assetConfig.assetTypeMapping[name]);
    if (unmapped.length > 0) {
      const blocked = await this.blockRecords(
        migrationJobId,
        'assets',
        (query) => query.whereRaw(`payload ->> 'asset_type_name' = ANY(?)`, [unmapped]),
        {
          code: 'ASSET_TYPE_UNMAPPED',
          message: `Asset type is not mapped: ${unmapped.join(', ')}`,
        }
      );
      issues.push({
        severity: 'blocking',
        code: 'ASSET_TYPE_UNMAPPED',
        message: `${unmapped.length} source asset type name(s) are not mapped: ${unmapped.slice(0, 10).join(', ')}.`,
        entityType: 'assets',
        recordCount: blocked.count,
        sampleRecordIds: blocked.sample,
      });
    }
    return issues;
  }

  private async checkNameMapping(
    migrationJobId: string,
    entityType: AmpEntityType,
    field: string,
    mapping: Record<string, string>,
    options: {
      table: string;
      idColumn: string;
      unmappedCode: string;
      missingTargetCode: string;
      label: string;
      targetFilter?: (query: Knex.QueryBuilder) => Knex.QueryBuilder;
    }
  ): Promise<PreflightIssue[]> {
    const issues: PreflightIssue[] = [];
    const db = tenantDb(this.knex, this.tenant);

    const names = await this.distinctPayloadValues(migrationJobId, entityType, field);
    const unmapped = names.filter((name) => !mapping[name]);
    if (unmapped.length > 0) {
      const blocked = await this.blockRecords(
        migrationJobId,
        entityType,
        (query) => query.whereRaw(`payload ->> '${field}' = ANY(?)`, [unmapped]),
        {
          code: options.unmappedCode,
          message: `Source ${options.label} is not mapped: ${unmapped.join(', ')}`,
        }
      );
      issues.push({
        severity: 'blocking',
        code: options.unmappedCode,
        message: `${unmapped.length} source ${options.label} name(s) are not mapped: ${unmapped.slice(0, 10).join(', ')}.`,
        entityType,
        recordCount: blocked.count,
        sampleRecordIds: blocked.sample,
      });
    }

    const mappedTargets = [...new Set(Object.values(mapping))];
    if (mappedTargets.length > 0) {
      let query = db.table(options.table).whereIn(options.idColumn, mappedTargets);
      if (options.targetFilter) {
        query = options.targetFilter(query);
      }
      const found = await query.select(options.idColumn);
      const foundIds = new Set(found.map((row: Record<string, string>) => row[options.idColumn]));
      const missing = mappedTargets.filter((target) => !foundIds.has(target));
      if (missing.length > 0) {
        issues.push({
          severity: 'blocking',
          code: options.missingTargetCode,
          message: `${missing.length} mapped ${options.label} target(s) do not exist in this tenant.`,
          entityType,
        });
      }
    }

    return issues;
  }

  private async checkOrphanPlacement(
    migrationJobId: string,
    configuration: MigrationJobConfiguration,
    stagedCounts: Partial<Record<AmpEntityType, number>>
  ): Promise<PreflightIssue[]> {
    const issues: PreflightIssue[] = [];
    const db = tenantDb(this.knex, this.tenant);

    if (configuration.defaultClientId) {
      const client = await db.table('clients').where({ client_id: configuration.defaultClientId }).first();
      if (!client) {
        issues.push({
          severity: 'blocking',
          code: 'CONFIG_DEFAULT_CLIENT_NOT_FOUND',
          message: 'The configured default client does not exist in this tenant.',
        });
        return issues;
      }
    }

    for (const entityType of ['contacts', 'assets'] as const) {
      if ((stagedCounts[entityType] ?? 0) === 0) {
        continue;
      }
      const orphanRows = await db
        .table('migration_staged_records')
        .where({ migration_job_id: migrationJobId, entity_type: entityType })
        .whereRaw(`payload ->> 'organization_package_record_id' IS NULL`)
        .count({ count: '*' })
        .first();
      const orphans = Number(orphanRows?.count ?? 0);
      if (orphans > 0 && !configuration.defaultClientId) {
        const blocked = await this.blockRecords(
          migrationJobId,
          entityType,
          (query) => query.whereRaw(`payload ->> 'organization_package_record_id' IS NULL`),
          {
            code: 'ORPHAN_NO_DEFAULT_CLIENT',
            message: 'Record has no organization and no default client is configured.',
          }
        );
        issues.push({
          severity: 'blocking',
          code: 'ORPHAN_NO_DEFAULT_CLIENT',
          message: `${orphans} ${entityType} record(s) have no organization; configure a default client to place them.`,
          entityType,
          recordCount: blocked.count,
          sampleRecordIds: blocked.sample,
        });
      }
    }

    return issues;
  }

  /** Locations are created through the client domain model, whose address
   * invariant is stricter than AMP's portable optional address fields. Flag
   * incompatible records during dry-run rather than failing an apply batch. */
  private async checkLocationRequirements(migrationJobId: string): Promise<PreflightIssue[]> {
    const db = tenantDb(this.knex, this.tenant);
    const rows = await db
      .table('migration_staged_records')
      .where({ migration_job_id: migrationJobId, entity_type: 'locations' })
      .where((query) => query
        .whereRaw("COALESCE(BTRIM(payload ->> 'address_line1'), '') = ''")
        .orWhereRaw("COALESCE(BTRIM(payload ->> 'city'), '') = ''")
        .orWhereRaw("COALESCE(BTRIM(payload ->> 'country_code'), '') !~ '^[A-Za-z]{2}$'"))
      .count({ count: '*' })
      .first();
    const count = Number(rows?.count ?? 0);
    if (count === 0) return [];
    const blocked = await this.blockRecords(
      migrationJobId,
      'locations',
      (query) => query
        .whereRaw("COALESCE(BTRIM(payload ->> 'address_line1'), '') = ''")
        .orWhereRaw("COALESCE(BTRIM(payload ->> 'city'), '') = ''")
        .orWhereRaw("COALESCE(BTRIM(payload ->> 'country_code'), '') !~ '^[A-Za-z]{2}$'"),
      {
        code: 'LOCATION_REQUIRED_ADDRESS_MISSING',
        message: 'Location requires address line 1, city, and a two-letter country code for the target location model.',
      }
    );
    return [{
      severity: 'blocking',
      code: 'LOCATION_REQUIRED_ADDRESS_MISSING',
      message: `${count} location record(s) are missing target-required address fields.`,
      entityType: 'locations',
      recordCount: blocked.count,
      sampleRecordIds: blocked.sample,
    }];
  }

  private async identityMappedCounts(
    migrationJobId: string
  ): Promise<Partial<Record<AmpEntityType, number>>> {
    const rows = await this.knex
      .table('migration_staged_records as s')
      .join('migration_identity_mappings as m', function join() {
        this.on('m.tenant', 's.tenant')
          .andOn('m.namespace', 's.namespace')
          .andOn('m.entity_type', 's.entity_type')
          .andOn('m.source_record_id', 's.source_record_id');
      })
      .where('s.tenant', this.tenant)
      .where('s.migration_job_id', migrationJobId)
      .groupBy('s.entity_type')
      .select('s.entity_type')
      .count({ count: '*' });
    return Object.fromEntries(rows.map((row) => [row.entity_type, Number(row.count)]));
  }

  private async blockedCounts(
    migrationJobId: string
  ): Promise<Partial<Record<AmpEntityType, number>>> {
    const db = tenantDb(this.knex, this.tenant);
    const rows = await db
      .table('migration_staged_records')
      .where({ migration_job_id: migrationJobId, validation_state: 'blocked' })
      .groupBy('entity_type')
      .select('entity_type')
      .count({ count: '*' });
    return Object.fromEntries(rows.map((row) => [row.entity_type, Number(row.count)]));
  }
}

export function parseConfiguration(raw: unknown): MigrationJobConfiguration {
  if (raw === null || raw === undefined) {
    return {};
  }
  if (typeof raw === 'string') {
    return JSON.parse(raw) as MigrationJobConfiguration;
  }
  return raw as MigrationJobConfiguration;
}
