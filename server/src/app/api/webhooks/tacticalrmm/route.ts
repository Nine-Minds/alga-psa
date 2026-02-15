/**
 * Tactical RMM Webhook Endpoint (alert actions)
 *
 * Auth: shared-secret header `X-Alga-Webhook-Secret` + tenant query param.
 */

import { NextResponse } from 'next/server';
import { createTenantKnex } from '@alga-psa/db';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { syncTacticalSingleAgentForTenant } from '@alga-psa/integrations/lib/rmm/tacticalrmm/syncSingleAgent';
import { publishEvent } from '@alga-psa/event-bus/publishers';

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
    const integration = await knex('rmm_integrations')
      .where({ tenant, provider: PROVIDER })
      .first(['integration_id']);

    if (!integration?.integration_id) {
      // Still accept webhook calls even if not fully configured; return 200 to avoid retries.
      return NextResponse.json({ ok: true, recorded: false, reason: 'integration_not_configured' }, { status: 200 });
    }

    // Associate to asset when possible via external entity mapping.
    let assetId: string | undefined;
    const mapping = await knex('tenant_external_entity_mappings')
      .where({
        tenant,
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

    const existing = await knex('rmm_alerts')
      .where({
        tenant,
        integration_id: integration.integration_id,
        external_alert_id: externalAlertId,
      })
      .first(['alert_id']);

    const baseRow = {
      tenant,
      integration_id: integration.integration_id,
      external_alert_id: externalAlertId,
      external_device_id: agentId,
      asset_id: assetId || null,
      severity,
      priority: null,
      activity_type: 'tacticalrmm_webhook',
      status,
      message,
      source_data: JSON.stringify(body),
      triggered_at: triggeredAt,
      resolved_at: status === 'resolved' ? new Date().toISOString() : null,
      updated_at: knex.fn.now(),
    };

    if (existing?.alert_id) {
      await knex('rmm_alerts')
        .where({ tenant, alert_id: existing.alert_id })
        .update(baseRow);
    } else {
      await knex('rmm_alerts')
        .insert({ ...baseRow, created_at: knex.fn.now() });
    }

    // Best-effort: refresh the affected agent, but don't fail the webhook response.
    try {
      await syncTacticalSingleAgentForTenant({ tenant, agentId });
    } catch {
      // ignore
    }

    return NextResponse.json({ ok: true, recorded: true }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Webhook error' }, { status: 500 });
  }
}
