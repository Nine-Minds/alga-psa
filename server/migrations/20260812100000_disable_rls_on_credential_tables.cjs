/**
 * CE no-op placeholder.
 *
 * The real migration lives in ee/server/migrations/20260812100000_disable_rls_on_credential_tables.cjs
 * (credentials is an EE-only feature). This file exists only so CE databases
 * that already recorded this name in knex_migrations pass knex's "migration
 * directory is corrupt / files are missing" validation. It performs no DDL.
 * EE builds overlay the real file over this one (see server/scripts/run-ee-migrations.js).
 */

exports.up = async function up() {};

exports.down = async function down() {};

exports.config = { transaction: false };
