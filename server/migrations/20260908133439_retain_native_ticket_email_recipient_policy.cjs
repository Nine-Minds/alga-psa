const TABLE = 'co_management_customer_email_deliveries';
exports.up = async function(knex) {
  if (!await knex.schema.hasColumn(TABLE, 'native_delivery')) await knex.schema.alterTable(TABLE, table => table.boolean('native_delivery').notNullable().defaultTo(false));
  if (!await knex.schema.hasColumn(TABLE, 'excluded_email_hashes')) await knex.schema.alterTable(TABLE, table => table.specificType('excluded_email_hashes', 'text[]').notNullable().defaultTo(knex.raw("'{}'::text[]")));
  await knex.raw('ALTER TABLE ?? DROP CONSTRAINT IF EXISTS native_ticket_email_policy_check', [TABLE]);
  await knex.raw(`ALTER TABLE ?? ADD CONSTRAINT native_ticket_email_policy_check CHECK (
    (native_delivery OR cardinality(excluded_email_hashes) = 0) AND array_position(excluded_email_hashes, NULL) IS NULL
    AND array_to_string(excluded_email_hashes, ',') ~ '^([a-f0-9]{64}(,[a-f0-9]{64})*){0,1}$')`, [TABLE]);
};
exports.down = async function(knex) {
  if (await knex(TABLE).where('native_delivery', true).first()) throw new Error('Cannot discard retained native ticket email recipients');
  await knex.raw('ALTER TABLE ?? DROP CONSTRAINT IF EXISTS native_ticket_email_policy_check', [TABLE]);
  await knex.schema.alterTable(TABLE, table => { table.dropColumn('native_delivery'); table.dropColumn('excluded_email_hashes'); });
};
