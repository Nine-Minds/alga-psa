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

async function isCitusAvailable(knex) {
  const result = await knex.raw(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_proc
      WHERE proname = 'create_distributed_table'
    ) AS exists
  `);
  return Boolean(result?.rows?.[0]?.exists);
}

async function isDistributedTable(knex, tableName) {
  const result = await knex.raw(
    `
      SELECT EXISTS (
        SELECT 1
        FROM pg_dist_partition
        WHERE logicalrelid = ?::regclass
      ) AS is_distributed
    `,
    [tableName]
  );

  return Boolean(result?.rows?.[0]?.is_distributed);
}

async function ensureTenantDistributed(knex, tableName) {
  const citusAvailable = await isCitusAvailable(knex);
  if (!citusAvailable) return;

  const distributed = await isDistributedTable(knex, tableName);
  if (distributed) return;

  await knex.raw('SELECT create_distributed_table(?, ?)', [tableName, 'tenant']);
}

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

  // In Citus environments, clients/contacts are distributed by tenant.
  // Ensure inbound_ticket_defaults is also distributed before UPDATE/FK steps
  // to avoid "relation ... is not distributed" planning failures.
  await ensureTenantDistributed(knex, 'inbound_ticket_defaults');

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

// create_distributed_table cannot run inside a transaction block in Citus
exports.config = { transaction: false };
