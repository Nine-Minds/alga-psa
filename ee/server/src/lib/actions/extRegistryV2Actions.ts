"use server";

import { createTenantKnex } from '@/lib/db';
import type { Knex } from 'knex';
import { computeDomain, enqueueProvisioningWorkflow } from '../extensions/runtime/provision';
import { getS3Client, getBundleBucket } from "../storage/s3-client";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";

export type V2ExtensionListItem = {
  id: string; // registry_id
  name: string;
  version: string;
  author?: string;
  is_enabled: boolean;
  tenant_id: string;
  description?: string | null;
};

export type BundleInfo = {
  content_hash: string;
  canonical_key: string; // sha256/<hex>/bundle.tar.zst
};

export async function fetchInstalledExtensionsV2(): Promise<V2ExtensionListItem[]> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) throw new Error('Tenant not found');

  const rows = await knex('tenant_extension_install as ti')
    .join('extension_registry as er', 'er.id', 'ti.registry_id')
    .join('extension_version as ev', 'ev.id', 'ti.version_id')
    .where('ti.tenant_id', tenant)
    .select({
      id: 'er.id',
      name: 'er.name',
      author: 'er.publisher',
      version: 'ev.version',
      is_enabled: 'ti.is_enabled',
      tenant_id: 'ti.tenant_id',
    })
    .orderBy([{ column: 'er.publisher', order: 'asc' }, { column: 'er.name', order: 'asc' }]);

  return rows as V2ExtensionListItem[];
}

export async function toggleExtensionV2(registryId: string): Promise<{ success: boolean; message: string; is_enabled?: boolean }>{
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) throw new Error('Tenant not found');

  return await knex.transaction(async (trx: Knex.Transaction) => {
    const row = await trx('tenant_extension_install')
      .where({ tenant_id: tenant, registry_id: registryId })
      .first(['is_enabled']);
    if (!row) return { success: false, message: 'Install not found' };
    const next = !row.is_enabled;
    await trx('tenant_extension_install')
      .where({ tenant_id: tenant, registry_id: registryId })
      .update({ is_enabled: next, updated_at: trx.fn.now() });
    return { success: true, message: next ? 'Enabled' : 'Disabled', is_enabled: next };
  });
}

export async function uninstallExtensionV2(registryId: string): Promise<{ success: boolean; message: string }>{
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) throw new Error('Tenant not found');

  // Lookup the installed version and current bundle content hash before deleting DB rows
  let bundleKey: string | null = null;
  try {
    const install = await knex('tenant_extension_install')
      .where({ tenant_id: tenant, registry_id: registryId })
      .first(['version_id']);
    if (install?.version_id) {
      const bundle = await knex('extension_bundle')
        .where({ version_id: (install as any).version_id })
        .orderBy('created_at', 'desc')
        .first(['content_hash']);
      if (bundle?.content_hash) {
        const ch: string = (bundle as any).content_hash;
        const hex = ch.startsWith('sha256:') ? ch.substring('sha256:'.length) : ch;
        bundleKey = `tenants/${tenant}/extensions/${registryId}/sha256/${hex}/bundle.tar.zst`;
      }
    }
  } catch (e) {
    // Ignore bundle lookup errors; proceed with uninstall
    console.warn('uninstallExtensionV2: bundle lookup failed', { error: (e as any)?.message });
  }

  // Remove the install row
  await knex('tenant_extension_install').where({ tenant_id: tenant, registry_id: registryId }).del();

  // Best-effort S3 delete of the tenant-local canonical bundle (and manifest) to stop serving.
  if (bundleKey) {
    try {
      const client = getS3Client();
      const Bucket = getBundleBucket();
      const manifestKey = bundleKey.replace(/bundle\.tar\.zst$/, 'manifest.json');
      await client.send(new DeleteObjectCommand({ Bucket, Key: bundleKey } as any));
      await client.send(new DeleteObjectCommand({ Bucket, Key: manifestKey } as any));
      console.info('uninstallExtensionV2: deleted bundle objects', { bundleKey, manifestKey });
    } catch (e) {
      // Non-fatal
      console.warn('uninstallExtensionV2: failed to delete bundle from storage', { bundleKey, error: (e as any)?.message });
    }
  }

  return { success: true, message: 'Uninstalled' };
}

export async function installExtensionForCurrentTenantV2(params: { registryId: string; version: string }): Promise<{ success: boolean }>{
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) throw new Error('Tenant not found');

  // Upsert install row
  const ev = await knex('extension_version')
    .where({ registry_id: params.registryId, version: params.version })
    .first(['id']);
  if (!ev) throw new Error('Version not found');

  const runnerDomain = computeDomain(tenant, params.registryId);
  const payload = {
    tenant_id: tenant,
    registry_id: params.registryId,
    version_id: ev.id,
    status: 'enabled',
    granted_caps: JSON.stringify([]),
    config: JSON.stringify({}),
    is_enabled: true,
    runner_domain: runnerDomain,
    runner_status: JSON.stringify({ state: 'provisioning', message: 'Enqueued domain provisioning' }),
    updated_at: knex.fn.now(),
  };

  const upserted = await knex('tenant_extension_install')
    .insert({ id: knex.raw('gen_random_uuid()'), ...payload, created_at: knex.fn.now() })
    .onConflict(['tenant_id', 'registry_id'])
    .merge(payload)
    .returning(['id']);

  const installId: string | undefined = Array.isArray(upserted) && upserted.length > 0 ? (upserted[0] as any).id : undefined;
  // Best-effort Temporal provisioning kickoff
  await enqueueProvisioningWorkflow({ tenantId: tenant, extensionId: params.registryId, installId }).catch(() => {});

  return { success: true };
}

/**
 * Get the current bundle content hash and storage key (canonical) for the tenant's install of a registry entry.
 */
export async function getBundleInfoForInstall(registryId: string): Promise<BundleInfo | null> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) throw new Error('Tenant not found');

  const ti = await knex('tenant_extension_install')
    .where({ tenant_id: tenant, registry_id: registryId })
    .first(['version_id']);
  if (!ti) return null;

  const bundle = await knex('extension_bundle')
    .where({ version_id: (ti as any).version_id })
    .orderBy([{ column: 'created_at', order: 'desc' }, { column: 'id', order: 'desc' }])
    .first(['content_hash']);
  if (!bundle) return null;

  const ch = (bundle as any).content_hash as string; // expected sha256:<hex>
  const hex = ch.startsWith('sha256:') ? ch.substring('sha256:'.length) : ch;
  const canonical_key = `tenants/${tenant}/extensions/${registryId}/sha256/${hex}/bundle.tar.zst`;
  return { content_hash: ch, canonical_key };
}
