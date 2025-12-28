/** EE-only migration: tenant_extension_install config + secrets */

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  const hasConfigTable = await knex.schema.hasTable('tenant_extension_install_config');
  if (!hasConfigTable) {
    try {
      await knex.schema.createTable('tenant_extension_install_config', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        t.uuid('install_id').notNullable().references('id').inTable('tenant_extension_install').onDelete('CASCADE');
        t.string('tenant_id').notNullable();
        t.jsonb('config').notNullable().defaultTo('{}');
        t.jsonb('providers').notNullable().defaultTo('[]');
        t.string('version').notNullable().defaultTo(knex.raw("gen_random_uuid()::text"));
        t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
        t.unique(['install_id']);
        t.index(['tenant_id']);
        t.index(['install_id', 'version']);
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('already exists')) throw err;
    }
  } else {
    // Best-effort: ensure expected columns exist for environments where the table was created manually.
    const ensureColumn = async (name, addColumn) => {
      const has = await knex.schema.hasColumn('tenant_extension_install_config', name);
      if (!has) {
        await knex.schema.alterTable('tenant_extension_install_config', addColumn);
      }
    };

    await ensureColumn('id', (t) => t.uuid('id').defaultTo(knex.raw('gen_random_uuid()')));
    await ensureColumn('install_id', (t) => t.uuid('install_id'));
    await ensureColumn('tenant_id', (t) => t.string('tenant_id'));
    await ensureColumn('config', (t) => t.jsonb('config').notNullable().defaultTo('{}'));
    await ensureColumn('providers', (t) => t.jsonb('providers').notNullable().defaultTo('[]'));
    await ensureColumn('version', (t) => t.string('version').notNullable().defaultTo(knex.raw("gen_random_uuid()::text")));
    await ensureColumn('created_at', (t) => t.timestamp('created_at').notNullable().defaultTo(knex.fn.now()));
    await ensureColumn('updated_at', (t) => t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now()));

    // Indexes/constraints (safe if they already exist).
    await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS tenant_extension_install_config_install_id_unique ON tenant_extension_install_config (install_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS tenant_extension_install_config_tenant_id_idx ON tenant_extension_install_config (tenant_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS tenant_extension_install_config_install_id_version_idx ON tenant_extension_install_config (install_id, version)');
  }

  const hasSecretsTable = await knex.schema.hasTable('tenant_extension_install_secrets');
  if (!hasSecretsTable) {
    try {
      await knex.schema.createTable('tenant_extension_install_secrets', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        t.uuid('install_id').notNullable().references('id').inTable('tenant_extension_install').onDelete('CASCADE');
        t.string('tenant_id').notNullable();
        t.text('ciphertext').notNullable();
        t.string('algorithm').notNullable().defaultTo('inline/base64');
        t.string('transit_key').nullable();
        t.string('transit_mount').nullable();
        t.string('version').nullable();
        t.timestamp('expires_at').nullable();
        t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
        t.unique(['install_id']);
        t.index(['tenant_id']);
        t.index(['install_id']);
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('already exists')) throw err;
    }
  } else {
    const ensureColumn = async (name, addColumn) => {
      const has = await knex.schema.hasColumn('tenant_extension_install_secrets', name);
      if (!has) {
        await knex.schema.alterTable('tenant_extension_install_secrets', addColumn);
      }
    };

    await ensureColumn('id', (t) => t.uuid('id').defaultTo(knex.raw('gen_random_uuid()')));
    await ensureColumn('install_id', (t) => t.uuid('install_id'));
    await ensureColumn('tenant_id', (t) => t.string('tenant_id'));
    await ensureColumn('ciphertext', (t) => t.text('ciphertext'));
    await ensureColumn('algorithm', (t) => t.string('algorithm').notNullable().defaultTo('inline/base64'));
    await ensureColumn('transit_key', (t) => t.string('transit_key').nullable());
    await ensureColumn('transit_mount', (t) => t.string('transit_mount').nullable());
    await ensureColumn('version', (t) => t.string('version').nullable());
    await ensureColumn('expires_at', (t) => t.timestamp('expires_at').nullable());
    await ensureColumn('created_at', (t) => t.timestamp('created_at').notNullable().defaultTo(knex.fn.now()));
    await ensureColumn('updated_at', (t) => t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now()));

    await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS tenant_extension_install_secrets_install_id_unique ON tenant_extension_install_secrets (install_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS tenant_extension_install_secrets_tenant_id_idx ON tenant_extension_install_secrets (tenant_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS tenant_extension_install_secrets_install_id_idx ON tenant_extension_install_secrets (install_id)');
  }
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('tenant_extension_install_secrets');
  await knex.schema.dropTableIfExists('tenant_extension_install_config');
};
