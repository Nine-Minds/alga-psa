#!/usr/bin/env node
/**
 * Development script to install an extension from a local directory
 * Usage: node scripts/dev-install-extension.mjs <path-to-extension-dir>
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import pg from 'pg';

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Database configuration
const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5433'),
  user: process.env.DB_USER_ADMIN || 'postgres',
  password: process.env.DB_PASSWORD_ADMIN || process.env.PGPASSWORD,
  database: process.env.DB_NAME_SERVER || 'server',
};

const TENANT_ID = process.env.DEV_TENANT_ID || '51bbbfe5-0720-4d9b-b3e5-b5b43e441a52';

async function calculateContentHash(extensionPath) {
  // For simplicity, just hash the manifest content
  // In production, this would hash the entire bundle
  const manifestPath = join(extensionPath, 'manifest.json');
  const manifestContent = readFileSync(manifestPath, 'utf8');
  const hash = createHash('sha256').update(manifestContent).digest('hex');
  return `sha256:${hash}`;
}

async function installExtension(extensionPath) {
  const client = new Client(DB_CONFIG);
  await client.connect();

  try {
    // Read manifest
    const manifestPath = join(extensionPath, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

    console.log(`📦 Installing extension: ${manifest.name} v${manifest.version}`);

    // Calculate content hash
    const contentHash = await calculateContentHash(extensionPath);
    console.log(`🔑 Content hash: ${contentHash}`);

    // Generate deterministic UUIDs from the extension name
    const crypto = await import('crypto');
    const namespace = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // Fixed namespace UUID

    function generateUuidV5(name, namespace) {
      const hash = crypto.createHash('sha1');
      // Convert namespace UUID to bytes
      const namespaceBytes = namespace.replace(/-/g, '').match(/.{2}/g).map(byte => parseInt(byte, 16));
      hash.update(Buffer.from(namespaceBytes));
      hash.update(name, 'utf8');
      const hashBytes = hash.digest();
      // Set version (5) and variant bits
      hashBytes[6] = (hashBytes[6] & 0x0f) | 0x50;
      hashBytes[8] = (hashBytes[8] & 0x3f) | 0x80;
      const hex = hashBytes.toString('hex');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
    }

    const registryId = generateUuidV5(`${manifest.publisher || 'local-dev'}/${manifest.name}`, namespace);
    const versionId = generateUuidV5(`${manifest.publisher || 'local-dev'}/${manifest.name}/${manifest.version}`, namespace);
    const bundleId = generateUuidV5(`${manifest.publisher || 'local-dev'}/${manifest.name}/${manifest.version}/${contentHash}`, namespace);
    const installId = generateUuidV5(`${TENANT_ID}/${manifest.publisher || 'local-dev'}/${manifest.name}`, namespace);

    await client.query('BEGIN');

    // Insert into extension_registry
    await client.query(`
      INSERT INTO extension_registry (id, publisher, name, display_name, description)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (publisher, name) DO UPDATE
      SET display_name = EXCLUDED.display_name,
          description = EXCLUDED.description,
          updated_at = NOW()
      RETURNING id
    `, [
      registryId,
      manifest.publisher || 'local-dev',
      manifest.name,
      manifest.displayName || manifest.name,
      manifest.description || '',
    ]);
    console.log(`✅ Registry entry created/updated: ${registryId}`);

    // Insert into extension_version
    await client.query(`
      INSERT INTO extension_version (
        id, registry_id, version, runtime, main_entry,
        api, ui, capabilities, api_endpoints
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (registry_id, version) DO UPDATE
      SET runtime = EXCLUDED.runtime,
          main_entry = EXCLUDED.main_entry,
          api = EXCLUDED.api,
          ui = EXCLUDED.ui,
          capabilities = EXCLUDED.capabilities,
          api_endpoints = EXCLUDED.api_endpoints
      RETURNING id
    `, [
      versionId,
      registryId,
      manifest.version,
      manifest.runtime || 'wasm',
      manifest.main || 'handlers/index.wasm',
      JSON.stringify(manifest.api || {}),
      JSON.stringify(manifest.ui || { entry: '/index.html' }),
      JSON.stringify(manifest.capabilities || []),
      JSON.stringify(manifest.apiEndpoints || []),
    ]);
    console.log(`✅ Version entry created/updated: ${versionId}`);

    // Insert into extension_bundle
    await client.query(`
      INSERT INTO extension_bundle (id, version_id, content_hash, storage_url)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (version_id, content_hash) DO UPDATE
      SET storage_url = EXCLUDED.storage_url
      RETURNING id
    `, [
      bundleId,
      versionId,
      contentHash,
      `file://${extensionPath}`,
    ]);
    console.log(`✅ Bundle entry created/updated: ${bundleId}`);

    // Insert into tenant_extension_install
    await client.query(`
      INSERT INTO tenant_extension_install (
        id, tenant_id, registry_id, version_id,
        granted_caps, config, is_enabled, status,
        runner_domain, runner_status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (tenant_id, registry_id) DO UPDATE
      SET version_id = EXCLUDED.version_id,
          is_enabled = EXCLUDED.is_enabled,
          status = EXCLUDED.status,
          runner_status = EXCLUDED.runner_status,
          updated_at = NOW()
      RETURNING id
    `, [
      installId,
      TENANT_ID,
      registryId,
      versionId,
      JSON.stringify([]),
      JSON.stringify({}),
      true,
      'enabled',
      null, // runner_domain (null for Docker mode)
      JSON.stringify({ state: 'ready' }),
    ]);
    console.log(`✅ Install entry created/updated: ${installId}`);

    await client.query('COMMIT');

    console.log(`\n🎉 Extension installed successfully!`);
    console.log(`Registry ID: ${registryId}`);
    console.log(`Extension URL: http://localhost:3000/msp/extensions/${registryId}`);

    return { registryId, versionId, bundleId, installId, contentHash };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error installing extension:', error);
    throw error;
  } finally {
    await client.end();
  }
}

// Main execution
const extensionPath = process.argv[2];
if (!extensionPath) {
  console.error('Usage: node scripts/dev-install-extension.mjs <path-to-extension-dir>');
  process.exit(1);
}

installExtension(extensionPath)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
