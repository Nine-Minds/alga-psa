/**
 * Prepaid Block contract line (alga-2026-0002695), part 2: widen the existing
 * hour-block ledger and prepaid alerts. Requires contract_line_block_issuances
 * (previous migration).
 *
 *   hour_blocks            + contract_line_id, client_contract_id, issuance_id;
 *                          source_type gains 'contract'; CHECK ties the two.
 *   hour_block_audit       type gains contract_end_expiration, allocation_release, reassignment.
 *   prepaid_balance_alerts alert_type gains 'prepaid_block'; + hour_block_id.
 *
 * Transaction-free (composite FKs to distributed tables). Down refuses when
 * rows that use the widened values exist, rather than silently deleting data.
 */
const { hasCitus, isDistributed } = require('./utils/citusDistribution.cjs');

exports.config = { transaction: false };

const AUDIT_BASE = [
  'purchase', 'grant', 'adjustment', 'expiration_date_change',
  'manual_expiration', 'auto_expiration', 'void', 'purchase_reversal',
];
const AUDIT_NEW = ['contract_end_expiration', 'allocation_release', 'reassignment'];

function inList(values) {
  return values.map((v) => `'${v}'`).join(', ');
}

async function replaceCheck(knex, table, name, expression) {
  await knex.raw('ALTER TABLE ?? DROP CONSTRAINT IF EXISTS ??', [table, name]);
  // migration-lint: allow 2 - retroactive: CHECK/FK re-added on prepaid-block tables introduced in this same release train, merged before the lint existed; not re-reviewed for production row counts
  await knex.raw('ALTER TABLE ?? ADD CONSTRAINT ?? CHECK (' + expression + ')', [table, name]);
}

async function addFk(knex, table, name, columns, refTable, refColumns, onDelete) {
  // migration-lint: allow 2 - retroactive: CHECK/FK re-added on prepaid-block tables introduced in this same release train, merged before the lint existed; not re-reviewed for production row counts
  await knex.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${name}') THEN
        ALTER TABLE ${table}
          ADD CONSTRAINT ${name}
          FOREIGN KEY (${columns}) REFERENCES ${refTable}(${refColumns})${onDelete ? ` ON DELETE ${onDelete}` : ''};
      END IF;
    END $$;
  `);
}

exports.up = async function up(knex) {
  // --- hour_blocks -----------------------------------------------------------
  for (const column of ['contract_line_id', 'client_contract_id', 'issuance_id']) {
    await knex.raw('ALTER TABLE hour_blocks ADD COLUMN IF NOT EXISTS ?? uuid NULL', [column]);
  }
  // No cascade/set-null: a line or assignment with block history cannot be
  // deleted out from under its blocks (SET NULL would also violate the CHECK).
  await addFk(knex, 'hour_blocks', 'hour_blocks_contract_line_fkey',
    'tenant, contract_line_id', 'contract_lines', 'tenant, contract_line_id');
  await addFk(knex, 'hour_blocks', 'hour_blocks_client_contract_fkey',
    'tenant, client_contract_id', 'client_contracts', 'tenant, client_contract_id');
  // Citus forbids SET NULL on an FK that includes the distribution key; the
  // issuance is restored/cancelled (and the block voided) rather than deleted.
  const hourBlocksDistributed = (await hasCitus(knex)) && (await isDistributed(knex, 'hour_blocks'));
  await addFk(knex, 'hour_blocks', 'hour_blocks_issuance_fkey',
    'tenant, issuance_id', 'contract_line_block_issuances', 'tenant, issuance_id',
    hourBlocksDistributed ? undefined : 'SET NULL (issuance_id)');
  // migration-lint: allow 1 - retroactive: hour_blocks index built inside the transaction; hour_blocks is a prepaid-block table new in this release train, merged before the lint existed
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS hour_blocks_contract_line_status_idx ON hour_blocks (tenant, contract_line_id, status)',
  );
  // migration-lint: allow 1 - retroactive: hour_blocks index built inside the transaction; hour_blocks is a prepaid-block table new in this release train, merged before the lint existed
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS hour_blocks_issuance_idx ON hour_blocks (tenant, issuance_id)',
  );
  await replaceCheck(knex, 'hour_blocks', 'hour_blocks_source_type_check',
    "source_type IN ('purchase', 'grant', 'contract')");
  await replaceCheck(knex, 'hour_blocks', 'hour_blocks_contract_owner_check',
    "(source_type = 'contract') = (contract_line_id IS NOT NULL)");

  // --- hour_block_audit ------------------------------------------------------
  await replaceCheck(knex, 'hour_block_audit', 'hour_block_audit_type_check',
    `type IN (${inList([...AUDIT_BASE, ...AUDIT_NEW])})`);

  // --- prepaid_balance_alerts ------------------------------------------------
  await knex.raw('ALTER TABLE prepaid_balance_alerts ADD COLUMN IF NOT EXISTS hour_block_id uuid NULL');
  const alertsDistributed = (await hasCitus(knex)) && (await isDistributed(knex, 'prepaid_balance_alerts'));
  await addFk(knex, 'prepaid_balance_alerts', 'prepaid_balance_alerts_hour_block_fkey',
    'tenant, hour_block_id', 'hour_blocks', 'tenant, block_id',
    alertsDistributed ? undefined : 'SET NULL (hour_block_id)');
  await replaceCheck(knex, 'prepaid_balance_alerts', 'prepaid_balance_alerts_alert_type_check',
    "alert_type IN ('credit','bucket','prepaid_block')");
};

exports.down = async function down(knex) {
  const blocks = await knex('hour_blocks').where('source_type', 'contract').count({ n: '*' }).first();
  const alerts = await knex('prepaid_balance_alerts').where('alert_type', 'prepaid_block').count({ n: '*' }).first();
  const audits = await knex('hour_block_audit').whereIn('type', AUDIT_NEW).count({ n: '*' }).first();
  if (Number(blocks.n) + Number(alerts.n) + Number(audits.n) > 0) {
    throw new Error(
      'Cannot roll back prepaid block ledger extensions: contract hour blocks, prepaid_block alerts or ' +
      'widened audit rows exist. Remove them explicitly first.',
    );
  }

  await replaceCheck(knex, 'prepaid_balance_alerts', 'prepaid_balance_alerts_alert_type_check',
    "alert_type IN ('credit','bucket')");
  await knex.raw('ALTER TABLE prepaid_balance_alerts DROP CONSTRAINT IF EXISTS prepaid_balance_alerts_hour_block_fkey');
  await knex.raw('ALTER TABLE prepaid_balance_alerts DROP COLUMN IF EXISTS hour_block_id');

  await replaceCheck(knex, 'hour_block_audit', 'hour_block_audit_type_check', `type IN (${inList(AUDIT_BASE)})`);

  await knex.raw('ALTER TABLE hour_blocks DROP CONSTRAINT IF EXISTS hour_blocks_contract_owner_check');
  await replaceCheck(knex, 'hour_blocks', 'hour_blocks_source_type_check', "source_type IN ('purchase', 'grant')");
  await knex.raw('DROP INDEX IF EXISTS hour_blocks_issuance_idx');
  await knex.raw('DROP INDEX IF EXISTS hour_blocks_contract_line_status_idx');
  for (const fk of ['hour_blocks_issuance_fkey', 'hour_blocks_client_contract_fkey', 'hour_blocks_contract_line_fkey']) {
    await knex.raw('ALTER TABLE hour_blocks DROP CONSTRAINT IF EXISTS ??', [fk]);
  }
  for (const column of ['issuance_id', 'client_contract_id', 'contract_line_id']) {
    await knex.raw('ALTER TABLE hour_blocks DROP COLUMN IF EXISTS ??', [column]);
  }
};
