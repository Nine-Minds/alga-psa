const CANONICAL_PHONE_TYPES = ['work', 'mobile', 'home', 'fax', 'other'];

function normalizedPhoneSql(columnExpression) {
  return `REGEXP_REPLACE(BTRIM(${columnExpression}), '[^0-9]+', '', 'g')`;
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

exports.up = async function up(knex) {
  console.log('Creating contact phone type definition and phone number tables...');

  if (!(await knex.schema.hasTable('contact_phone_type_definitions'))) {
    await knex.schema.createTable('contact_phone_type_definitions', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('contact_phone_type_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.text('label').notNullable();
      table.text('normalized_label').notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'contact_phone_type_id']);
      table.unique(['tenant', 'normalized_label']);
      table.foreign('tenant').references('tenants.tenant');
    });
  }

  await addConstraintIfMissing(
    knex,
    'contact_phone_type_definitions',
    'chk_contact_phone_type_definitions_normalized_label',
    `
      ALTER TABLE contact_phone_type_definitions
      ADD CONSTRAINT chk_contact_phone_type_definitions_normalized_label
      CHECK (normalized_label = LOWER(BTRIM(normalized_label)))
    `
  );

  await ensureTenantDistribution(knex, 'contact_phone_type_definitions');

  if (!(await knex.schema.hasTable('contact_phone_numbers'))) {
    await knex.schema.createTable('contact_phone_numbers', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('contact_phone_number_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.uuid('contact_name_id').notNullable();
      table.text('phone_number').notNullable();
      table.text('canonical_type').nullable();
      table.uuid('custom_phone_type_id').nullable();
      table.boolean('is_default').notNullable().defaultTo(false);
      table.integer('display_order').notNullable().defaultTo(0);
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'contact_phone_number_id']);
      table.foreign('tenant').references('tenants.tenant');
    });
  }

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_contact_phone_numbers_contact_order
    ON contact_phone_numbers (tenant, contact_name_id, display_order)
  `);

  if (!(await knex.schema.hasColumn('contact_phone_numbers', 'normalized_phone_number'))) {
    await knex.raw(`
      ALTER TABLE contact_phone_numbers
      ADD COLUMN normalized_phone_number text
      GENERATED ALWAYS AS (${normalizedPhoneSql('phone_number')}) STORED
    `);
  }

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_contact_phone_numbers_normalized_phone
    ON contact_phone_numbers (tenant, normalized_phone_number)
  `);

  await addConstraintIfMissing(
    knex,
    'contact_phone_numbers',
    'chk_contact_phone_numbers_canonical_type',
    `
      ALTER TABLE contact_phone_numbers
      ADD CONSTRAINT chk_contact_phone_numbers_canonical_type
      CHECK (
        canonical_type IS NULL
        OR canonical_type IN (${CANONICAL_PHONE_TYPES.map((value) => `'${value}'`).join(', ')})
      )
    `
  );

  await addConstraintIfMissing(
    knex,
    'contact_phone_numbers',
    'chk_contact_phone_numbers_type_source',
    `
      ALTER TABLE contact_phone_numbers
      ADD CONSTRAINT chk_contact_phone_numbers_type_source
      CHECK (
        (
          canonical_type IS NOT NULL
          AND custom_phone_type_id IS NULL
        ) OR (
          canonical_type IS NULL
          AND custom_phone_type_id IS NOT NULL
        )
      )
    `
  );

  await ensureTenantDistribution(knex, 'contact_phone_numbers');

  await addConstraintIfMissing(
    knex,
    'contact_phone_numbers',
    'fk_contact_phone_numbers_contact',
    `
      ALTER TABLE contact_phone_numbers
      ADD CONSTRAINT fk_contact_phone_numbers_contact
      FOREIGN KEY (tenant, contact_name_id)
      REFERENCES contacts (tenant, contact_name_id)
      ON DELETE CASCADE
    `
  );

  await addConstraintIfMissing(
    knex,
    'contact_phone_numbers',
    'fk_contact_phone_numbers_custom_phone_type',
    `
      ALTER TABLE contact_phone_numbers
      ADD CONSTRAINT fk_contact_phone_numbers_custom_phone_type
      FOREIGN KEY (tenant, custom_phone_type_id)
      REFERENCES contact_phone_type_definitions (tenant, contact_phone_type_id)
      ON DELETE RESTRICT
    `
  );

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_contact_phone_numbers_default_per_contact
    ON contact_phone_numbers (tenant, contact_name_id)
    WHERE is_default = true
  `);

  console.log('Backfilling existing contacts.phone_number values into contact_phone_numbers...');

  await knex.raw(`
    INSERT INTO contact_phone_numbers (
      tenant,
      contact_phone_number_id,
      contact_name_id,
      phone_number,
      canonical_type,
      custom_phone_type_id,
      is_default,
      display_order,
      created_at,
      updated_at
    )
    SELECT
      tenant,
      gen_random_uuid(),
      contact_name_id,
      BTRIM(phone_number),
      'work',
      NULL,
      true,
      0,
      COALESCE(created_at, NOW()),
      COALESCE(updated_at, created_at, NOW())
    FROM contacts
    WHERE phone_number IS NOT NULL
      AND BTRIM(phone_number) <> ''
  `);

  console.log('Contact phone number schema created and existing scalar phones backfilled.');
};

exports.down = async function down(knex) {
  console.log('Dropping contact phone number schema...');

  await knex.schema.dropTableIfExists('contact_phone_numbers');
  await knex.schema.dropTableIfExists('contact_phone_type_definitions');

  console.log('Contact phone number schema dropped.');
};

exports.config = { transaction: false };
