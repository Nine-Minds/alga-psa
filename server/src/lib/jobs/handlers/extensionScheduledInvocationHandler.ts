import crypto from 'node:crypto';

import logger from '@shared/core/logger';
import { getAdminConnection } from '@shared/db/admin';

import type { BaseJobData } from 'server/src/lib/jobs/interfaces';

export interface ExtensionScheduledInvocationJobData extends BaseJobData {
  installId: string;
  scheduleId: string;
}

type EeInstallConfigModule = {
  getInstallConfigByInstallId: (installId: string) => Promise<{
    tenantId: string;
    extensionSlug?: string | null;
    installId: string;
    versionId: string;
    contentHash: string | null;
    config: Record<string, string>;
    providers: string[];
    secretEnvelope?: unknown;
  } | null>;
};

async function loadEeInstallConfigModule(): Promise<EeInstallConfigModule | null> {
  try {
    const mod = (await import('@ee/lib/extensions/installConfig')) as any;
    if (typeof mod?.getInstallConfigByInstallId !== 'function') return null;
    return mod as EeInstallConfigModule;
  } catch (error) {
    logger.error('[extension-scheduled-invocation] failed to load EE installConfig module', { error });
    return null;
  }
}

function safeString(val: unknown): string {
  return typeof val === 'string' ? val : String(val ?? '');
}

function normalizeSha256(value: string): string {
  const v = value.trim();
  if (!v) return '';
  if (v.startsWith('sha256:')) return v;
  return `sha256:${v}`;
}

function toBase64Json(payload: unknown): string | undefined {
  if (payload === null || payload === undefined) return undefined;
  const json = JSON.stringify(payload);
  if (!json) return undefined;
  return Buffer.from(json, 'utf8').toString('base64');
}

function advisoryLockKey(scheduleId: string): number {
  // Map UUID-ish strings into a stable 31-bit integer space for advisory locks.
  let hash = 0;
  for (let i = 0; i < scheduleId.length; i++) {
    hash = (hash * 31 + scheduleId.charCodeAt(i)) | 0;
  }
  return hash;
}

export async function extensionScheduledInvocationHandler(
  _jobId: string,
  data: ExtensionScheduledInvocationJobData
): Promise<void> {
  const tenantId = safeString(data.tenantId);
  const installId = safeString(data.installId);
  const scheduleId = safeString(data.scheduleId);

  if (!tenantId || !installId || !scheduleId) {
    throw new Error('Missing required job data (tenantId, installId, scheduleId)');
  }

  const db = await getAdminConnection();

  // Default no-overlap behavior: use an advisory lock per schedule.
  const lockKey = advisoryLockKey(scheduleId);
  const lockResult = await db.raw('SELECT pg_try_advisory_lock(?) AS locked', [lockKey]);
  const locked = Boolean(lockResult?.rows?.[0]?.locked);
  if (!locked) {
    logger.info('[extension-scheduled-invocation] overlap prevented; skipping', { tenantId, installId, scheduleId });
    return;
  }

  try {
    // Load schedule + endpoint (must be enabled).
    const scheduleRow = await db('tenant_extension_schedule as s')
      .join('extension_api_endpoint as e', 'e.id', 's.endpoint_id')
      .where({ 's.id': scheduleId, 's.tenant_id': tenantId, 's.install_id': installId })
      .first([
        's.id',
        's.enabled',
        's.payload_json',
        's.cron',
        's.timezone',
        'e.id as endpoint_id',
        'e.version_id as endpoint_version_id',
        'e.method as endpoint_method',
        'e.path as endpoint_path',
      ]);

    if (!scheduleRow) {
      logger.warn('[extension-scheduled-invocation] schedule not found; skipping', { tenantId, installId, scheduleId });
      return;
    }
    if (!scheduleRow.enabled) {
      logger.info('[extension-scheduled-invocation] schedule disabled; skipping', { tenantId, installId, scheduleId });
      return;
    }

    const ee = await loadEeInstallConfigModule();
    if (!ee) {
      throw new Error('EE install config module unavailable');
    }

    const installConfig = await ee.getInstallConfigByInstallId(installId);
    if (!installConfig) {
      throw new Error('Install config not found');
    }
    if (installConfig.tenantId !== tenantId) {
      throw new Error('Tenant mismatch for install');
    }
    if (!installConfig.contentHash) {
      throw new Error('Install content hash missing');
    }

    const installRow = await db('tenant_extension_install')
      .where({ id: installId, tenant_id: tenantId })
      .first(['registry_id', 'is_enabled']);
    const registryId = installRow?.registry_id ? safeString(installRow.registry_id) : '';
    if (!registryId) {
      throw new Error('Install registry_id missing');
    }
    if (installRow?.is_enabled === false) {
      logger.info('[extension-scheduled-invocation] install disabled; skipping', { tenantId, installId, scheduleId });
      return;
    }

    // Validate endpoint belongs to the installed version to avoid invoking mismatched endpoints.
    if (installConfig.versionId && scheduleRow.endpoint_version_id && installConfig.versionId !== scheduleRow.endpoint_version_id) {
      throw new Error('Schedule endpoint does not belong to installed version');
    }

    const runnerUrl = process.env.RUNNER_BASE_URL || 'http://localhost:8080';
    const timeoutMs = Number(process.env.EXT_GATEWAY_TIMEOUT_MS || '5000');
    const requestId = crypto.randomUUID();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const method = safeString(scheduleRow.endpoint_method).toUpperCase();
    const path = safeString(scheduleRow.endpoint_path);
    const bodyB64 = method === 'GET' ? undefined : toBase64Json(scheduleRow.payload_json ?? null);

    let status: 'ok' | 'error' = 'ok';
    let errorMessage: string | null = null;

    try {
      const resp = await fetch(`${runnerUrl}/v1/execute`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-request-id': requestId,
          'x-idempotency-key': requestId,
          'x-alga-tenant': tenantId,
          'x-alga-extension': registryId,
        },
        body: JSON.stringify({
          context: {
            request_id: requestId,
            tenant_id: tenantId,
            extension_id: registryId,
            install_id: installId,
            version_id: installConfig.versionId,
            content_hash: normalizeSha256(safeString(installConfig.contentHash)),
            config: installConfig.config ?? {},
            trigger: 'schedule',
            schedule_id: scheduleId,
          },
          http: {
            method,
            path,
            query: {},
            headers: { 'x-alga-tenant': tenantId, 'x-alga-extension': registryId },
            body_b64: bodyB64,
          },
          limits: { timeout_ms: timeoutMs },
          ...(installConfig.providers?.length ? { providers: installConfig.providers } : {}),
          ...(installConfig.secretEnvelope ? { secret_envelope: installConfig.secretEnvelope } : {}),
        }),
        signal: controller.signal,
      });

      const raw = await resp.text();
      if (!raw) {
        status = 'error';
        errorMessage = `Runner returned empty body (http ${resp.status})`;
      } else {
        try {
          const payload = JSON.parse(raw);
          const outStatus = Number(payload?.status ?? resp.status);
          if (outStatus >= 400) {
            status = 'error';
            errorMessage = `Runner returned status ${outStatus}`;
          }
        } catch {
          status = 'error';
          errorMessage = `Runner returned non-JSON response (http ${resp.status})`;
        }
      }
    } catch (error) {
      status = 'error';
      errorMessage = error instanceof Error ? error.message : safeString(error);
    } finally {
      clearTimeout(timeout);
    }

    // Update schedule last-run fields (best-effort).
    try {
      await db('tenant_extension_schedule')
        .where({ id: scheduleId, tenant_id: tenantId })
        .update({
          last_run_at: db.fn.now(),
          last_run_status: status,
          last_error: errorMessage ? errorMessage.slice(0, 4000) : null,
          updated_at: db.fn.now(),
        });
    } catch (error) {
      logger.warn('[extension-scheduled-invocation] failed to update schedule last_run fields', {
        tenantId,
        scheduleId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (status === 'error') {
      throw new Error(errorMessage || 'Scheduled invocation failed');
    }
  } finally {
    try {
      await db.raw('SELECT pg_advisory_unlock(?)', [lockKey]);
    } catch {}
  }
}
