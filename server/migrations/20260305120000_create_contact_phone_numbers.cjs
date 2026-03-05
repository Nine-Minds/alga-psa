/**
 * Create contact_phone_numbers table for multiple phone numbers per contact.
 *
 * Predefined types: Office, Mobile, Home, Fax, Other.
 * One number per type per contact (UNIQUE constraint).
 * Existing contacts.phone_number values are migrated as Office/primary.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('contact_phone_numbers');
  if (hasTable) return;

  await knex.schema.createTable('contact_phone_numbers', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('phone_number_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('contact_id').notNullable();
    table
      .text('phone_type')
      .notNullable()
      .defaultTo('Office');
    table.text('phone_number').notNullable();
    table.text('extension').nullable();
    table.text('country_code').nullable();
    table.boolean('is_primary').notNullable().defaultTo(false);
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

    table.primary(['tenant', 'phone_number_id']);

    table
      .foreign(['tenant', 'contact_id'])
      .references(['tenant', 'contact_name_id'])
      .inTable('contacts')
      .onDelete('CASCADE');

    table.unique(['tenant', 'contact_id', 'phone_type']);

    table.index(['tenant', 'contact_id']);
  });

  // CHECK constraint for phone_type enum
  await knex.raw(`
    ALTER TABLE contact_phone_numbers
    ADD CONSTRAINT contact_phone_numbers_phone_type_check
    CHECK (phone_type IN ('Office', 'Mobile', 'Home', 'Fax', 'Other'))
  `);

  // Partial unique index: at most one primary per contact
  await knex.raw(`
    CREATE UNIQUE INDEX contact_phone_numbers_one_primary
    ON contact_phone_numbers (tenant, contact_id)
    WHERE is_primary = true
  `);

  // Migrate existing phone numbers from contacts table
  await knex.raw(`
    INSERT INTO contact_phone_numbers
      (tenant, phone_number_id, contact_id, phone_type, phone_number, is_primary, created_at, updated_at)
    SELECT
      tenant,
      gen_random_uuid(),
      contact_name_id,
      'Office',
      phone_number,
      true,
      NOW(),
      NOW()
    FROM contacts
    WHERE phone_number IS NOT NULL
      AND phone_number != ''
      AND TRIM(phone_number) != ''
    ON CONFLICT DO NOTHING
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('contact_phone_numbers');
  if (!hasTable) return;

  await knex.schema.dropTable('contact_phone_numbers');
};
