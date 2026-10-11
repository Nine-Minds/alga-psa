/** Customer bootstrap creates operational defaults before the invited admin
 * has an account. NULL denotes system-created content, as it does for statuses;
 * never attribute it to a sponsor user or create a fake billable technician. */
exports.up = async function (knex) {
  await knex.raw('ALTER TABLE priorities ALTER COLUMN created_by DROP NOT NULL');
};
exports.down = async function (knex) {
  if (await knex('priorities').whereNull('created_by').first()) {
    throw new Error('Cannot require a priority creator while system-created defaults exist');
  }
  await knex.raw('ALTER TABLE priorities ALTER COLUMN created_by SET NOT NULL');
};
