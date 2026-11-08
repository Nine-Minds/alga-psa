/**
 * Prepaid hours on contracts (alga-2026-0002684), migration 3 of 4: allow
 * charge_family = 'prepaid_block' on recurring_service_periods (cadence prepaid
 * block fee periods; due_position is always 'advance'). 'prepaid_block' is
 * 13 chars and fits the existing varchar(20).
 *
 * See ee/docs/plans/2026-10-20-prepaid-hours-contracts.md (D3, section 4).
 * down() refuses while any prepaid_block period row exists.
 */
exports.config = { transaction: false };

const TABLE = 'recurring_service_periods';
const CHECK = 'recurring_service_periods_charge_family_check';
const BASE = ['fixed', 'product', 'license', 'bucket', 'hourly', 'usage'];

const inList = (values) => values.map((v) => `'${v}'`).join(', ');

async function replaceCheck(knex, values) {
  await knex.raw('ALTER TABLE ?? DROP CONSTRAINT IF EXISTS ??', [TABLE, CHECK]);
  await knex.raw('ALTER TABLE ?? ADD CONSTRAINT ?? CHECK (charge_family IN (' + inList(values) + ')) NOT VALID', [TABLE, CHECK]);
}

exports.up = async function up(knex) {
  await replaceCheck(knex, [...BASE, 'prepaid_block']);
};

exports.down = async function down(knex) {
  const row = await knex(TABLE).where('charge_family', 'prepaid_block').count({ n: '*' }).first();
  if (Number(row.n) > 0) {
    throw new Error(
      `Cannot roll back prepaid_block charge family: ${row.n} recurring_service_periods row(s) with ` +
        "charge_family = 'prepaid_block' exist. Remove them (and any cadence prepaid block config) explicitly first.",
    );
  }
  await replaceCheck(knex, BASE);
  await knex.raw('ALTER TABLE ?? VALIDATE CONSTRAINT ??', [TABLE, CHECK]);
};
