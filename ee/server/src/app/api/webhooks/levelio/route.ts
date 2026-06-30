/**
 * Level.io Webhook Endpoint (alert automations)
 *
 * Level's API cannot register webhooks; users configure an HTTP POST action in
 * a Level automation pointing at this endpoint.
 * Auth: shared-secret header `X-Alga-Webhook-Secret` + tenant query param.
 */

import { NextResponse } from 'next/server';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import { processRmmAlertEvent, type NormalizedRmmAlertEvent } from '@alga-psa/shared/rmm/alerts';
import { buildRmmAlertPipelineDeps } from '@alga-psa/integrations/lib/rmm/alerts/pipelineDeps';
import {
  createLevelIoClient,
  LEVELIO_WEBHOOK_SECRET_KEY,
} from '../../../../lib/integrations/levelio/levelApiClient';
import { mapLevelIoSeverity } from '../../../../lib/integrations/levelio/mappers/deviceMapper';
import { runLevelIoDeviceSync } from '../../../../lib/integrations/levelio/sync/syncEngine';
import {
  levelIoTransportOverride,
  startLevelIoDeviceSyncWorkflow,
} from '../../../../lib/integrations/levelio/sync/transport';

export const runtime = 'nodejs';

const PROVIDER = 'levelio';
const HEADER_NAME = 'x-alga-webhook-secret';

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

    const providedSecret = req.headers.get(HEADER_NAME) || req.headers.get('X-Alga-Webhook-Secret') || '';
    if (!providedSecret) {
      return NextResponse.json({ error: 'Unauthorized: missing webhook secret' }, { status: 401 });
    }

    const secretProvider = await getSecretProviderInstance();
    const expectedSecret = await secretProvider.getTenantSecret(tenant, LEVELIO_WEBHOOK_SECRET_KEY);
    if (!expectedSecret || providedSecret !== expectedSecret) {
      return NextResponse.json({ error: 'Unauthorized: invalid webhook secret' }, { status: 401 });
    }

    const body = await req.json().catch(() => null) as any;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const deviceId = String(body.device_id || '').trim();
    if (!deviceId) {
      return NextResponse.json({ error: 'device_id is required' }, { status: 400 });
    }

    const event = String(body.event || 'alert.triggered').toLowerCase();
    const status = event.includes('resolve') ? 'resolved' : 'active';
    const externalAlertId = body.alert_id
      ? String(body.alert_id)
      : `${deviceId}:${event}:${new Date().toISOString()}`;

    const severity = mapLevelIoSeverity(body.severity);
    const name = body.name ? String(body.name) : 'Level alert';
    const description = body.description ? String(body.description) : null;
    const message = description ? `${name}: ${description}` : name;

    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, tenant);
    const integration = await db.table('rmm_integrations')
      .where({ provider: PROVIDER })
      .first(['integration_id']);

    if (!integration?.integration_id) {
      // Accept webhook calls even if not fully configured; return 200 to avoid retries.
      return NextResponse.json({ ok: true, recorded: false, reason: 'integration_not_configured' }, { status: 200 });
    }

    // Associate to asset when possible via external entity mapping.
    let assetId: string | undefined;
    const mapping = await db.table('tenant_external_entity_mappings')
      .where({
        integration_type: PROVIDER,
        alga_entity_type: 'asset',
        external_entity_id: deviceId,
      })
      .first(['alga_entity_id']);
    assetId = mapping?.alga_entity_id;

    // Best-effort observability event.
    try {
      await publishEvent({
        eventType: 'RMM_WEBHOOK_RECEIVED',
        payload: {
          tenantId: tenant,
          occurredAt: new Date().toISOString(),
          integrationId: integration.integration_id,
          provider: PROVIDER,
          webhookEventType: event,
          externalDeviceId: deviceId,
          assetId: assetId,
          rawPayload: body,
        },
      } as any);
    } catch {
      // ignore
    }

    // Alert handling (windows, rules, dedup, ticketing, lifecycle) lives in
    // the shared provider-agnostic pipeline.
    const normalized: NormalizedRmmAlertEvent = {
      tenantId: tenant,
      integrationId: integration.integration_id,
      provider: PROVIDER,
      kind: status === 'resolved' ? 'reset' : 'triggered',
      externalAlertId,
      externalDeviceId: deviceId,
      conditionIdentity: body.policy_id ? String(body.policy_id) : name,
      activityType: 'levelio_webhook',
      alertClass: name,
      sourceType: 'levelio_webhook',
      severity,
      message,
      deviceName: body.hostname ? String(body.hostname) : null,
      externalOrganizationId: body.group_id != null ? String(body.group_id) : null,
      occurredAt: parseOccurredAt(body.alert_time ? String(body.alert_time) : ''),
      raw: body as Record<string, unknown>,
    };

    const result = await processRmmAlertEvent({ knex, deps: buildRmmAlertPipelineDeps() }, normalized);

    // Best-effort: refresh the affected device without blocking the response.
    try {
      if (levelIoTransportOverride() === 'temporal') {
        await startLevelIoDeviceSyncWorkflow({
          tenantId: tenant,
          integrationId: integration.integration_id,
          deviceId,
          waitForResult: false,
        });
      } else {
        const client = await createLevelIoClient(tenant);
        await runLevelIoDeviceSync(
          { tenant, integrationId: integration.integration_id, deviceId },
          { knex, client }
        );
      }
    } catch {
      // ignore — the alert is already recorded.
    }

    return NextResponse.json({ ok: true, recorded: true, outcome: result.outcome }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Webhook error' }, { status: 500 });
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
