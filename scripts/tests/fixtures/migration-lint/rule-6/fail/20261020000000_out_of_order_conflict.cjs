// lint-expect-file: 6
// Rule 6 (red): within the grace window but stamped before a base migration that also touches widgets.
exports.up = async function (knex) {
  await knex.raw('ALTER TABLE widgets ADD COLUMN IF NOT EXISTS extra text');
};
