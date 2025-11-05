#!/usr/bin/env node
/**
 * Development script to uninstall an extension
 * Usage: node scripts/dev-uninstall-extension.mjs <registry-id>
 */

import pg from 'pg';

const { Client } = pg;

// Database configuration
const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5433'),
  user: process.env.DB_USER_ADMIN || 'postgres',
  password: process.env.DB_PASSWORD_ADMIN || process.env.PGPASSWORD,
  database: process.env.DB_NAME_SERVER || 'server',
};

const TENANT_ID = process.env.DEV_TENANT_ID || '51bbbfe5-0720-4d9b-b3e5-b5b43e441a52';

async function uninstallExtension(registryId) {
  const client = new Client(DB_CONFIG);
  await client.connect();

  try {
    await client.query('BEGIN');

    // Get extension info first
    const regResult = await client.query(`
      SELECT er.name, er.publisher
      FROM extension_registry er
      WHERE er.id = $1
    `, [registryId]);

    if (regResult.rows.length === 0) {
      console.log(`⚠️  Extension not found: ${registryId}`);
      await client.query('ROLLBACK');
      return;
    }

    const extension = regResult.rows[0];
    console.log(`🗑️  Uninstalling: ${extension.publisher}/${extension.name}`);

    // Delete from tenant_extension_install (this will cascade to config and secrets)
    const installResult = await client.query(`
      DELETE FROM tenant_extension_install
      WHERE tenant_id = $1 AND registry_id = $2
      RETURNING id
    `, [TENANT_ID, registryId]);

    if (installResult.rows.length > 0) {
      console.log(`✅ Removed install record`);
    } else {
      console.log(`⚠️  No install record found for this tenant`);
    }

    // Optionally delete registry, version, and bundle entries
    // (commenting out to preserve for reinstall)
    /*
    await client.query('DELETE FROM extension_bundle WHERE version_id IN (SELECT id FROM extension_version WHERE registry_id = $1)', [registryId]);
    console.log(`✅ Removed bundle entries`);

    await client.query('DELETE FROM extension_version WHERE registry_id = $1', [registryId]);
    console.log(`✅ Removed version entries`);

    await client.query('DELETE FROM extension_registry WHERE id = $1', [registryId]);
    console.log(`✅ Removed registry entry`);
    */

    await client.query('COMMIT');

    console.log(`\n🎉 Extension uninstalled successfully!`);
    console.log(`Note: Registry, version, and bundle entries were preserved for reinstall.`);
    console.log(`To fully remove, manually delete from extension_registry, extension_version, and extension_bundle.`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error uninstalling extension:', error);
    throw error;
  } finally {
    await client.end();
  }
}

// Main execution
const registryId = process.argv[2];
if (!registryId) {
  console.error('Usage: node scripts/dev-uninstall-extension.mjs <registry-id>');
  process.exit(1);
}

uninstallExtension(registryId)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
