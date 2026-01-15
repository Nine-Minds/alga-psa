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

async function readResponseTextWithLimit(
  resp: { text: () => Promise<string> },
  maxBytes: number
): Promise<string> {
  const raw = await resp.text();
  if (Number.isFinite(maxBytes) && maxBytes > 0) {
    const bytes = Buffer.byteLength(raw, 'utf8');
    if (bytes > maxBytes) {
      throw new Error(`Runner response too large (${bytes} bytes; max ${maxBytes})`);
    }
  }
  return raw;
}

export async function extensionScheduledInvocationHandler(
  _jobId: string,
  data: ExtensionScheduledInvocationJobData
): Promise<void> {
  const tenantId = safeString(data.tenantId).trim();
  const installId = safeString(data.installId).trim();
  const scheduleId = safeString(data.scheduleId).trim();

  if (!tenantId || !installId || !scheduleId) {
    throw new Error('Missing required job data (tenantId, installId, scheduleId)');
  }

  const db = await getAdminConnection();

  // Default no-overlap behavior: hold a DB connection for the duration of the run
  // using a transaction-scoped advisory lock.
  const lockKey = advisoryLockKey(scheduleId);

  let finalStatus: 'success' | 'error' | null = null;
  let finalError: string | null = null;
  let shouldThrow = false;
  let shouldUpdateLastRun = false;

  await db.transaction(async (trx) => {
    const lockResult = await trx.raw('SELECT pg_try_advisory_xact_lock(?) AS locked', [lockKey]);
    const locked = Boolean(lockResult?.rows?.[0]?.locked);
    if (!locked) {
      logger.info('[extension-scheduled-invocation] overlap prevented; skipping', { tenantId, installId, scheduleId });
      return;
    }

    // Load schedule (must be enabled).
    const scheduleRow = await trx('tenant_extension_schedule')
      .where({ id: scheduleId, tenant_id: tenantId, install_id: installId })
      .first(['id', 'enabled', 'payload_json', 'cron', 'timezone', 'endpoint_id', 'job_id', 'runner_schedule_id']);

    if (!scheduleRow) {
      logger.warn('[extension-scheduled-invocation] schedule not found; skipping', { tenantId, installId, scheduleId });
      return;
    }
    if (!scheduleRow.enabled) {
      logger.info('[extension-scheduled-invocation] schedule disabled; skipping', { tenantId, installId, scheduleId });
      return;
    }

    shouldUpdateLastRun = true;

    let status: 'success' | 'error' = 'success';
    let errorMessage: string | null = null;

    try {
      const endpointId = safeString((scheduleRow as any).endpoint_id);
      const endpoint = await trx('extension_api_endpoint')
        .where({ id: endpointId })
        .first(['id', 'version_id', 'method', 'path']);

      if (!endpoint) {
        status = 'error';
        errorMessage = 'Schedule endpoint not found; disabling schedule';
        // Policy: disable schedule if its endpoint reference is broken.
        try {
          await trx('tenant_extension_schedule')
            .where({ id: scheduleId, tenant_id: tenantId })
            .update({ enabled: false, updated_at: trx.fn.now() });
        } catch {
          // Best-effort; last_run fields update is handled below.
        }
        shouldThrow = true;
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

      const installRow = await trx('tenant_extension_install')
        .where({ id: installId, tenant_id: tenantId })
        .first(['registry_id', 'is_enabled']);
      const registryId = installRow?.registry_id ? safeString(installRow.registry_id) : '';
      if (!registryId) {
        throw new Error('Install registry_id missing');
      }
      if (installRow?.is_enabled === false) {
        // Treat install-disabled as a skip (do not mutate last-run fields).
        shouldUpdateLastRun = false;
        logger.info('[extension-scheduled-invocation] install disabled; skipping', { tenantId, installId, scheduleId });
        return;
      }

      // Validate endpoint belongs to the installed version to avoid invoking mismatched endpoints.
      if (
        installConfig.versionId &&
        endpoint.version_id &&
        installConfig.versionId !== safeString(endpoint.version_id)
      ) {
        throw new Error('Schedule endpoint does not belong to installed version');
      }

      const runnerUrl = process.env.RUNNER_BASE_URL || 'http://localhost:8080';
      const timeoutMs = Number(process.env.EXT_GATEWAY_TIMEOUT_MS || '30000');
      const maxResponseBytes = Number(process.env.EXT_RUNNER_MAX_RESPONSE_BYTES || '262144');
      const requestId = crypto.randomUUID();

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const method = safeString((endpoint as any).method).toUpperCase();
      const endpointPath = safeString((endpoint as any).path);
      const bodyB64 = method === 'GET' ? undefined : toBase64Json((scheduleRow as any).payload_json ?? null);

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
              path: endpointPath,
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

        const raw = await readResponseTextWithLimit(resp as any, maxResponseBytes);
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

      if (status === 'error') {
        throw new Error(errorMessage || 'Scheduled invocation failed');
      }
    } catch (error) {
      status = 'error';
      errorMessage = error instanceof Error ? error.message : safeString(error);
      shouldThrow = true;
    } finally {
      finalStatus = status;
      finalError = errorMessage;

      if (!shouldUpdateLastRun) return;

      // Update schedule last-run fields (best-effort).
      try {
        await trx('tenant_extension_schedule')
          .where({ id: scheduleId, tenant_id: tenantId })
          .update({
            last_run_at: trx.fn.now(),
            last_run_status: status,
            last_error: errorMessage ? errorMessage.slice(0, 4000) : null,
            updated_at: trx.fn.now(),
          });
      } catch (error) {
        logger.warn('[extension-scheduled-invocation] failed to update schedule last_run fields', {
          tenantId,
          scheduleId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });

  if (shouldThrow || finalStatus === 'error') {
    throw new Error(finalError || 'Scheduled invocation failed');
  }
}
