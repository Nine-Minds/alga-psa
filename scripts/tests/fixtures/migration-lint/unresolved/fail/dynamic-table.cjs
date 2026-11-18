// A table name the lint cannot resolve is a finding, never a silent skip.
exports.up = async function (knex) {
  const tableName = process.env.TARGET_TABLE;
  // lint-expect: UNRESOLVED
  await knex.raw(`ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS extra int`);
};
