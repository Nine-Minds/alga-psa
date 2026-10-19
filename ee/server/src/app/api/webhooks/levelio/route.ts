/**
 * Level.io Webhook Endpoint
 *
 * Two authenticated inputs share this URL (`?tenant=<id>`):
 *
 * 1. Native Settings -> Webhooks (primary). Detected by `X-Level-Signature`.
 *    The HMAC-SHA256 of the RAW body is verified before anything is parsed,
 *    with the per-tenant signing secret or, for setups made before that
 *    existed, the shared webhook secret. Envelope:
 *    `{ event_type, event_id, occurred_at, data }`. `event_id` is constant
 *    across Level's retries and is claimed in `rmm_webhook_events` so a
 *    redelivery is a durable no-op.
 * 2. Automation HTTP Request action (fallback). Shared-secret header
 *    `X-Alga-Webhook-Secret`. Payload values containing an unrendered `{{...}}`
 *    are treated as absent.
 *
 * Level retries any non-2xx three times, so events we do not act on are
 * acknowledged with 2xx. Level times out after 10 seconds; nothing here waits
 * on a long sync.
 */

import { NextResponse } from 'next/server';
import { createTenantKnex, isTenantSuspended, tenantDb } from '@alga-psa/db';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import { processRmmAlertEvent, type NormalizedRmmAlertEvent } from '@alga-psa/shared/rmm/alerts';
import { buildRmmAlertPipelineDeps } from '@alga-psa/integrations/lib/rmm/alerts/pipelineDeps';
import {
  createLevelIoClient,
  LEVELIO_WEBHOOK_SECRET_KEY,
  LEVELIO_WEBHOOK_SIGNING_SECRET_KEY,
} from '../../../../lib/integrations/levelio/levelApiClient';
import { mapLevelIoSeverity } from '../../../../lib/integrations/levelio/mappers/deviceMapper';
import { runLevelIoDeviceSync } from '../../../../lib/integrations/levelio/sync/syncEngine';
import {
  levelIoTransportOverride,
  startLevelIoDeviceSyncWorkflow,
} from '../../../../lib/integrations/levelio/sync/transport';
import { resolveLevelIoWebhookOrganization } from '../../../../lib/integrations/levelio/webhookAlertOrganization';
import {
  automationAlertId,
  cleanAutomationValue,
  LEVELIO_AUTOMATION_DESCRIPTION_PLACEHOLDER,
  LEVELIO_AUTOMATION_NAME_PLACEHOLDER,
  secretsMatch,
  verifyLevelSignature,
} from '../../../../lib/integrations/levelio/webhookPayload';

export const runtime = 'nodejs';

const PROVIDER = 'levelio';
const HEADER_NAME = 'x-alga-webhook-secret';
const SIGNATURE_HEADER = 'x-level-signature';
/** Level's request timeout is 10s; never let the optional refresh use it up. */
const DEVICE_REFRESH_BUDGET_MS = 3000;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}

interface ParsedAlert {
  kind: 'triggered' | 'reset';
  externalAlertId: string;
  deviceId: string;
  explicitGroupId: string | null;
  name: string;
  description: string | null;
  hostname: string | null;
  severity: unknown;
  occurredAt: string;
  conditionIdentity: string;
  raw: Record<string, unknown>;
  webhookEventType: string;
  /** Level's delivery id (native path only) for durable dedupe. */
  eventId: string | null;
}

/** Either a parsed alert, or a rejection (`status`/`error`) or 2xx acknowledgement (`ack`). */
interface Parsed {
  ok: boolean;
  alert?: ParsedAlert;
  status?: number;
  error?: string;
  ack?: { reason: string };
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const tenant = url.searchParams.get('tenant') || '';
    if (!tenant) {
      return NextResponse.json({ error: 'Missing tenant' }, { status: 400 });
    }

    // The raw body is read once, before any JSON parsing: the native signature
    // is over the exact bytes Level sent.
    const rawBody = await req.text();
    const signature = req.headers.get(SIGNATURE_HEADER);
    const customSecret = req.headers.get(HEADER_NAME) || '';
    const native = signature !== null;

    if (!native && !customSecret) {
      return NextResponse.json({ error: 'Unauthorized: missing webhook secret' }, { status: 401 });
    }

    const secretProvider = await getSecretProviderInstance();
    if (native) {
      // Before the dedicated signing secret existed, the settings card showed
      // only the shared webhook secret, and customers pasted that into Level's
      // signing-secret field. Both are this tenant's own secrets, so a signature
      // from either is accepted rather than breaking every existing setup.
      const [signingSecret, legacySecret] = await Promise.all([
        secretProvider.getTenantSecret(tenant, LEVELIO_WEBHOOK_SIGNING_SECRET_KEY),
        secretProvider.getTenantSecret(tenant, LEVELIO_WEBHOOK_SECRET_KEY),
      ]);
      const verified = [signingSecret, legacySecret].some(
        (candidate) => Boolean(candidate) && verifyLevelSignature(rawBody, signature, candidate as string),
      );
      if (!verified) {
        return NextResponse.json({ error: 'Unauthorized: invalid webhook signature' }, { status: 401 });
      }
    } else {
      const expectedSecret = await secretProvider.getTenantSecret(tenant, LEVELIO_WEBHOOK_SECRET_KEY);
      if (!expectedSecret || !secretsMatch(customSecret, expectedSecret)) {
        return NextResponse.json({ error: 'Unauthorized: invalid webhook secret' }, { status: 401 });
      }
    }

    let body: any = null;
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = null;
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = native ? parseNativeEnvelope(body) : parseAutomationPayload(body);
    if (!parsed.ok) {
      if (parsed.ack) {
        console.info('[Level.io webhook] Acknowledged without processing', { tenant, reason: parsed.ack.reason });
        return NextResponse.json({ ok: true, recorded: false, reason: parsed.ack.reason }, { status: 200 });
      }
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const alert = parsed.alert as ParsedAlert;

    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, tenant);

    // Suspended tenants (cancelled, pending deletion) get a 200 ack with no
    // processing so the remote RMM neither retries nor alerts.
    if (await isTenantSuspended(knex, tenant)) {
      console.debug('[LevelIO webhook] Ignoring alert for suspended tenant', {
        tenant,
        event: 'rmm_webhook_tenant_suspended',
      });
      return NextResponse.json({ ok: true, recorded: false, reason: 'tenant_suspended' }, { status: 200 });
    }

    const integration = await db.table('rmm_integrations')
      .where({ provider: PROVIDER })
      .first(['integration_id']);

    if (!integration?.integration_id) {
      // Accept webhook calls even if not fully configured; return 200 to avoid retries.
      return NextResponse.json({ ok: true, recorded: false, reason: 'integration_not_configured' }, { status: 200 });
    }

    // Durable idempotency: claim the event id. A conflict means Level is
    // redelivering an event we already handled (retry, or "Re-run request").
    let claimedEventId: string | null = null;
    if (alert.eventId) {
      const claimed = await db.table('rmm_webhook_events')
        .insert({
          tenant,
          provider: PROVIDER,
          event_id: alert.eventId,
          event_type: alert.webhookEventType,
        })
        .onConflict(['tenant', 'provider', 'event_id'])
        .ignore()
        .returning(['event_id']);
      if (!claimed || claimed.length === 0) {
        return NextResponse.json({ ok: true, recorded: false, reason: 'duplicate_event' }, { status: 200 });
      }
      claimedEventId = alert.eventId;
    }

    try {
      const deviceId = alert.deviceId;

      // Associate to asset when possible via external entity mapping. The same
      // row's external_realm_id holds the device's canonicalized (deepest-mapped)
      // Level group from the sync engine; it is used below to backfill the org
      // when the payload has no group_id.
      const mapping = await db.table('tenant_external_entity_mappings')
        .where({
          integration_type: PROVIDER,
          alga_entity_type: 'asset',
          external_entity_id: deviceId,
        })
        .first(['alga_entity_id', 'external_realm_id']);
      const assetId: string | undefined = mapping?.alga_entity_id;

      // Best-effort observability event.
      try {
        await publishEvent({
          eventType: 'RMM_WEBHOOK_RECEIVED',
          payload: {
            tenantId: tenant,
            occurredAt: new Date().toISOString(),
            integrationId: integration.integration_id,
            provider: PROVIDER,
            webhookEventType: alert.webhookEventType,
            externalDeviceId: deviceId,
            assetId,
            rawPayload: alert.raw,
          },
        });
      } catch {
        // ignore
      }

      // Resolve the event's organization for org-scoped rule matching before the
      // shared pipeline evaluates rules: explicit group_id (canonicalized to the
      // deepest mapped ancestor) -> device mapping external_realm_id (sync-engine
      // canonicalized) -> bounded Level hierarchy lookup -> null (group-scoped
      // rules then simply don't match).
      const externalOrganizationId = await resolveLevelIoWebhookOrganization(
        { knex, deviceMapping: mapping, createClient: () => createLevelIoClient(tenant) },
        {
          tenant,
          integrationId: integration.integration_id,
          deviceId,
          explicitGroupId: alert.explicitGroupId,
        },
      );

      const message = alert.description ? `${alert.name}: ${alert.description}` : alert.name;

      // Alert handling (windows, rules, dedup, ticketing, lifecycle) lives in
      // the shared provider-agnostic pipeline.
      const normalized: NormalizedRmmAlertEvent = {
        tenantId: tenant,
        integrationId: integration.integration_id,
        provider: PROVIDER,
        kind: alert.kind,
        externalAlertId: alert.externalAlertId,
        externalDeviceId: deviceId,
        conditionIdentity: alert.conditionIdentity,
        activityType: 'levelio_webhook',
        alertClass: alert.name,
        sourceType: 'levelio_webhook',
        severity: mapLevelIoSeverity(alert.severity),
        message,
        deviceName: alert.hostname,
        externalOrganizationId,
        occurredAt: alert.occurredAt,
        raw: alert.raw,
      };

      const result = await processRmmAlertEvent({ knex, deps: buildRmmAlertPipelineDeps() }, normalized);

      await refreshDeviceBestEffort(tenant, integration.integration_id, deviceId, knex);

      return NextResponse.json({ ok: true, recorded: true, outcome: result.outcome }, { status: 200 });
    } catch (processingError) {
      // Release the claim so Level's retry of this event is processed.
      if (claimedEventId) {
        await db.table('rmm_webhook_events')
          .where({ provider: PROVIDER, event_id: claimedEventId })
          .del()
          .catch(() => undefined);
      }
      throw processingError;
    }
  } catch (err: any) {
    console.error('[Level.io webhook] Failed to process webhook:', err);
    return NextResponse.json({ error: 'Webhook could not be processed.' }, { status: 500 });
  }
}

/** Native envelope: `{ event_type, event_id, occurred_at, data }`. */
function parseNativeEnvelope(body: any): Parsed {
  const eventType = typeof body.event_type === 'string' ? body.event_type : '';
  if (eventType !== 'alert_active' && eventType !== 'alert_resolved') {
    // device_*, group_* and unknown types: acknowledge so Level does not retry.
    return { ok: false, status: 200, error: '', ack: { reason: 'event_type_ignored' } };
  }

  const data = body.data && typeof body.data === 'object' ? body.data : {};
  const alertId = typeof data.id === 'string' ? data.id.trim() : '';
  const deviceId = typeof data.device_id === 'string' ? data.device_id.trim() : '';
  const eventId = typeof body.event_id === 'string' && body.event_id.trim() ? body.event_id.trim() : null;
  if (!alertId || !deviceId) {
    return { ok: false, status: 200, error: '', ack: { reason: 'invalid_alert_data' } };
  }

  const resolved = eventType === 'alert_resolved';
  const name = cleanString(data.name) ?? 'Level alert';
  const occurredAt = toIsoOrNow(
    (resolved ? data.resolved_at : data.started_at) ?? body.occurred_at,
  );

  return {
    ok: true,
    alert: {
      kind: resolved ? 'reset' : 'triggered',
      externalAlertId: alertId,
      deviceId,
      // Alert data carries no group_id; the org comes from the device mapping.
      explicitGroupId: null,
      name,
      description: cleanString(data.description),
      hostname: cleanString(data.device_hostname),
      severity: data.severity,
      occurredAt,
      conditionIdentity: name,
      // `data.payload` stays inside the stored envelope as raw metadata.
      raw: body as Record<string, unknown>,
      webhookEventType: eventType,
      eventId,
    },
  };
}

/** Automation HTTP Request action payload (see getLevelIoWebhookInfo). */
function parseAutomationPayload(body: any): Parsed {
  const deviceId = cleanAutomationValue(body.device_id);
  if (!deviceId) {
    return {
      ok: false,
      status: 400,
      error:
        'device_id is required. Use the {{level_device_id}} system variable in the automation payload.',
    };
  }

  const event = (cleanAutomationValue(body.event) ?? 'alert.triggered').toLowerCase();
  const description = cleanAutomationValue(body.description);
  let name = cleanAutomationValue(body.name) ?? 'Level alert';
  if (name === LEVELIO_AUTOMATION_NAME_PLACEHOLDER) {
    // Unedited template: every such automation on a device would share one
    // identity. Keep the alert (dropping it would lose a real signal) but derive
    // the name from the customer's description when they edited that, else a
    // generic name, and warn so the misconfiguration is visible.
    name =
      description && description !== LEVELIO_AUTOMATION_DESCRIPTION_PLACEHOLDER ? description : 'Level alert';
    console.warn(
      `[Level webhook] Automation payload still has the template alert name; using "${name}". Edit "name" so distinct automations stay distinct alerts.`,
    );
  }
  const suppliedAlertId = cleanAutomationValue(body.alert_id);
  const policyId = cleanAutomationValue(body.policy_id);

  return {
    ok: true,
    alert: {
      kind: event.includes('resolve') ? 'reset' : 'triggered',
      externalAlertId: suppliedAlertId ?? automationAlertId(deviceId, name),
      deviceId,
      explicitGroupId: cleanAutomationValue(body.group_id),
      name,
      description,
      hostname: cleanAutomationValue(body.hostname),
      severity: cleanAutomationValue(body.severity),
      occurredAt: parseOccurredAt(cleanAutomationValue(body.alert_time) ?? ''),
      conditionIdentity: policyId ?? name,
      raw: body as Record<string, unknown>,
      webhookEventType: event,
      eventId: null,
    },
  };
}

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function toIsoOrNow(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

/**
 * Refresh the affected device without blocking the response: Temporal starts a
 * fire-and-forget workflow; the direct transport is capped by a time budget so
 * Level's 10s timeout is never at risk. The alert is already recorded.
 */
async function refreshDeviceBestEffort(
  tenant: string,
  integrationId: string,
  deviceId: string,
  knex: Awaited<ReturnType<typeof createTenantKnex>>['knex'],
): Promise<void> {
  try {
    if (levelIoTransportOverride() === 'temporal') {
      await startLevelIoDeviceSyncWorkflow({ tenantId: tenant, integrationId, deviceId, waitForResult: false });
      return;
    }
    const refresh = (async () => {
      const client = await createLevelIoClient(tenant);
      await runLevelIoDeviceSync({ tenant, integrationId, deviceId }, { knex, client });
    })();
    refresh.catch(() => undefined);
    await Promise.race([
      refresh,
      new Promise<void>((resolve) => setTimeout(resolve, DEVICE_REFRESH_BUDGET_MS).unref?.()),
    ]);
  } catch {
    // ignore — the alert is already recorded.
  }
}

/** alert_time may be ISO or epoch seconds; fall back to now. */
function parseOccurredAt(value: string): string {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 1_000_000_000) {
    const millis = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
    return new Date(millis).toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}
