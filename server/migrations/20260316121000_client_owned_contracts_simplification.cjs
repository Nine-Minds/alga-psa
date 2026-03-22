const { randomUUID } = require('node:crypto');
const {
  detectSharedNonTemplateContractGroups,
  assertCloneTargetsSupported,
  buildSharedContractClonePlan,
} = require('./utils/client_owned_contracts_simplification.cjs');

const CONTRACT_OWNER_FK = 'contracts_owner_client_fkey';
const CONTRACT_OWNER_INDEX = 'idx_contracts_tenant_owner_client_id';

const ensureSequentialMode = async (knex) => {
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'citus'
      ) THEN
        EXECUTE 'SET citus.multi_shard_modify_mode TO ''sequential''';
      END IF;
    END $$;
  `);
};

const hasColumn = async (knex, tableName, columnName) => {
  try {
    return await knex.schema.hasColumn(tableName, columnName);
  } catch (error) {
    console.warn(`Unable to check ${tableName}.${columnName}:`, error);
    return false;
  }
};

const hasTable = async (knex, tableName) => {
  try {
    return await knex.schema.hasTable(tableName);
  } catch (error) {
    console.warn(`Unable to check table ${tableName}:`, error);
    return false;
  }
};

const hasConstraint = async (knex, constraintName) => {
  try {
    const result = await knex('pg_constraint').where({ conname: constraintName }).first('conname');
    return Boolean(result);
  } catch (error) {
    console.warn(`Unable to check constraint ${constraintName}:`, error);
    return false;
  }
};

const ensureOwnerClientColumn = async (knex) => {
  if (!await hasColumn(knex, 'contracts', 'owner_client_id')) {
    await knex.schema.alterTable('contracts', (table) => {
      table.uuid('owner_client_id').nullable();
    });
  }

  await knex.raw(
    `CREATE INDEX IF NOT EXISTS ${CONTRACT_OWNER_INDEX} ON contracts(tenant, owner_client_id)`
  );

  if (!await hasConstraint(knex, CONTRACT_OWNER_FK)) {
    await knex.raw(`
      ALTER TABLE contracts
      ADD CONSTRAINT ${CONTRACT_OWNER_FK}
      FOREIGN KEY (tenant, owner_client_id)
      REFERENCES clients (tenant, client_id)
    `);
  }
};

const fetchOptionalRowsByIds = async (trx, tableName, columnName, ids, tenant) => {
  if (!ids.length || !await hasTable(trx, tableName)) {
    return [];
  }

  return trx(tableName)
    .where({ tenant })
    .whereIn(columnName, ids)
    .select('*');
};

const countOptionalRowsByIds = async (trx, tableName, columnName, ids, tenant, extraWhere = {}) => {
  if (!ids.length || !await hasTable(trx, tableName)) {
    return 0;
  }

  const result = await trx(tableName)
    .where({ tenant, ...extraWhere })
    .whereIn(columnName, ids)
    .count('* as count')
    .first();

  return Number(result?.count ?? 0);
};

const countOptionalRowsByContract = async (trx, tableName, tenant, contractId, extraWhere = {}) => {
  if (!await hasTable(trx, tableName)) {
    return 0;
  }

  const result = await trx(tableName)
    .where({ tenant, contract_id: contractId, ...extraWhere })
    .count('* as count')
    .first();

  return Number(result?.count ?? 0);
};

const countOptionalDocumentAssociations = async (trx, tenant, contractId) => {
  if (!await hasTable(trx, 'document_associations')) {
    return 0;
  }

  const result = await trx('document_associations')
    .where({
      tenant,
      entity_type: 'contract',
      entity_id: contractId,
    })
    .count('* as count')
    .first();

  return Number(result?.count ?? 0);
};

const fetchSharedAssignmentRows = async (trx) => {
  const hasInvoiceCharges = await hasTable(trx, 'invoice_charges');

  const invoiceCountSelection = hasInvoiceCharges
    ? trx.raw(
        `COALESCE((
          SELECT COUNT(*)
          FROM invoice_charges ic
          WHERE ic.tenant = cc.tenant
            AND ic.client_contract_id = cc.client_contract_id
        ), 0) as invoice_count`
      )
    : trx.raw('0 as invoice_count');

  return trx('client_contracts as cc')
    .join('contracts as c', function joinContracts() {
      this.on('cc.contract_id', '=', 'c.contract_id').andOn('cc.tenant', '=', 'c.tenant');
    })
    .where((builder) => builder.whereNull('c.is_template').orWhere('c.is_template', false))
    .select([
      'cc.tenant',
      'cc.contract_id',
      'cc.client_contract_id',
      'cc.client_id',
      'cc.start_date',
      'c.is_template',
      invoiceCountSelection,
    ]);
};

const insertRows = async (trx, tableName, rows) => {
  if (rows.length === 0 || !await hasTable(trx, tableName)) {
    return;
  }

  await trx(tableName).insert(rows);
};

exports.up = async function up(knex) {
  await ensureSequentialMode(knex);

  if (!await hasTable(knex, 'contracts') || !await hasTable(knex, 'client_contracts')) {
    console.log('⊘ Contract ownership migration skipped: contracts/client_contracts tables not found');
    return;
  }

  await ensureOwnerClientColumn(knex);

  await knex.transaction(async (trx) => {
    const assignmentRows = await fetchSharedAssignmentRows(trx);
    const sharedGroups = detectSharedNonTemplateContractGroups(assignmentRows);

    for (const groupAssignments of sharedGroups) {
      const { tenant, contract_id: contractId } = groupAssignments[0];
      const sourceContract = await trx('contracts')
        .where({ tenant, contract_id: contractId })
        .first();

      if (!sourceContract) {
        throw new Error(`Contract ${contractId} in tenant ${tenant} disappeared during migration`);
      }

      const contractLines = await trx('contract_lines')
        .where({ tenant, contract_id: contractId })
        .select('*');
      const contractLineIds = contractLines.map((row) => row.contract_line_id);

      const [
        contractLineServices,
        contractLineServiceDefaults,
        contractLineDiscounts,
        contractLineServiceConfigurations,
      ] = await Promise.all([
        fetchOptionalRowsByIds(trx, 'contract_line_services', 'contract_line_id', contractLineIds, tenant),
        fetchOptionalRowsByIds(
          trx,
          'contract_line_service_defaults',
          'contract_line_id',
          contractLineIds,
          tenant
        ),
        fetchOptionalRowsByIds(trx, 'contract_line_discounts', 'contract_line_id', contractLineIds, tenant),
        fetchOptionalRowsByIds(
          trx,
          'contract_line_service_configuration',
          'contract_line_id',
          contractLineIds,
          tenant
        ),
      ]);

      const configIds = contractLineServiceConfigurations.map((row) => row.config_id);

      const [
        contractLineServiceBucketConfigs,
        contractLineServiceFixedConfigs,
        contractLineServiceHourlyConfig,
        contractLineServiceHourlyConfigs,
        contractLineServiceRateTiers,
        contractLineServiceUsageConfig,
      ] = await Promise.all([
        fetchOptionalRowsByIds(
          trx,
          'contract_line_service_bucket_config',
          'config_id',
          configIds,
          tenant
        ),
        fetchOptionalRowsByIds(
          trx,
          'contract_line_service_fixed_config',
          'config_id',
          configIds,
          tenant
        ),
        fetchOptionalRowsByIds(
          trx,
          'contract_line_service_hourly_config',
          'config_id',
          configIds,
          tenant
        ),
        fetchOptionalRowsByIds(
          trx,
          'contract_line_service_hourly_configs',
          'config_id',
          configIds,
          tenant
        ),
        fetchOptionalRowsByIds(
          trx,
          'contract_line_service_rate_tiers',
          'config_id',
          configIds,
          tenant
        ),
        fetchOptionalRowsByIds(
          trx,
          'contract_line_service_usage_config',
          'config_id',
          configIds,
          tenant
        ),
      ]);

      const plan = buildSharedContractClonePlan(
        {
          sourceContract,
          assignments: groupAssignments,
          contractLines,
          contractLineServices,
          contractLineServiceDefaults,
          contractLineDiscounts,
          contractLineServiceConfigurations,
          contractLineServiceBucketConfigs,
          contractLineServiceFixedConfigs,
          contractLineServiceHourlyConfig,
          contractLineServiceHourlyConfigs,
          contractLineServiceRateTiers,
          contractLineServiceUsageConfig,
        },
        { createId: () => randomUUID() }
      );

      assertCloneTargetsSupported({
        tenant,
        contractId,
        cloneTargets: plan.clones.map((clone) => clone.sourceAssignment),
        contractDocumentAssociationsCount: await countOptionalDocumentAssociations(trx, tenant, contractId),
        pricingScheduleCount: await countOptionalRowsByContract(
          trx,
          'contract_pricing_schedules',
          tenant,
          contractId
        ),
        timeEntryCount: await countOptionalRowsByIds(
          trx,
          'time_entries',
          'contract_line_id',
          contractLineIds,
          tenant
        ),
        usageTrackingCount: await countOptionalRowsByIds(
          trx,
          'usage_tracking',
          'contract_line_id',
          contractLineIds,
          tenant
        ),
      });

      await trx('contracts')
        .where({
          tenant,
          contract_id: plan.preservedContractUpdate.contract_id,
        })
        .update({
          owner_client_id: plan.preservedContractUpdate.owner_client_id,
          updated_at: knex.fn.now(),
        });

      for (const clone of plan.clones) {
        await insertRows(trx, 'contracts', [clone.contract]);
        await insertRows(trx, 'contract_lines', clone.contractLines);
        await insertRows(trx, 'contract_line_services', clone.contractLineServices);
        await insertRows(trx, 'contract_line_service_defaults', clone.contractLineServiceDefaults);
        await insertRows(trx, 'contract_line_discounts', clone.contractLineDiscounts);
        await insertRows(
          trx,
          'contract_line_service_configuration',
          clone.contractLineServiceConfigurations
        );
        await insertRows(
          trx,
          'contract_line_service_bucket_config',
          clone.contractLineServiceBucketConfigs
        );
        await insertRows(
          trx,
          'contract_line_service_fixed_config',
          clone.contractLineServiceFixedConfigs
        );
        await insertRows(
          trx,
          'contract_line_service_hourly_config',
          clone.contractLineServiceHourlyConfig
        );
        await insertRows(
          trx,
          'contract_line_service_hourly_configs',
          clone.contractLineServiceHourlyConfigs
        );
        await insertRows(
          trx,
          'contract_line_service_rate_tiers',
          clone.contractLineServiceRateTiers
        );
        await insertRows(
          trx,
          'contract_line_service_usage_config',
          clone.contractLineServiceUsageConfig
        );

        await trx('client_contracts')
          .where({
            tenant,
            client_contract_id: clone.clientContractUpdate.client_contract_id,
          })
          .update({
            contract_id: clone.clientContractUpdate.contract_id,
            updated_at: knex.fn.now(),
          });
      }
    }

    const singleClientContracts = await trx('client_contracts as cc')
      .join('contracts as c', function joinContracts() {
        this.on('cc.contract_id', '=', 'c.contract_id').andOn('cc.tenant', '=', 'c.tenant');
      })
      .where((builder) => builder.whereNull('c.is_template').orWhere('c.is_template', false))
      .groupBy('cc.tenant', 'cc.contract_id')
      .havingRaw('COUNT(DISTINCT cc.client_id) = 1')
      .select([
        'cc.tenant',
        'cc.contract_id',
        trx.raw('MIN(cc.client_id::text) as owner_client_id'),
      ]);

    for (const row of singleClientContracts) {
      await trx('contracts')
        .where({
          tenant: row.tenant,
          contract_id: row.contract_id,
        })
        .whereNull('owner_client_id')
        .update({
          owner_client_id: row.owner_client_id,
          updated_at: knex.fn.now(),
        });
    }

    const remainingShared = await trx('client_contracts as cc')
      .join('contracts as c', function joinContracts() {
        this.on('cc.contract_id', '=', 'c.contract_id').andOn('cc.tenant', '=', 'c.tenant');
      })
      .where((builder) => builder.whereNull('c.is_template').orWhere('c.is_template', false))
      .groupBy('cc.tenant', 'cc.contract_id')
      .havingRaw('COUNT(DISTINCT cc.client_id) > 1')
      .select('cc.tenant', 'cc.contract_id');

    if (remainingShared.length > 0) {
      throw new Error(
        `Client-owned contract migration left shared non-template contracts behind: ${remainingShared
          .map((row) => `${row.tenant}/${row.contract_id}`)
          .join(', ')}`
      );
    }
  });

  console.log('✓ Added owner_client_id and split shared non-template contracts into client-owned contracts');
};

exports.down = async function down() {
  throw new Error(
    'Irreversible migration: shared non-template contracts were cloned into client-owned contracts'
  );
};

exports.config = { transaction: false };
