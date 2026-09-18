exports.up = async function up(knex) {
  await knex.raw(`ALTER TABLE microsoft_profile_consumer_bindings
    DROP CONSTRAINT IF EXISTS microsoft_profile_consumer_bindings_consumer_type_check;`);
  await knex.raw(`ALTER TABLE microsoft_profile_consumer_bindings
    ADD CONSTRAINT microsoft_profile_consumer_bindings_consumer_type_check
    CHECK (consumer_type IN ('msp_sso', 'email', 'calendar', 'teams', 'entra'));`);
};

exports.down = async function down(knex) {
  await knex('microsoft_profile_consumer_bindings').where({ consumer_type: 'entra' }).delete();
  await knex.raw(`ALTER TABLE microsoft_profile_consumer_bindings
    DROP CONSTRAINT IF EXISTS microsoft_profile_consumer_bindings_consumer_type_check;`);
  await knex.raw(`ALTER TABLE microsoft_profile_consumer_bindings
    ADD CONSTRAINT microsoft_profile_consumer_bindings_consumer_type_check
    CHECK (consumer_type IN ('msp_sso', 'email', 'calendar', 'teams'));`);
};

exports.config = { transaction: false };
