"use server";

import { createTenantKnex } from '@/lib/db';
import type { Knex } from 'knex';
import { computeDomain, enqueueProvisioningWorkflow } from '../extensions/runtime/provision';
import { getS3Client, getBundleBucket } from "../storage/s3-client";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { upsertInstallConfigRecord } from '../extensions/installConfig';
import { isKnownCapability, normalizeCapability } from '../extensions/providers';
import { getJobRunnerInstance, initializeJobRunner } from 'server/src/lib/jobs/initializeJobRunner';
import { withOptionalAuth, hasPermission } from '@alga-psa/auth';
import { ExtensionUpdateBlockedError } from './extRegistryV2Errors';

type ExtensionPermissionAction = 'read' | 'write';

async function assertExtensionPermissionIfUserPresent(action: ExtensionPermissionAction, knex: Knex, user: any) {
  // When invoked from API-key middleware flows, there may not be a session-backed "current user".
  // Those routes enforce permissions separately; skip this check in that case.
  if (!user) return;

  if (user.user_type === 'client') throw new Error('Insufficient permissions');
  const allowed = await hasPermission(user, 'extension', action, knex);
  if (!allowed) throw new Error('Insufficient permissions');
}

type V2ExtensionListItem = {
  id: string; // registry_id
  name: string;
  version: string;
  author?: string;
  is_enabled: boolean;
  tenant_id: string;
  description?: string | null;
};

type BundleInfo = {
  content_hash: string;
  canonical_key: string; // sha256/<hex>/bundle.tar.zst
};

export const fetchInstalledExtensionsV2 = withOptionalAuth(async (user, ctx): Promise<V2ExtensionListItem[]> => {
  const { knex } = await createTenantKnex();
  const tenant = ctx?.tenant;
  if (!tenant) throw new Error('Tenant not found');
  await assertExtensionPermissionIfUserPresent('read', knex, user);

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
})

export const toggleExtensionV2 = withOptionalAuth(async (user, ctx, registryId: string): Promise<{ success: boolean; message: string; is_enabled?: boolean }> => {
  const { knex } = await createTenantKnex();
  const tenant = ctx?.tenant;
  if (!tenant) throw new Error('Tenant not found');
  await assertExtensionPermissionIfUserPresent('write', knex, user);

  return await knex.transaction(async (trx: Knex.Transaction) => {
    const row = await trx('tenant_extension_install')
      .where({ tenant_id: tenant, registry_id: registryId })
      .first(['id', 'is_enabled']);
    if (!row) return { success: false, message: 'Install not found' };
    const next = !row.is_enabled;
    const installId = (row as any).id as string;
    await trx('tenant_extension_install')
      .where({ tenant_id: tenant, registry_id: registryId })
      .update({ is_enabled: next, updated_at: trx.fn.now() });

    // No cascades: pause/resume schedules via business logic.
    // - When disabling: cancel and clear runner schedule handles for all enabled schedules.
    // - When enabling: recreate runner schedules for schedules marked enabled but missing job_id.
    try {
      const runner = getJobRunnerInstance() ?? (await initializeJobRunner());
      if (!next) {
        const schedules = await trx('tenant_extension_schedule')
          .where({ tenant_id: tenant, install_id: installId })
          .select(['id', 'job_id', 'enabled']);
      for (const s of schedules as any[]) {
        if (s.enabled && s.job_id) {
          try {
            await runner.cancelJob(String(s.job_id), tenant);
          } catch (e) {
              console.warn('toggleExtensionV2: failed to cancel schedule job', {
                scheduleId: s.id,
                jobId: s.job_id,
                error: (e as any)?.message ?? String(e),
              });
            }
        }
      }
      await trx('tenant_extension_schedule')
        .where({ tenant_id: tenant, install_id: installId })
        .update({ job_id: null, runner_schedule_id: null, updated_at: trx.fn.now() });
    } else {
        const schedules = await trx('tenant_extension_schedule')
          .where({ tenant_id: tenant, install_id: installId, enabled: true })
          .andWhere((b) => b.whereNull('job_id'))
          .select(['id', 'cron']);
        for (const s of schedules as any[]) {
          const scheduleId = String(s.id);
          const cron = String(s.cron);
          const timezoneRow = await trx('tenant_extension_schedule').where({ id: scheduleId, tenant_id: tenant }).first(['timezone']);
          const timezone = timezoneRow?.timezone ? String(timezoneRow.timezone) : 'UTC';
          const { jobId, externalId } = await runner.scheduleRecurringJob(
            'extension-scheduled-invocation',
            { tenantId: tenant, installId, scheduleId } as any,
            cron,
            { singletonKey: `extsched:${installId}:${scheduleId}`, metadata: { kind: 'extension_schedule', scheduleId, timezone } }
          );
          await trx('tenant_extension_schedule')
            .where({ id: scheduleId, tenant_id: tenant })
            .update({ job_id: jobId, runner_schedule_id: externalId, updated_at: trx.fn.now() });
        }
      }
    } catch (e) {
      console.warn('toggleExtensionV2: schedule pause/resume failed', { error: (e as any)?.message ?? String(e) });
    }

    return { success: true, message: next ? 'Enabled' : 'Disabled', is_enabled: next };
  });
})

function normalizeMethod(method: string): string {
  return String(method || '').toUpperCase();
}
function normalizePath(path: string): string {
  const raw = String(path || '').trim();
  if (!raw) return '';
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  return withSlash.replace(/\/{2,}/g, '/');
}

async function materializeEndpointsForVersion(trx: Knex.Transaction, versionId: string) {
  const row = await trx('extension_version').where({ id: versionId }).first(['api_endpoints']);
  if (!row) return;
  const raw = (row as any).api_endpoints;
  let endpoints: any[] = [];
  try {
    endpoints = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
  } catch {
    endpoints = [];
  }
  const now = trx.fn.now();
  const rows = endpoints
    .filter((e) => e && typeof e === 'object')
    .map((e) => ({
      version_id: versionId,
      method: normalizeMethod((e as any).method),
      path: normalizePath((e as any).path),
      handler: String((e as any).handler || ''),
      updated_at: now,
    }))
    .filter((r) => r.method && r.path && r.handler);

  // De-dupe by (method,path) within this insert batch to avoid Postgres error:
  // "ON CONFLICT DO UPDATE command cannot affect row a second time".
  // Last entry wins.
  const deduped = new Map<string, any>();
  for (const r of rows) deduped.set(`${r.method} ${r.path}`, r);
  const uniq = Array.from(deduped.values());

  if (uniq.length === 0) return;
  await trx('extension_api_endpoint')
    .insert(uniq)
    .onConflict(['version_id', 'method', 'path'])
    .merge({ handler: trx.raw('excluded.handler'), updated_at: now });
}

export const updateExtensionForCurrentTenantV2 = withOptionalAuth(async (user, ctx, params: { registryId: string; version: string; disableMissingSchedules?: boolean }): Promise<{ success: boolean; message: string }> => {
  const { knex } = await createTenantKnex();
  const tenant = ctx?.tenant;
  if (!tenant) throw new Error('Tenant not found');
  await assertExtensionPermissionIfUserPresent('write', knex, user);

  const registryId = params.registryId;
  const targetVersion = params.version;
  const disableMissingSchedules = Boolean(params.disableMissingSchedules);

  return await knex.transaction(async (trx: Knex.Transaction) => {
    const install = await trx('tenant_extension_install')
      .where({ tenant_id: tenant, registry_id: registryId })
      .first(['id', 'version_id']);
    if (!install) {
      return { success: false, message: 'Install not found' };
    }
    const installId = String((install as any).id);

    const ev = await trx('extension_version')
      .where({ registry_id: registryId, version: targetVersion })
      .first(['id']);
    if (!ev) {
      return { success: false, message: 'Target version not found' };
    }
    const newVersionId = String((ev as any).id);

    // Ensure endpoints are materialized for the new version.
    await materializeEndpointsForVersion(trx, newVersionId);

    // Load current schedules and their endpoint method/path.
    const schedules = await trx('tenant_extension_schedule as s')
      .join('extension_api_endpoint as e', 'e.id', 's.endpoint_id')
      .where({ 's.tenant_id': tenant, 's.install_id': installId })
      .select(['s.id as schedule_id', 's.enabled', 'e.method', 'e.path']);

    // Build map (method,path) -> endpoint_id for new version.
    const newEndpoints = await trx('extension_api_endpoint')
      .where({ version_id: newVersionId })
      .select(['id', 'method', 'path']);
    const map = new Map<string, string>();
    for (const e of newEndpoints as any[]) {
      map.set(`${normalizeMethod(e.method)} ${normalizePath(e.path)}`, String(e.id));
    }

    const missing: Array<{ scheduleId: string; method: string; path: string }> = [];
    const updates: Array<{ scheduleId: string; endpointId: string }> = [];
    for (const s of schedules as any[]) {
      const method = normalizeMethod(s.method);
      const path = normalizePath(s.path);
      const key = `${method} ${path}`;
      const nextEndpointId = map.get(key);
      if (!nextEndpointId) {
        missing.push({ scheduleId: String(s.schedule_id), method, path });
      } else {
        updates.push({ scheduleId: String(s.schedule_id), endpointId: nextEndpointId });
      }
    }

    if (missing.length > 0 && !disableMissingSchedules) {
      throw new ExtensionUpdateBlockedError(missing);
    }

	    // Remap schedules we can.
	    for (const u of updates) {
	      await trx('tenant_extension_schedule')
	        .where({ id: u.scheduleId, tenant_id: tenant, install_id: installId })
	        .update({ endpoint_id: u.endpointId, updated_at: trx.fn.now() });
	    }

	    // Optionally disable those that cannot be remapped.
	    if (missing.length > 0 && disableMissingSchedules) {
	      const runner = getJobRunnerInstance() ?? (await initializeJobRunner());
	      for (const m of missing) {
        const row = await trx('tenant_extension_schedule')
          .where({ id: m.scheduleId, tenant_id: tenant, install_id: installId })
          .first(['job_id']);
        if (row?.job_id) {
          try {
            await runner.cancelJob(String(row.job_id), tenant);
          } catch (e) {
            console.warn('updateExtensionForCurrentTenantV2: failed to cancel schedule job', {
              scheduleId: m.scheduleId,
              jobId: row.job_id,
              error: (e as any)?.message ?? String(e),
            });
          }
        }
	        await trx('tenant_extension_schedule')
	          .where({ id: m.scheduleId, tenant_id: tenant, install_id: installId })
	          .update({ enabled: false, job_id: null, runner_schedule_id: null, updated_at: trx.fn.now(), last_error: 'Disabled due to missing endpoint on extension update' });
	      }
	    }

	    // Ensure enabled schedules have runner jobs. The handler reads schedule row + endpoint at runtime,
	    // so remapping endpoint_id doesn't require recreating the runner schedule, but we still need to
	    // (re)create schedules if the durable runner handle is missing.
	    try {
	      const enabledRows = await trx('tenant_extension_schedule')
	        .where({ tenant_id: tenant, install_id: installId, enabled: true })
	        .andWhere((b) => b.whereNull('job_id').orWhereNull('runner_schedule_id'))
	        .select(['id', 'cron', 'timezone']);

	      if (enabledRows.length > 0) {
	        const runner = getJobRunnerInstance() ?? (await initializeJobRunner());
	        for (const r of enabledRows as any[]) {
	          const scheduleId = String(r.id);
	          const cron = String(r.cron);
	          const tz = r.timezone ? String(r.timezone) : 'UTC';
	          try {
	            const { jobId, externalId } = await runner.scheduleRecurringJob(
	              'extension-scheduled-invocation',
	              { tenantId: tenant, installId, scheduleId } as any,
	              cron,
	              { singletonKey: `extsched:${installId}:${scheduleId}`, metadata: { kind: 'extension_schedule', scheduleId, timezone: tz } }
	            );
	            await trx('tenant_extension_schedule')
	              .where({ id: scheduleId, tenant_id: tenant, install_id: installId })
	              .update({ job_id: jobId, runner_schedule_id: externalId, updated_at: trx.fn.now() });
	          } catch (e) {
	            console.warn('updateExtensionForCurrentTenantV2: failed to recreate runner schedule', {
	              scheduleId,
	              error: (e as any)?.message ?? String(e),
	            });
	          }
	        }
	      }
	    } catch (e) {
	      console.warn('updateExtensionForCurrentTenantV2: failed to ensure runner schedules', { error: (e as any)?.message ?? String(e) });
	    }

    // Update install to new version.
    await trx('tenant_extension_install')
      .where({ id: installId, tenant_id: tenant })
      .update({ version_id: newVersionId, updated_at: trx.fn.now() });

    return { success: true, message: 'Updated' };
  });
})

export const uninstallExtensionV2 = withOptionalAuth(async (user, ctx, registryId: string): Promise<{ success: boolean; message: string }> => {
  const { knex } = await createTenantKnex();
  const tenant = ctx?.tenant;
  if (!tenant) throw new Error('Tenant not found');
  await assertExtensionPermissionIfUserPresent('write', knex, user);

  // Lookup the installed version and current bundle content hash before deleting DB rows
  let bundleKey: string | null = null;
  let installId: string | null = null;
  try {
    const install = await knex('tenant_extension_install')
      .where({ tenant_id: tenant, registry_id: registryId })
      .first(['id', 'version_id']);
    if (install?.version_id) {
      installId = (install as any).id ?? null;
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

  // Cleanup schedules (no cascades; Citus constraints) before deleting install row.
  if (installId) {
    try {
      const runner = getJobRunnerInstance() ?? (await initializeJobRunner());
      const schedules = await knex('tenant_extension_schedule')
        .where({ tenant_id: tenant, install_id: installId })
        .select(['id', 'job_id']);
      for (const s of schedules as any[]) {
        if (s.job_id) {
          try {
            await runner.cancelJob(String(s.job_id), tenant);
          } catch (e) {
            console.warn('uninstallExtensionV2: failed to cancel schedule job', {
              scheduleId: s.id,
              jobId: s.job_id,
              error: (e as any)?.message ?? String(e),
            });
          }
        }
      }
      await knex('tenant_extension_schedule').where({ tenant_id: tenant, install_id: installId }).del();
    } catch (e) {
      console.warn('uninstallExtensionV2: failed to cleanup schedules', { installId, error: (e as any)?.message ?? String(e) });
    }
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
})

export const installExtensionForCurrentTenantV2 = withOptionalAuth(async (user, ctx, params: { registryId: string; version: string }): Promise<{ success: boolean; installId?: string }> => {
  const { knex } = await createTenantKnex();
  const tenant = ctx?.tenant;
  if (!tenant) throw new Error('Tenant not found');
  await assertExtensionPermissionIfUserPresent('write', knex, user);

  // Lookup extension version outside transaction (read-only)
  const ev = await knex('extension_version')
    .where({ registry_id: params.registryId, version: params.version })
    .first(['id', 'capabilities']);
  if (!ev) throw new Error('Version not found');

  let capabilities: string[] = [];
  try {
    if (Array.isArray((ev as any).capabilities)) {
      capabilities = ((ev as any).capabilities as string[]).filter((cap) => typeof cap === 'string');
    } else if (typeof (ev as any).capabilities === 'string') {
      const parsed = JSON.parse((ev as any).capabilities as string);
      if (Array.isArray(parsed)) {
        capabilities = parsed.filter((cap: unknown): cap is string => typeof cap === 'string');
      }
    }
  } catch (err) {
    console.warn('[installExtensionForCurrentTenantV2] failed to parse capabilities', {
      registryId: params.registryId,
      version: params.version,
      error: (err as any)?.message,
    });
  }
  const normalizedCaps = capabilities
    .map((cap) => normalizeCapability(cap))
    .filter((cap) => isKnownCapability(cap));

  const runnerDomain = computeDomain(tenant, params.registryId);

  // Wrap all writes in a transaction to ensure atomicity across pods
  const installId = await knex.transaction(async (trx: Knex.Transaction) => {
    const payload = {
      tenant_id: tenant,
      registry_id: params.registryId,
      version_id: ev.id,
      status: 'enabled',
      granted_caps: JSON.stringify(normalizedCaps),
      config: JSON.stringify({}),
      is_enabled: true,
      runner_domain: runnerDomain,
      runner_status: JSON.stringify({ state: 'provisioning', message: 'Enqueued domain provisioning' }),
      updated_at: trx.fn.now(),
    };

    const upserted = await trx('tenant_extension_install')
      .insert({ id: trx.raw('gen_random_uuid()'), ...payload, created_at: trx.fn.now() })
      .onConflict(['tenant_id', 'registry_id'])
      .merge(payload)
      .returning(['id']);

    const id: string | undefined = Array.isArray(upserted) && upserted.length > 0 ? (upserted[0] as any).id : undefined;

    if (!id) {
      throw new Error('Failed to upsert extension install record');
    }

    // Upsert install config within the same transaction
    await upsertInstallConfigRecord({
      installId: id,
      tenantId: tenant,
      config: {},
      providers: normalizedCaps,
      connection: trx,
    });

    return id;
  });

  // Enqueue provisioning workflow AFTER transaction commits successfully
  // This ensures the install record exists before the workflow tries to read it
  // Workflow ID is deterministic (tenant:extensionId), so Temporal handles deduplication
  const { enqueued, error: enqueueError } = await enqueueProvisioningWorkflow({ tenantId: tenant, extensionId: params.registryId, installId });

  if (!enqueued) {
    console.error('[installExtensionForCurrentTenantV2] failed to enqueue provisioning workflow', {
      installId,
      tenant,
      registryId: params.registryId,
      error: enqueueError,
    });
    // Mark install for reconciliation so a background process can retry
    await knex('tenant_extension_install')
      .where({ id: installId, tenant_id: tenant })
      .update({
        runner_status: JSON.stringify({
          state: 'provisioning_enqueue_failed',
          message: enqueueError ?? 'Failed to enqueue provisioning workflow; pending reconciliation',
          failed_at: new Date().toISOString(),
        }),
        updated_at: knex.fn.now(),
      });
  }

  return { success: true, installId };
})

/**
 * Get the current bundle content hash and storage key (canonical) for the tenant's install of a registry entry.
 */
export const getBundleInfoForInstall = withOptionalAuth(async (user, ctx, registryId: string): Promise<BundleInfo | null> => {
  const { knex } = await createTenantKnex();
  const tenant = ctx?.tenant;
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
})
