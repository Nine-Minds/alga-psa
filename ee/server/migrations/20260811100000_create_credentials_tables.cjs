/**
 * Creates the credentials vault tables (Entity Passwords / Credentials Vault):
 *
 *  - credentials               — encrypted credential rows owned by a client
 *  - credential_associations   — polymorphic entity attachments (assets in v1)
 *  - credential_access_grants  — per-credential ACL subjects (users / teams)
 *
 * Every table follows the repo-standard tenant-scoped pattern: composite PK
 * including `tenant`, and Citus distribution by `tenant`. NO RLS: the app
 * connects through pooled connections where `app.current_tenant` may be unset,
 * and the repo standard (`20260509120000_disable_remaining_rls_policies.cjs`)
 * dropped RLS repo-wide — tenant isolation is enforced at the query layer via
 * the tenantDb facade, exactly like every other table. Rows carry a per-row
 * `encryption_scheme` tag — the scheme roster is closed by a CHECK constraint;
 * adding a scheme is an explicit migration.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
async function distributeIfCitus(knex, tableName) {
  const citusFn = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc WHERE proname = 'create_distributed_table'
    ) AS exists;
  `);

  if (citusFn.rows?.[0]?.exists) {
    const alreadyDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition
        WHERE logicalrelid = '${tableName}'::regclass
      ) AS is_distributed;
    `);

    if (!alreadyDistributed.rows?.[0]?.is_distributed) {
      await knex.raw(`SELECT create_distributed_table('${tableName}', 'tenant')`);
    }
  }
}

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('credentials'))) {
    await knex.schema.createTable('credentials', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('credential_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('client_id').notNullable();
      table.text('name').notNullable();
      table.text('username');
      table.text('url');
      table.text('description');
      // Value-bearing fields: ciphertext only, never plaintext.
      table.text('password_ciphertext');
      table.text('otp_secret_ciphertext');
      table.text('encryption_scheme').notNullable().defaultTo('aes-256-gcm:v1');
      table.boolean('is_restricted').notNullable().defaultTo(false);
      table.uuid('created_by').notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'credential_id']);
      table.foreign('tenant').references('tenant').inTable('tenants');
      table.foreign(['tenant', 'client_id']).references(['tenant', 'client_id']).inTable('clients');
      table.foreign(['tenant', 'created_by']).references(['tenant', 'user_id']).inTable('users');

      // Scheme roster is closed by the CHECK; adding a scheme is an explicit migration.
      table.check(
        "encryption_scheme IN ('vault-transit:v1', 'aes-256-gcm:v1')",
        [],
        'credentials_encryption_scheme_check'
      );

      // Search / scoping indexes.
      table.index(['tenant', 'client_id'], 'idx_credentials_tenant_client');
      table.index(['tenant', 'name'], 'idx_credentials_tenant_name');
    });
  }

  await distributeIfCitus(knex, 'credentials');

  if (!(await knex.schema.hasTable('credential_associations'))) {
    await knex.schema.createTable('credential_associations', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('association_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('credential_id').notNullable();
      table.uuid('entity_id').notNullable();
      // Extensible entity roster, mirroring document_associations.
      table.text('entity_type').notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'association_id']);
      table.foreign('tenant').references('tenant').inTable('tenants');
      table.foreign(['tenant', 'credential_id'])
        .references(['tenant', 'credential_id'])
        .inTable('credentials')
        .onDelete('CASCADE');
      table.check("entity_type IN ('asset')", [], 'credential_associations_entity_type_check');
      table.unique(
        ['tenant', 'credential_id', 'entity_id', 'entity_type'],
        'credential_associations_credential_entity_unique'
      );
      table.index(['tenant', 'entity_id', 'entity_type'], 'idx_credential_associations_entity');
    });
  }

  await distributeIfCitus(knex, 'credential_associations');

  if (!(await knex.schema.hasTable('credential_access_grants'))) {
    await knex.schema.createTable('credential_access_grants', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('grant_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('credential_id').notNullable();
      table.text('subject_type').notNullable();
      table.uuid('subject_id').notNullable();
      table.uuid('created_by').notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'grant_id']);
      table.foreign('tenant').references('tenant').inTable('tenants');
      table.foreign(['tenant', 'credential_id'])
        .references(['tenant', 'credential_id'])
        .inTable('credentials')
        .onDelete('CASCADE');
      table.foreign(['tenant', 'created_by']).references(['tenant', 'user_id']).inTable('users');
      table.check("subject_type IN ('user', 'team')", [], 'credential_access_grants_subject_type_check');
      table.unique(
        ['tenant', 'credential_id', 'subject_type', 'subject_id'],
        'credential_access_grants_subject_unique'
      );
      table.index(['tenant', 'credential_id'], 'idx_credential_access_grants_credential');
    });
  }

  await distributeIfCitus(knex, 'credential_access_grants');
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('credential_access_grants');
  await knex.schema.dropTableIfExists('credential_associations');
  await knex.schema.dropTableIfExists('credentials');
};

// CitusDB: create_distributed_table cannot run inside a transaction
exports.config = { transaction: false };
