/**
 * Datto RMM Webhook Endpoint (monitor alert webhook responses)
 *
 * Auth: tenant query param + shared-secret header `X-Alga-Webhook-Secret`,
 * compared in constant time. Datto's webhook response supports custom request
 * headers, so no secret travels in the URL.
 *
 * The body only needs to identify the alert (`alertUid`, `deviceUid`, optional
 * `event` of trigger|resolve; see webhookTemplate.ts). The authoritative alert
 * is fetched from the Datto API and mapped through the same mapper the poller
 * uses (the payload alone is mapped the same way if that lookup fails).
 * Alerts from sites not mapped to an Alga client, and muted open alerts, are
 * acknowledged and ignored, as they are by the poller. Deliveries are deduped
 * on rmm_webhook_events (alertUid + event) since Datto may redeliver; an
 * ignored delivery releases its claim, so a redelivery after the site is
 * mapped or the alert unmuted is processed rather than treated as a duplicate.
 * The affected device is refreshed after the response is sent.
 */

import { timingSafeEqual } from 'node:crypto';
import { after, NextResponse } from 'next/server';
import { createTenantKnex, isTenantSuspended, tenantDb } from '@alga-psa/db';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import {
  processRmmAlertEvent,
  RECONCILIATION_INGEST_MARKER,
  type NormalizedRmmAlertEvent,
} from '@alga-psa/shared/rmm/alerts';
import { buildRmmAlertPipelineDeps } from '@alga-psa/integrations/lib/rmm/alerts/pipelineDeps';
import { buildDattoClientForTenant } from '../../../../lib/integrations/datto/buildClient';
import { mapDattoAlertToEvent } from '../../../../lib/integrations/datto/alertMapper';
import { isDattoSiteMapped } from '../../../../lib/integrations/datto/alertFetcher';
import { syncDattoSingleDeviceForTenant } from '../../../../lib/integrations/datto/syncSingleDevice';
import {
  DATTO_RMM_PROVIDER,
  DATTO_RMM_SECRET_KEYS,
  DATTO_RMM_WEBHOOK_HEADER,
} from '../../../../lib/integrations/datto/shared';
import type { DattoAlert } from '../../../../lib/integrations/datto/types';

export const runtime = 'nodejs';

const PROVIDER = DATTO_RMM_PROVIDER;

// A webhook handler must answer promptly: one retry and at most ~5s spent
// waiting out a Datto rate limit, then fall back to the webhook payload.
const WEBHOOK_CLIENT_OPTIONS = { maxRetries: 1, maxRetryAfterMs: 5000 } as const;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const tenant = url.searchParams.get('tenant') || '';
    if (!tenant) {
      return NextResponse.json({ error: 'Missing tenant' }, { status: 400 });
    }

    const providedSecret = req.headers.get(DATTO_RMM_WEBHOOK_HEADER) || '';
    if (!providedSecret) {
      return NextResponse.json({ error: 'Unauthorized: missing webhook secret' }, { status: 401 });
    }

    const secretProvider = await getSecretProviderInstance();
    const expectedSecret = await secretProvider.getTenantSecret(tenant, DATTO_RMM_SECRET_KEYS.webhookSecret);
    if (!expectedSecret || !secretsMatch(providedSecret, expectedSecret)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, tenant);

    // Suspended tenants (cancelled, pending deletion) get a 200 ack with no
    // processing so the remote RMM neither retries nor alerts.
    if (await isTenantSuspended(knex, tenant)) {
      console.debug('[DattoRMM webhook] Ignoring alert for suspended tenant', {
        tenant,
        event: 'rmm_webhook_tenant_suspended',
      });
      return NextResponse.json({ ok: true, recorded: false, reason: 'tenant_suspended' }, { status: 200 });
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const alertUid = cleanValue(body.alertUid);
    if (!alertUid) {
      return NextResponse.json({ error: 'alertUid is required' }, { status: 400 });
    }
    const event = (cleanValue(body.event) ?? 'trigger').toLowerCase();
    const isResolveEvent = event.includes('resolve');

    const integration = await db.table('rmm_integrations')
      .where({ provider: PROVIDER })
      .first(['integration_id', 'is_active']);

    if (!integration?.integration_id || integration.is_active === false) {
      // Still accept webhook calls even if not fully configured; return 200 to avoid retries.
      return NextResponse.json({ ok: true, recorded: false, reason: 'integration_not_configured' }, { status: 200 });
    }
    const integrationId = String(integration.integration_id);

    // Durable idempotency: claim (alertUid, event). A conflict means Datto is
    // redelivering a notification we already handled.
    const dedupeId = `${alertUid}:${event}`.slice(0, 255);
    const claimed = await db.table('rmm_webhook_events')
      .insert({ tenant, provider: PROVIDER, event_id: dedupeId, event_type: event })
      .onConflict(['tenant', 'provider', 'event_id'])
      .ignore()
      .returning(['event_id']);
    if (!claimed || claimed.length === 0) {
      return NextResponse.json({ ok: true, recorded: false, duplicate: true, reason: 'duplicate_event' }, { status: 200 });
    }

    try {
      const payloadDeviceUid = cleanValue(body.deviceUid);

      // Cheap gate first: when the payload names its site and it is unmapped,
      // skip the Datto API call entirely (one indexed lookup, not the full map).
      const payloadSiteUid = cleanValue(body.siteUid);
      if (payloadSiteUid && !(await isDattoSiteMapped(knex, tenant, integrationId, payloadSiteUid))) {
        await releaseClaim(db, dedupeId);
        return NextResponse.json({ ok: true, recorded: false, reason: 'site_not_mapped' }, { status: 200 });
      }

      // Authoritative record from Datto; fall back to the payload so a Datto
      // API hiccup never loses the alert.
      let alert: DattoAlert = buildAlertFromPayload(body, alertUid, isResolveEvent);
      try {
        const client = await buildDattoClientForTenant(tenant, WEBHOOK_CLIENT_OPTIONS);
        if (client) {
          const fetched = await client.getAlert(alertUid);
          if (fetched && typeof fetched === 'object') {
            alert = {
              ...fetched,
              alertUid: fetched.alertUid || alertUid,
              alertSourceInfo: {
                ...(alert.alertSourceInfo ?? {}),
                ...stripEmpty((fetched.alertSourceInfo ?? {}) as Record<string, unknown>),
              },
            };
          }
        }
      } catch (fetchError) {
        console.warn('[DattoRMM webhook] Could not fetch alert from Datto; using webhook payload', {
          tenant,
          error: fetchError instanceof Error ? fetchError.message : String(fetchError),
        });
      }

      // Same rule as the poller: alerts from sites that are not mapped to an
      // Alga client are ignored (the merge above prefers the fetched site uid,
      // so re-check only when it differs from the payload site already gated).
      const siteUid = cleanValue(alert.alertSourceInfo?.siteUid);
      if (
        !siteUid ||
        (siteUid !== payloadSiteUid && !(await isDattoSiteMapped(knex, tenant, integrationId, siteUid)))
      ) {
        await releaseClaim(db, dedupeId);
        return NextResponse.json({ ok: true, recorded: false, reason: 'site_not_mapped' }, { status: 200 });
      }

      // Same rule as the poller: muting is how a Datto admin says "stop
      // notifying", so a muted open alert raises nothing. Resolves still
      // process so an already-ingested alert can close.
      if (!isResolveEvent && alert.resolved !== true && alert.muted === true) {
        await releaseClaim(db, dedupeId);
        return NextResponse.json({ ok: true, recorded: false, reason: 'alert_muted' }, { status: 200 });
      }

      const deviceUid = cleanValue(alert.alertSourceInfo?.deviceUid) ?? payloadDeviceUid;

      // Associate to asset when possible via external entity mapping.
      let assetId: string | undefined;
      if (deviceUid) {
        const mapping = await db.table('tenant_external_entity_mappings')
          .where({
            integration_type: PROVIDER,
            alga_entity_type: 'asset',
            external_entity_id: deviceUid,
          })
          .first(['alga_entity_id']);
        assetId = mapping?.alga_entity_id;
      }

      // Best-effort observability event.
      try {
        await publishEvent({
          eventType: 'RMM_WEBHOOK_RECEIVED',
          payload: {
            tenantId: tenant,
            occurredAt: new Date().toISOString(),
            integrationId,
            provider: PROVIDER,
            webhookEventType: event,
            externalDeviceId: deviceUid ?? undefined,
            assetId,
            rawPayload: body,
          },
        });
      } catch {
        // ignore
      }

      const mapped = mapDattoAlertToEvent(alert, tenant, integrationId);
      if (!mapped) {
        await releaseClaim(db, dedupeId);
        return NextResponse.json({ error: 'alertUid is required' }, { status: 400 });
      }

      // Alert handling (windows, rules, dedup, ticketing, lifecycle) lives in
      // the shared provider-agnostic pipeline.
      // Datto's webhook alertUid is the same id the open-alerts poll returns, so
      // stamp the poller's ingest marker: reconciliation only auto-resets rows
      // that carry it, and a webhook-created row would otherwise never close
      // when its alert clears in Datto.
      const normalized: NormalizedRmmAlertEvent = {
        ...mapped,
        kind: isResolveEvent ? 'reset' : mapped.kind,
        externalDeviceId: mapped.externalDeviceId ?? deviceUid,
        raw: { ...mapped.raw, [RECONCILIATION_INGEST_MARKER]: 'reconciliation' },
      };

      const result = await processRmmAlertEvent({ knex, deps: buildRmmAlertPipelineDeps() }, normalized);

      // Best-effort device refresh, after the response is sent: it makes up to
      // two more Datto calls, and under a rate limit those can take long enough
      // to hold Datto's delivery open. Its outcome never changes the response.
      if (deviceUid) {
        after(async () => {
          try {
            await syncDattoSingleDeviceForTenant({ tenant, deviceUid, clientOptions: WEBHOOK_CLIENT_OPTIONS });
          } catch {
            // ignore
          }
        });
      }

      return NextResponse.json({ ok: true, recorded: true, outcome: result.outcome }, { status: 200 });
    } catch (processingError) {
      // Release the claim so Datto's retry of this event is processed.
      await releaseClaim(db, dedupeId);
      throw processingError;
    }
  } catch (err: any) {
    console.error('[DattoRMM webhook] Failed to process webhook:', err);
    return NextResponse.json({ error: 'Webhook could not be processed.' }, { status: 500 });
  }
}

async function releaseClaim(db: ReturnType<typeof tenantDb>, eventId: string): Promise<void> {
  await db.table('rmm_webhook_events')
    .where({ provider: PROVIDER, event_id: eventId })
    .del()
    .catch(() => undefined);
}

/** Constant-time comparison; unequal lengths are rejected without comparing. */
function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Trims a payload value, treating an unrendered Datto `[placeholder]` (what the
 * template leaves behind when a variable is unavailable) as absent.
 */
function cleanValue(value: unknown): string | null {
  if (value == null || typeof value === 'object') return null;
  const text = String(value).trim();
  if (!text || /^\[[A-Za-z0-9_-]+\]$/.test(text)) return null;
  return text;
}

function stripEmpty<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v != null && v !== '')
  ) as Partial<T>;
}

/** Minimal alert built from the webhook body, used when the Datto lookup fails. */
function buildAlertFromPayload(body: Record<string, unknown>, alertUid: string, resolved: boolean): DattoAlert {
  const alertType = cleanValue(body.alertType);
  return {
    alertUid,
    priority: cleanValue(body.priority),
    diagnostics: cleanValue(body.message),
    resolved,
    timestamp: cleanValue(body.timestamp),
    alertContext: alertType ? { '@class': alertType } : null,
    alertSourceInfo: {
      deviceUid: cleanValue(body.deviceUid),
      deviceName: cleanValue(body.hostname),
      siteUid: cleanValue(body.siteUid),
    },
  };
}
