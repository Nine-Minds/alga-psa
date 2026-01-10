#!/usr/bin/env node
/**
 * Development script to install an extension from a local directory
 * Usage: node scripts/dev-install-extension.mjs <path-to-extension-dir>
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
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

// MinIO configuration
const MINIO_CONFIG = {
  endpoint: process.env.S3_ENDPOINT || 'http://localhost:4569',
  accessKey: process.env.S3_ACCESS_KEY || 'minioadmin',
  secretKey: process.env.S3_SECRET_KEY || 'minioadmin',
  bucket: process.env.S3_BUCKET || 'extensions',
  region: process.env.S3_REGION || 'us-east-1',
};

/**
 * Upload bundle to MinIO using curl with AWS Signature V4
 */
async function uploadBundleToMinio(bundlePath, tenantId, registryId, contentHash) {
  const hash = contentHash.replace('sha256:', '');
  const targetKey = `tenants/${tenantId}/extensions/${registryId}/sha256/${hash}/bundle.tar.zst`;
  const url = `${MINIO_CONFIG.endpoint}/${MINIO_CONFIG.bucket}/${targetKey}`;

  console.log(`📤 Uploading bundle to MinIO: ${targetKey}`);

  try {
    // Use curl with AWS Signature V4 for authentication
    const curlCmd = [
      'curl', '-s', '-X', 'PUT',
      `"${url}"`,
      '--upload-file', `"${bundlePath}"`,
      '-H', '"Content-Type: application/octet-stream"',
      '--user', `"${MINIO_CONFIG.accessKey}:${MINIO_CONFIG.secretKey}"`,
      '--aws-sigv4', `"aws:amz:${MINIO_CONFIG.region}:s3"`,
    ].join(' ');

    execSync(curlCmd, { stdio: 'pipe' });
    console.log(`✅ Bundle uploaded to MinIO`);
    return `${MINIO_CONFIG.endpoint}/${MINIO_CONFIG.bucket}/${targetKey}`;
  } catch (error) {
    console.error(`⚠️  Failed to upload bundle to MinIO: ${error.message}`);
    console.error(`   You may need to manually upload the bundle using:`);
    console.error(`   curl -X PUT "${url}" --upload-file "${bundlePath}" -H "Content-Type: application/octet-stream" --user "${MINIO_CONFIG.accessKey}:${MINIO_CONFIG.secretKey}" --aws-sigv4 "aws:amz:${MINIO_CONFIG.region}:s3"`);
    return null;
  }
}

async function calculateContentHash(extensionPath) {
  // Use the actual bundle file hash if it exists, otherwise fall back to manifest hash
  const bundleHashPath = join(resolve(extensionPath), 'dist', 'bundle.sha256');

  if (existsSync(bundleHashPath)) {
    // Read the pre-computed bundle hash
    const hash = readFileSync(bundleHashPath, 'utf8').trim();
    console.log(`📋 Using bundle hash from ${bundleHashPath}`);
    return `sha256:${hash}`;
  }

  // Fall back to manifest hash (for backwards compatibility)
  console.log(`⚠️  No bundle.sha256 found, using manifest hash (may cause hash mismatch)`);
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

    // Generate fallback UUIDs (only used if creating new entries)
    const fallbackRegistryId = generateUuidV5(`${manifest.publisher || 'local-dev'}/${manifest.name}`, namespace);
    const fallbackVersionId = generateUuidV5(`${manifest.publisher || 'local-dev'}/${manifest.name}/${manifest.version}`, namespace);
    const fallbackBundleId = generateUuidV5(`${manifest.publisher || 'local-dev'}/${manifest.name}/${manifest.version}/${contentHash}`, namespace);
    const fallbackInstallId = generateUuidV5(`${TENANT_ID}/${manifest.publisher || 'local-dev'}/${manifest.name}`, namespace);

    await client.query('BEGIN');

    // Insert into extension_registry - capture actual ID from DB
    const registryResult = await client.query(`
      INSERT INTO extension_registry (id, publisher, name, display_name, description)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (publisher, name) DO UPDATE
      SET display_name = EXCLUDED.display_name,
          description = EXCLUDED.description,
          updated_at = NOW()
      RETURNING id
    `, [
      fallbackRegistryId,
      manifest.publisher || 'local-dev',
      manifest.name,
      manifest.displayName || manifest.name,
      manifest.description || '',
    ]);
    const registryId = registryResult.rows[0].id;
    console.log(`✅ Registry entry created/updated: ${registryId}`);

    // Insert into extension_version - capture actual ID from DB
    const versionResult = await client.query(`
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
      fallbackVersionId,
      registryId,
      manifest.version,
      manifest.runtime || 'wasm',
      manifest.main || 'handlers/index.wasm',
      JSON.stringify(manifest.api || {}),
      JSON.stringify(manifest.ui || { entry: '/index.html' }),
      JSON.stringify(manifest.capabilities || []),
      JSON.stringify(manifest.apiEndpoints || []),
    ]);
    const versionId = versionResult.rows[0].id;
    console.log(`✅ Version entry created/updated: ${versionId}`);

    // Insert into extension_bundle - capture actual ID from DB
    const bundleResult = await client.query(`
      INSERT INTO extension_bundle (id, version_id, content_hash, storage_url)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (version_id, content_hash) DO UPDATE
      SET storage_url = EXCLUDED.storage_url
      RETURNING id
    `, [
      fallbackBundleId,
      versionId,
      contentHash,
      `file://${extensionPath}`,
    ]);
    const bundleId = bundleResult.rows[0].id;
    console.log(`✅ Bundle entry created/updated: ${bundleId}`);

    // Insert into tenant_extension_install - capture actual ID from DB
    const installResult = await client.query(`
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
      fallbackInstallId,
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
    const installId = installResult.rows[0].id;
    console.log(`✅ Install entry created/updated: ${installId}`);

    await client.query('COMMIT');

    // Upload bundle to MinIO if dist/bundle.tar.zst exists
    const bundlePath = join(resolve(extensionPath), 'dist', 'bundle.tar.zst');
    if (existsSync(bundlePath)) {
      const storageUrl = await uploadBundleToMinio(bundlePath, TENANT_ID, registryId, contentHash);
      if (storageUrl) {
        // Update the bundle record with the actual storage URL
        const updateClient = new Client(DB_CONFIG);
        await updateClient.connect();
        try {
          await updateClient.query(
            `UPDATE extension_bundle SET storage_url = $1 WHERE id = $2`,
            [storageUrl, bundleId]
          );
          console.log(`✅ Bundle storage_url updated in database`);
        } finally {
          await updateClient.end();
        }
      }
    } else {
      console.log(`⚠️  No bundle found at ${bundlePath}`);
      console.log(`   Run 'npm run bundle' in the extension directory first`);
    }

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
