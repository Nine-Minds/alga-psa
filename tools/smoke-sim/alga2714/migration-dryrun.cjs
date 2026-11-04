// Runs the real 20261020120000 backfill up() inside a transaction, reports the
// smoke contract's rows and a global "would change" count, then ROLLS BACK.
const path = require('path');
const fs = require('fs');
const serverDir = path.resolve(__dirname, '../../../server');
const knexLib = require('knex');
const pw = fs.readFileSync(path.resolve(serverDir, '../secrets/postgres_password'), 'utf8').trim();
const knex = knexLib({ client: 'pg', connection: { host: '127.0.0.1', port: 6472, user: 'postgres', password: pw, database: 'server' } });
const mig = require(path.join(serverDir, 'migrations/20261020120000_backfill_products_contract_placeholder_zero_rates.cjs'));
const [T, L] = process.argv.slice(2);
(async () => {
  const snap = async (db, label) => {
    const line = await db('contract_lines').where({ tenant: T, contract_line_id: L }).first('custom_rate', 'rate_provenance');
    const cfgs = await db('contract_line_service_configuration as c').join('contract_line_service_fixed_config as f', function () { this.on('f.config_id', 'c.config_id').andOn('f.tenant', 'c.tenant'); })
      .where({ 'c.tenant': T, 'c.contract_line_id': L }).select('c.service_id', 'f.base_rate', 'f.base_rate_basis', 'f.pricing_basis', 'f.rate_provenance');
    console.log(label, JSON.stringify({ line, cfgs }));
  };
  const trx = await knex.transaction();
  try {
    await snap(trx, 'BEFORE');
    if (process.env.DROP_FOREIGN_BRANCH_CHECK) {
      // Constraint comes from an unmerged branch's migration (20261012000001) applied to this shared DB;
      // dropped only inside this rolled-back transaction to emulate the branch's own schema.
      await trx.raw('alter table contract_line_service_fixed_config drop constraint if exists contract_line_service_fixed_config_base_rate_basis_rate_check');
      // Its sibling: pricing_basis = unit is not allowed together with base_rate_basis = share.
      await trx.raw('alter table contract_line_service_fixed_config drop constraint if exists contract_line_service_fixed_config_base_rate_basis_seat_check');
    }
    const counts = async (db) => (await db.raw("select (select count(*) from contract_lines where custom_rate is null) lines_null, (select count(*) from contract_line_service_fixed_config where base_rate is null) cfg_null")).rows[0];
    const c0 = await counts(trx);
    await mig.up(trx);
    const c1 = await counts(trx);
    console.log('GLOBAL null-rate rows before/after', JSON.stringify(c0), JSON.stringify(c1));
    await snap(trx, 'AFTER ');
  } catch (e) {
    console.log('MIGRATION ERROR:', e.message);
  } finally {
    await trx.rollback().catch(() => {});
    await snap(knex, 'POST-ROLLBACK');
    await knex.destroy();
  }
})();
