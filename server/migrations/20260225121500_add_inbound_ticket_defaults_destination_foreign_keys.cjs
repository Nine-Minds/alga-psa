/**
 * Add tenant-scoped foreign keys for inbound destination references.
 *
 * Foreign keys:
 * - clients (inbound_ticket_defaults_id, tenant) -> inbound_ticket_defaults (id, tenant)
 * - contacts (inbound_ticket_defaults_id, tenant) -> inbound_ticket_defaults (id, tenant)
 *
 * Before adding constraints we null out any invalid references to keep migration safe.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */

const CLIENTS_CONSTRAINT = 'fk_clients_inbound_ticket_defaults';
const CONTACTS_CONSTRAINT = 'fk_contacts_inbound_ticket_defaults';

async function hasConstraint(knex, tableName, constraintName) {
  const result = await knex.raw(
    `
      SELECT 1
      FROM pg_constraint
      WHERE conname = ?
        AND conrelid = ?::regclass
      LIMIT 1
    `,
    [constraintName, tableName]
  );

  return Boolean(result?.rows?.length);
}

exports.up = async function up(knex) {
  const hasDefaultsTable = await knex.schema.hasTable('inbound_ticket_defaults');
  if (!hasDefaultsTable) return;

  const hasClientsTable = await knex.schema.hasTable('clients');
  const hasContactsTable = await knex.schema.hasTable('contacts');

  if (hasClientsTable) {
    const hasClientColumn = await knex.schema.hasColumn('clients', 'inbound_ticket_defaults_id');
    if (hasClientColumn) {
      await knex.raw(`
        UPDATE clients AS c
        SET inbound_ticket_defaults_id = NULL
        WHERE c.inbound_ticket_defaults_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM inbound_ticket_defaults AS d
            WHERE d.tenant = c.tenant
              AND d.id = c.inbound_ticket_defaults_id
          )
      `);

      if (!await hasConstraint(knex, 'clients', CLIENTS_CONSTRAINT)) {
        await knex.raw(`
          ALTER TABLE clients
          ADD CONSTRAINT ${CLIENTS_CONSTRAINT}
          FOREIGN KEY (inbound_ticket_defaults_id, tenant)
          REFERENCES inbound_ticket_defaults (id, tenant)
        `);
      }
    }
  }

  if (hasContactsTable) {
    const hasContactColumn = await knex.schema.hasColumn('contacts', 'inbound_ticket_defaults_id');
    if (hasContactColumn) {
      await knex.raw(`
        UPDATE contacts AS c
        SET inbound_ticket_defaults_id = NULL
        WHERE c.inbound_ticket_defaults_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM inbound_ticket_defaults AS d
            WHERE d.tenant = c.tenant
              AND d.id = c.inbound_ticket_defaults_id
          )
      `);

      if (!await hasConstraint(knex, 'contacts', CONTACTS_CONSTRAINT)) {
        await knex.raw(`
          ALTER TABLE contacts
          ADD CONSTRAINT ${CONTACTS_CONSTRAINT}
          FOREIGN KEY (inbound_ticket_defaults_id, tenant)
          REFERENCES inbound_ticket_defaults (id, tenant)
        `);
      }
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  if (await hasConstraint(knex, 'clients', CLIENTS_CONSTRAINT)) {
    await knex.raw(`ALTER TABLE clients DROP CONSTRAINT ${CLIENTS_CONSTRAINT}`);
  }

  if (await hasConstraint(knex, 'contacts', CONTACTS_CONSTRAINT)) {
    await knex.raw(`ALTER TABLE contacts DROP CONSTRAINT ${CONTACTS_CONSTRAINT}`);
  }
};
