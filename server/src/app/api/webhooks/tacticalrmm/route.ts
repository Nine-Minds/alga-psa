/**
 * Tactical RMM Webhook Endpoint (alert actions)
 *
 * Auth: shared-secret header `X-Alga-Webhook-Secret` + tenant query param.
 */

import { NextResponse } from 'next/server';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { syncTacticalSingleAgentForTenant } from '@alga-psa/integrations/lib/rmm/tacticalrmm/syncSingleAgent';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import { processRmmAlertEvent, type NormalizedRmmAlertEvent } from '@alga-psa/shared/rmm/alerts';
import { buildRmmAlertPipelineDeps } from '@alga-psa/integrations/lib/rmm/alerts/pipelineDeps';

export const runtime = 'nodejs';

const PROVIDER = 'tacticalrmm';
const HEADER_NAME = 'x-alga-webhook-secret';
const WEBHOOK_SECRET_KEY = 'tacticalrmm_webhook_secret';

function mapSeverity(input: unknown): 'critical' | 'major' | 'moderate' | 'minor' | 'none' {
  const raw = String(input || '').toLowerCase();
  if (!raw) return 'none';
  if (raw.includes('crit')) return 'critical';
  if (raw.includes('major') || raw.includes('high')) return 'major';
  if (raw.includes('moder')) return 'moderate';
  if (raw.includes('minor') || raw.includes('low')) return 'minor';
  return 'none';
}

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
    const expectedSecret = await secretProvider.getTenantSecret(tenant, WEBHOOK_SECRET_KEY);
    if (!expectedSecret || providedSecret !== expectedSecret) {
      return NextResponse.json({ error: 'Unauthorized: invalid webhook secret' }, { status: 401 });
    }

    const body = await req.json().catch(() => null) as any;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const agentId = String(body.agent_id || '').trim();
    if (!agentId) {
      return NextResponse.json({ error: 'agent_id is required' }, { status: 400 });
    }

    const externalAlertId =
      body.alert_id
        ? String(body.alert_id)
        : `${agentId}:${String(body.event || 'alert')}:${String(body.alert_time || new Date().toISOString())}`;

    const event = String(body.event || 'trigger').toLowerCase();
    const status = event.includes('resolve') ? 'resolved' : 'active';

    const severity = mapSeverity(body.severity);
    const message = body.message ? String(body.message) : null;
    const triggeredAt = body.alert_time ? String(body.alert_time) : new Date().toISOString();

    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, tenant);
    const integration = await db.table('rmm_integrations')
      .where({ provider: PROVIDER })
      .first(['integration_id']);

    if (!integration?.integration_id) {
      // Still accept webhook calls even if not fully configured; return 200 to avoid retries.
      return NextResponse.json({ ok: true, recorded: false, reason: 'integration_not_configured' }, { status: 200 });
    }

    // Associate to asset when possible via external entity mapping.
    let assetId: string | undefined;
    const mapping = await db.table('tenant_external_entity_mappings')
      .where({
        integration_type: PROVIDER,
        alga_entity_type: 'asset',
        external_entity_id: agentId,
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
          externalDeviceId: agentId,
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
      externalDeviceId: agentId,
      conditionIdentity: body.check_id ? String(body.check_id) : body.alert_type ? String(body.alert_type) : event,
      activityType: 'tacticalrmm_webhook',
      alertClass: body.alert_type ? String(body.alert_type) : null,
      sourceType: 'tacticalrmm_webhook',
      severity,
      message,
      deviceName: body.hostname ? String(body.hostname) : body.agent_hostname ? String(body.agent_hostname) : null,
      externalOrganizationId: body.client_id != null ? String(body.client_id) : null,
      occurredAt: parseOccurredAt(triggeredAt),
      raw: body as Record<string, unknown>,
    };

    const result = await processRmmAlertEvent({ knex, deps: buildRmmAlertPipelineDeps() }, normalized);

    // Best-effort: refresh the affected agent, but don't fail the webhook response.
    try {
      await syncTacticalSingleAgentForTenant({ tenant, agentId });
    } catch {
      // ignore
    }

    return NextResponse.json({ ok: true, recorded: true, outcome: result.outcome }, { status: 200 });
  } catch (err: any) {
    console.error('[TacticalRMM webhook] Failed to process webhook:', err);
    return NextResponse.json({ error: 'Webhook could not be processed.' }, { status: 500 });
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
