'use strict';

/**
 * VIP / point-of-contact flags (labelling + ticket-list filtering only).
 *
 *   contacts.is_vip              boolean NOT NULL DEFAULT false
 *   contacts.is_primary_contact  boolean NOT NULL DEFAULT false   (POC; deliberately NOT unique per client)
 *   clients.is_vip               boolean NOT NULL DEFAULT false
 *   (tenant, is_vip) indexes on contacts and clients
 *
 * POC decision: no contact-level primary/POC concept exists. The only "primary contact" in the schema is
 * clients.properties.primary_contact_id, which the UI calls "Default contact" and which is the fallback
 * contact for inbound email from unknown senders. That is a different meaning, so it is not overloaded.
 *
 * Citus: contacts and clients are tenant-distributed. ALTER TABLE ADD COLUMN and CREATE INDEX on a
 * distributed table propagate to shards; the indexes lead with the distribution column (tenant).
 * Constant, non-volatile defaults make ADD COLUMN a metadata-only change on PostgreSQL 11+.
 */

exports.up = async function up(knex) {
  await knex.raw('ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_vip boolean NOT NULL DEFAULT false');
  await knex.raw('ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_primary_contact boolean NOT NULL DEFAULT false');
  await knex.raw('ALTER TABLE clients ADD COLUMN IF NOT EXISTS is_vip boolean NOT NULL DEFAULT false');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_contacts_tenant_is_vip ON contacts (tenant, is_vip)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_clients_tenant_is_vip ON clients (tenant, is_vip)');
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_clients_tenant_is_vip');
  await knex.raw('DROP INDEX IF EXISTS idx_contacts_tenant_is_vip');
  await knex.raw('ALTER TABLE clients DROP COLUMN IF EXISTS is_vip');
  await knex.raw('ALTER TABLE contacts DROP COLUMN IF EXISTS is_primary_contact');
  await knex.raw('ALTER TABLE contacts DROP COLUMN IF EXISTS is_vip');
};

// Mirrors the table migrations: no wrapping transaction (Citus DDL on distributed tables).
exports.config = { transaction: false };
