// Rule 6 (green): stamped before the newest on base, but within the grace window and touching no table a newer base migration touches.
exports.up = async function (knex) {
  await knex.raw('ALTER TABLE gadgets ADD COLUMN IF NOT EXISTS extra text');
};
