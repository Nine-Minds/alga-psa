const CANONICAL_EMAIL_TYPES = ['work', 'personal', 'billing', 'other'];

function normalizedEmailSql(columnExpression) {
  return `LOWER(BTRIM(${columnExpression}))`;
}

async function canCreateDistributedTable(knex) {
  const result = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc
      WHERE proname = 'create_distributed_table'
    ) AS exists;
  `);

  return Boolean(result.rows?.[0]?.exists);
}

async function isDistributed(knex, tableName) {
  const result = await knex.raw(
    `
      SELECT EXISTS (
        SELECT 1
        FROM pg_dist_partition
        WHERE logicalrelid = ?::regclass
      ) AS is_distributed;
    `,
    [tableName]
  );

  return Boolean(result.rows?.[0]?.is_distributed);
}

async function ensureTenantDistribution(knex, tableName) {
  if (!(await canCreateDistributedTable(knex))) {
    console.warn(`[${tableName}] Skipping create_distributed_table (function unavailable)`);
    return;
  }

  if (await isDistributed(knex, tableName)) {
    return;
  }

  await knex.raw(`SELECT create_distributed_table('${tableName}', 'tenant', colocate_with => 'tenants')`);
}

async function hasConstraint(knex, tableName, constraintName) {
  const result = await knex.raw(
    `
      SELECT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = ?::regclass
          AND conname = ?
      ) AS exists;
    `,
    [tableName, constraintName]
  );

  return Boolean(result.rows?.[0]?.exists);
}

async function addConstraintIfMissing(knex, tableName, constraintName, sql) {
  if (await hasConstraint(knex, tableName, constraintName)) {
    return;
  }

  await knex.raw(sql);
}

async function hasTrigger(knex, tableName, triggerName) {
  const result = await knex.raw(
    `
      SELECT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgrelid = ?::regclass
          AND tgname = ?
          AND NOT tgisinternal
      ) AS exists;
    `,
    [tableName, triggerName]
  );

  return Boolean(result.rows?.[0]?.exists);
}

exports.up = async function up(knex) {
  console.log('Creating contact email label definitions and additional email tables...');
  const distributedTablesSupported = await canCreateDistributedTable(knex);

  if (!(await knex.schema.hasTable('contact_email_type_definitions'))) {
    await knex.schema.createTable('contact_email_type_definitions', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('contact_email_type_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.text('label').notNullable();
      table.text('normalized_label').notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'contact_email_type_id']);
      table.unique(['tenant', 'normalized_label']);
      table.foreign('tenant').references('tenants.tenant');
    });
  }

  await addConstraintIfMissing(
    knex,
    'contact_email_type_definitions',
    'chk_contact_email_type_definitions_normalized_label',
    `
      ALTER TABLE contact_email_type_definitions
      ADD CONSTRAINT chk_contact_email_type_definitions_normalized_label
      CHECK (normalized_label = LOWER(BTRIM(normalized_label)))
    `
  );

  await ensureTenantDistribution(knex, 'contact_email_type_definitions');

  if (!(await knex.schema.hasColumn('contacts', 'primary_email_canonical_type'))) {
    await knex.schema.alterTable('contacts', (table) => {
      table.text('primary_email_canonical_type').nullable();
    });
  }

  if (!(await knex.schema.hasColumn('contacts', 'primary_email_custom_type_id'))) {
    await knex.schema.alterTable('contacts', (table) => {
      table.uuid('primary_email_custom_type_id').nullable();
    });
  }

  await addConstraintIfMissing(
    knex,
    'contacts',
    'fk_contacts_primary_email_custom_type',
    `
      ALTER TABLE contacts
      ADD CONSTRAINT fk_contacts_primary_email_custom_type
      FOREIGN KEY (tenant, primary_email_custom_type_id)
      REFERENCES contact_email_type_definitions (tenant, contact_email_type_id)
      ON DELETE RESTRICT;
    `
  );

  if (!(await knex.schema.hasTable('contact_additional_email_addresses'))) {
    await knex.schema.createTable('contact_additional_email_addresses', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('contact_additional_email_address_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.uuid('contact_name_id').notNullable();
      table.text('email_address').notNullable();
      table.text('canonical_type').nullable();
      table.uuid('custom_email_type_id').nullable();
      table.integer('display_order').notNullable().defaultTo(0);
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'contact_additional_email_address_id']);
      table.foreign('tenant').references('tenants.tenant');
    });
  }

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_contact_additional_emails_contact_order
    ON contact_additional_email_addresses (tenant, contact_name_id, display_order)
  `);

  await ensureTenantDistribution(knex, 'contact_additional_email_addresses');

  await addConstraintIfMissing(
    knex,
    'contact_additional_email_addresses',
    'fk_contact_additional_email_addresses_contact',
    `
      ALTER TABLE contact_additional_email_addresses
      ADD CONSTRAINT fk_contact_additional_email_addresses_contact
      FOREIGN KEY (tenant, contact_name_id)
      REFERENCES contacts (tenant, contact_name_id)
      ON DELETE CASCADE;
    `
  );

  await addConstraintIfMissing(
    knex,
    'contact_additional_email_addresses',
    'fk_contact_additional_email_addresses_custom_email_type',
    `
      ALTER TABLE contact_additional_email_addresses
      ADD CONSTRAINT fk_contact_additional_email_addresses_custom_email_type
      FOREIGN KEY (tenant, custom_email_type_id)
      REFERENCES contact_email_type_definitions (tenant, contact_email_type_id)
      ON DELETE RESTRICT;
    `
  );

  if (!(await knex.schema.hasColumn('contact_additional_email_addresses', 'normalized_email_address'))) {
    await knex.raw(`
      ALTER TABLE contact_additional_email_addresses
      ADD COLUMN normalized_email_address text
      GENERATED ALWAYS AS (${normalizedEmailSql('email_address')}) STORED
    `);
  }

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_contact_additional_emails_normalized_email
    ON contact_additional_email_addresses (tenant, normalized_email_address)
  `);

  await addConstraintIfMissing(
    knex,
    'contact_additional_email_addresses',
    'chk_contact_additional_email_addresses_canonical_type',
    `
      ALTER TABLE contact_additional_email_addresses
      ADD CONSTRAINT chk_contact_additional_email_addresses_canonical_type
      CHECK (
        canonical_type IS NULL
        OR canonical_type IN (${CANONICAL_EMAIL_TYPES.map((value) => `'${value}'`).join(', ')})
      )
    `
  );

  await addConstraintIfMissing(
    knex,
    'contact_additional_email_addresses',
    'chk_contact_additional_email_addresses_type_source',
    `
      ALTER TABLE contact_additional_email_addresses
      ADD CONSTRAINT chk_contact_additional_email_addresses_type_source
      CHECK (
        (
          canonical_type IS NOT NULL
          AND custom_email_type_id IS NULL
        ) OR (
          canonical_type IS NULL
          AND custom_email_type_id IS NOT NULL
        )
      )
    `
  );

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_contact_additional_email_addresses_tenant_normalized_email
    ON contact_additional_email_addresses (tenant, normalized_email_address)
  `);

  if (!distributedTablesSupported) {
    await knex.raw(`
      CREATE OR REPLACE FUNCTION check_contact_primary_email_uniqueness()
      RETURNS TRIGGER AS $$
      DECLARE
        normalized_primary text;
      BEGIN
        IF NEW.email IS NOT NULL THEN
          normalized_primary := LOWER(BTRIM(NEW.email));
          IF EXISTS (
            SELECT 1
            FROM contact_additional_email_addresses AS cea
            WHERE cea.tenant = NEW.tenant
              AND cea.normalized_email_address = normalized_primary
          ) THEN
            RAISE EXCEPTION 'A contact email already exists as an additional email address in this tenant';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE OR REPLACE FUNCTION check_contact_additional_email_uniqueness()
      RETURNS TRIGGER AS $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM contacts AS c
          WHERE c.tenant = NEW.tenant
            AND LOWER(BTRIM(c.email)) = LOWER(BTRIM(NEW.email_address))
        ) THEN
          RAISE EXCEPTION 'An additional email address already exists as a contact primary email in this tenant';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

    `);

    if (!(await hasTrigger(knex, 'contacts', 'trg_check_contact_primary_email_uniqueness'))) {
      await knex.raw(`
        CREATE TRIGGER trg_check_contact_primary_email_uniqueness
        BEFORE INSERT OR UPDATE ON contacts
        FOR EACH ROW
        EXECUTE FUNCTION check_contact_primary_email_uniqueness();
      `);
    }

    if (!(await hasTrigger(knex, 'contact_additional_email_addresses', 'trg_check_contact_additional_email_uniqueness'))) {
      await knex.raw(`
        CREATE TRIGGER trg_check_contact_additional_email_uniqueness
        BEFORE INSERT OR UPDATE ON contact_additional_email_addresses
        FOR EACH ROW
        EXECUTE FUNCTION check_contact_additional_email_uniqueness();
      `);
    }
  } else {
    console.log('Skipping cross-table email uniqueness triggers on distributed tables; application-level checks remain authoritative.');
  }

  await knex.raw(`
    UPDATE contacts
    SET primary_email_canonical_type = 'work',
        primary_email_custom_type_id = NULL
    WHERE email IS NOT NULL
      AND BTRIM(email) <> ''
      AND primary_email_canonical_type IS NULL
      AND primary_email_custom_type_id IS NULL;
  `);

  console.log('Contact email label schema created.');
};

exports.down = async function down(knex) {
  console.log('Dropping contact email address schema...');

  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_check_contact_additional_email_uniqueness ON contact_additional_email_addresses;
    DROP FUNCTION IF EXISTS check_contact_additional_email_uniqueness();
    DROP TRIGGER IF EXISTS trg_check_contact_primary_email_uniqueness ON contacts;
    DROP FUNCTION IF EXISTS check_contact_primary_email_uniqueness();
    DROP INDEX IF EXISTS ux_contact_additional_email_addresses_tenant_normalized_email;
    ALTER TABLE contacts DROP CONSTRAINT IF EXISTS fk_contacts_primary_email_custom_type;
    DROP TABLE IF EXISTS contact_additional_email_addresses;
    DROP TABLE IF EXISTS contact_email_type_definitions;
  `);

  await knex.schema.alterTable('contacts', (table) => {
    table.dropColumn('primary_email_canonical_type');
    table.dropColumn('primary_email_custom_type_id');
  });

  console.log('Contact email label schema dropped.');
};

exports.config = { transaction: false };
