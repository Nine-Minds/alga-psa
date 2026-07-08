const DEFAULT_MICROSOFT_PROFILE_CAPABILITIES = '["msp_sso","email","calendar","teams"]';

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('microsoft_profiles');
  if (!hasTable) {
    return;
  }

  const hasCapabilities = await knex.schema.hasColumn('microsoft_profiles', 'capabilities');
  if (!hasCapabilities) {
    await knex.schema.alterTable('microsoft_profiles', (table) => {
      table
        .jsonb('capabilities')
        .notNullable()
        .defaultTo(knex.raw(`'${DEFAULT_MICROSOFT_PROFILE_CAPABILITIES}'::jsonb`));
    });

    await knex.raw(
      `UPDATE microsoft_profiles
       SET capabilities = ?::jsonb`,
      [DEFAULT_MICROSOFT_PROFILE_CAPABILITIES]
    );
    return;
  }

  await knex.raw(
    `UPDATE microsoft_profiles
     SET capabilities = ?::jsonb
     WHERE capabilities IS NULL`,
    [DEFAULT_MICROSOFT_PROFILE_CAPABILITIES]
  );
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('microsoft_profiles');
  if (!hasTable) {
    return;
  }

  const hasCapabilities = await knex.schema.hasColumn('microsoft_profiles', 'capabilities');
  if (hasCapabilities) {
    await knex.schema.alterTable('microsoft_profiles', (table) => {
      table.dropColumn('capabilities');
    });
  }
};

exports.config = { transaction: false };
