'use strict';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('contract_line_discounts'))) return;
  if (!(await knex.schema.hasColumn('contract_line_discounts', 'client_contract_id'))) {
    await knex.schema.alterTable('contract_line_discounts', (table) => {
      table.uuid('client_contract_id').nullable();
      table.foreign(['tenant', 'client_contract_id']).references(['tenant', 'client_contract_id'])
        .inTable('client_contracts').onDelete('CASCADE');
    });
  }
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_contract_line_discounts_client_owner
    ON contract_line_discounts (tenant, client_contract_id, contract_line_id)`);
  // Expand legacy line terms per client-contract. The original definition and
  // row stay with the first assignment; other assignments receive independent
  // definitions, so later edits cannot leak across owners.
  const { rows } = await knex.raw(`
    SELECT cld.tenant, cld.discount_id, cld.contract_line_id
    FROM contract_line_discounts cld
    WHERE cld.client_contract_id IS NULL
    ORDER BY cld.tenant, cld.discount_id
  `);
  for (const row of rows) {
    const assignments = await knex('client_contracts as cc')
      .join('contract_lines as cl', function () {
        this.on('cl.contract_id', '=', 'cc.contract_id').andOn('cl.tenant', '=', 'cc.tenant');
      })
      .where({ 'cc.tenant': row.tenant, 'cl.contract_line_id': row.contract_line_id })
      .orderBy('cc.client_contract_id').select('cc.client_contract_id');
    const [first, ...others] = assignments;
    if (!first) continue;
    await knex('contract_line_discounts').where({
      tenant: row.tenant, discount_id: row.discount_id, contract_line_id: row.contract_line_id,
    }).update({ client_contract_id: first.client_contract_id });
    const original = await knex('discounts').where({ tenant: row.tenant, discount_id: row.discount_id }).first();
    if (!original) continue;
    for (const owner of others) {
      const copyId = require('crypto').randomUUID();
      await knex('discounts').insert({ ...original, discount_id: copyId, created_at: original.created_at ?? knex.fn.now(), updated_at: knex.fn.now() });
      await knex('contract_line_discounts').insert({
        tenant: row.tenant, discount_id: copyId, contract_line_id: row.contract_line_id,
        client_contract_id: owner.client_contract_id,
      });
    }
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasColumn('contract_line_discounts', 'client_contract_id')) {
    await knex.schema.alterTable('contract_line_discounts', (table) => {
      table.dropForeign(['tenant', 'client_contract_id']);
      table.dropColumn('client_contract_id');
    });
  }
};
