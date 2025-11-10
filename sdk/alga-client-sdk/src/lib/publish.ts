import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { packProject } from './pack-project.js';

export interface PublishExtensionOptions {
  /** Path to extension project directory (containing manifest.json) OR path to bundle.tar.zst */
  projectPath: string;
  /** API key for authentication */
  apiKey: string;
  /** Tenant ID to install extension for */
  tenantId: string;
  /** Base URL of Alga PSA server (default: http://localhost:3000) */
  baseUrl?: string;
  /** Whether to install after publishing (default: true) */
  install?: boolean;
  /** Force overwrite of existing bundle file when packing */
  force?: boolean;
  /** Custom fetch implementation */
  fetchImpl?: typeof fetch;
  /** Timeout in milliseconds */
  timeoutMs?: number;
  logger?: { info: (...args: any[]) => void; warn: (...args: any[]) => void };
}

export interface PublishExtensionResult {
  success: boolean;
  registryId?: string;
  versionId?: string;
  contentHash?: string;
  installId?: string;
  message?: string;
  error?: string;
}

const DEFAULT_BASE_URL = process.env.ALGA_API_BASE_URL || 'http://localhost:3000';

function resolveBaseUrl(baseUrl?: string): string {
  const value = baseUrl ?? DEFAULT_BASE_URL;
  if (!value) {
    throw new Error('Base URL is required. Provide `baseUrl` or set ALGA_API_BASE_URL.');
  }
  return value.replace(/\/?$/, '');
}

/**
 * Publishes an extension to Alga PSA server
 *
 * Workflow:
 * 1. Pack the extension if needed (creates bundle.tar.zst)
 * 2. Upload bundle to staging area
 * 3. Finalize bundle (creates registry/version/bundle records)
 * 4. Optionally install for tenant
 */
export async function publishExtension(options: PublishExtensionOptions): Promise<PublishExtensionResult> {
  const {
    projectPath,
    apiKey,
    tenantId,
    baseUrl,
    install = true,
    force = false,
    fetchImpl,
    timeoutMs,
    logger = console,
  } = options;

  if (!projectPath) throw new Error('projectPath is required');
  if (!apiKey) throw new Error('apiKey is required');
  if (!tenantId) throw new Error('tenantId is required');

  const fetcher = fetchImpl ?? globalThis.fetch;
  if (!fetcher) {
    throw new Error('Global fetch is not available. Provide a custom `fetchImpl`.');
  }

  const base = resolveBaseUrl(baseUrl);
  const controller = typeof timeoutMs === 'number' ? new AbortController() : undefined;
  const timer = controller && timeoutMs && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

  try {
    // Determine if projectPath is a bundle or a project directory
    const resolved = resolve(projectPath);
    let bundlePath: string;
    let manifestPath: string;

    if (resolved.endsWith('.tar.zst') || resolved.endsWith('.zst')) {
      // It's a bundle file
      bundlePath = resolved;
      // Try to find manifest.json in same directory
      const dir = resolve(bundlePath, '..');
      manifestPath = resolve(dir, 'manifest.json');
      logger.info(`Using existing bundle: ${bundlePath}`);
    } else {
      // It's a project directory - pack it
      logger.info(`Packing extension from: ${resolved}`);
      bundlePath = await packProject({ projectPath: resolved, force, logger });
      manifestPath = resolve(resolved, 'manifest.json');
      logger.info(`✓ Bundle created: ${bundlePath}`);
    }

    // Read manifest
    const manifestContent = readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestContent);
    logger.info(`Extension: ${manifest.publisher || 'local-dev'}/${manifest.name} v${manifest.version}`);

    // Read bundle and compute hash
    const bundleData = readFileSync(bundlePath);
    const bundleSize = statSync(bundlePath).size;
    const hash = createHash('sha256');
    hash.update(bundleData);
    const bundleHash = hash.digest('hex');
    logger.info(`Bundle size: ${(bundleSize / 1024 / 1024).toFixed(2)} MB`);
    logger.info(`SHA256: ${bundleHash}`);

    // Step 1: Upload to staging
    logger.info('Uploading bundle...');
    const uploadUrl = `${base}/api/ext-bundles/upload-proxy?filename=${encodeURIComponent('bundle.tar.zst')}&size=${bundleSize}&declaredHash=${bundleHash}`;
    const uploadRes = await fetcher(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-alga-admin': 'true', // For local dev
        'x-api-key': apiKey,
        'x-tenant-id': tenantId,
      },
      body: bundleData,
      signal: controller?.signal,
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      throw new Error(`Upload failed (${uploadRes.status}): ${errText}`);
    }

    const uploadResult = await uploadRes.json() as any;
    const stagingKey = uploadResult.upload?.key;
    logger.info(`✓ Uploaded to staging: ${stagingKey}`);

    // Step 2: Finalize bundle
    logger.info('Finalizing bundle...');
    const finalizeUrl = `${base}/api/ext-bundles/finalize`;
    const finalizeRes = await fetcher(finalizeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-alga-admin': 'true', // For local dev
        'x-api-key': apiKey,
        'x-tenant-id': tenantId,
      },
      body: JSON.stringify({
        key: stagingKey,
        declaredHash: bundleHash,
        size: bundleSize,
        manifestJson: manifestContent,
      }),
      signal: controller?.signal,
    });

    if (!finalizeRes.ok) {
      const errText = await finalizeRes.text();
      throw new Error(`Finalize failed (${finalizeRes.status}): ${errText}`);
    }

    const finalizeResult = await finalizeRes.json() as any;
    const registryId = finalizeResult.extension?.id;
    const versionId = finalizeResult.version?.id;
    const contentHash = finalizeResult.contentHash;

    logger.info(`✓ Extension registered:`);
    logger.info(`  Registry ID: ${registryId}`);
    logger.info(`  Version ID: ${versionId}`);
    logger.info(`  Content Hash: ${contentHash}`);

    // Step 3: Install for tenant (if requested)
    let installId: string | undefined;
    if (install) {
      logger.info('Installing extension for tenant...');
      const installUrl = `${base}/api/v1/extensions/install`;
      const installRes = await fetcher(installUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-tenant-id': tenantId,
        },
        body: JSON.stringify({
          registryId,
          version: manifest.version,
        }),
        signal: controller?.signal,
      });

      if (!installRes.ok) {
        const errText = await installRes.text();
        logger.warn(`Install failed (${installRes.status}): ${errText}`);
      } else {
        const installResult = await installRes.json() as any;
        installId = installResult.data?.installId || installResult.installId;
        logger.info(`✓ Extension installed (ID: ${installId})`);
      }
    }

    return {
      success: true,
      registryId,
      versionId,
      contentHash,
      installId,
      message: 'Extension published successfully',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || String(error),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Legacy alias for backward compatibility
export interface PublishOptions {
  bundlePath: string;
  registryUrl?: string;
  apiKey?: string;
}

export async function publish(opts: PublishOptions): Promise<{ success: boolean; message?: string }> {
  // Deprecated - use publishExtension instead
  console.warn('publish() is deprecated. Use publishExtension() instead.');
  return { success: false, message: 'Deprecated function' };
}

