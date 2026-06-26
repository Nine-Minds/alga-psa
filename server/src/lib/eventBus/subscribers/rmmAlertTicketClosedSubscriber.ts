/**
 * When a ticket linked to active RMM alerts is closed, reset those alerts in
 * the RMM (per the matched rule's resetAlertOnTicketClose, default true).
 * Outbound failures are logged and stamped on the alert; they never affect
 * the ticket close, which has already committed by the time this runs.
 */

import logger from '@alga-psa/core/logger';
import {
  getRmmAlertOutboundAdapter,
  rmmAlertRuleActionsSchema,
  type RmmAlertOutboundAdapter,
} from '@alga-psa/shared/rmm/alerts';
import { tenantDb } from '@alga-psa/db';
import { getConnection } from '../../db/db';
import { getEventBus } from '../index';

let isRegistered = false;

export async function registerRmmAlertTicketClosedSubscriber(): Promise<void> {
  if (isRegistered) return;
  await getEventBus().subscribe('TICKET_CLOSED', handleTicketClosed, { subscriberId: 'rmmAlertTicketClosed' });
  isRegistered = true;
  logger.info('[RmmAlertTicketClosedSubscriber] Registered');
}

export async function unregisterRmmAlertTicketClosedSubscriber(): Promise<void> {
  if (!isRegistered) return;
  await getEventBus().unsubscribe('TICKET_CLOSED', handleTicketClosed);
  isRegistered = false;
}

export async function handleTicketClosed(event: unknown): Promise<void> {
  const payload =
    typeof event === 'object' && event !== null && 'payload' in event
      ? ((event as { payload?: Record<string, unknown> }).payload ?? {})
      : {};
  const tenantId = typeof payload.tenantId === 'string' ? payload.tenantId : null;
  const ticketId = typeof payload.ticketId === 'string' ? payload.ticketId : null;
  if (!tenantId || !ticketId) return;

  try {
    const knex = await getConnection(tenantId);
    const db = tenantDb(knex, tenantId);

    const alertsQuery = db.table('rmm_alerts as a')
      .andWhere('a.ticket_id', ticketId)
      .whereIn('a.status', ['active', 'acknowledged'])
      .select(
        'a.alert_id',
        'a.external_alert_id',
        'a.integration_id',
        'a.matched_rule_id',
        'i.provider'
      );
    db.tenantJoin(alertsQuery, 'rmm_integrations as i', 'i.integration_id', 'a.integration_id');
    const alerts = await alertsQuery;
    if (alerts.length === 0) return;

    for (const alert of alerts) {
      const shouldReset = await resetEnabledForAlert(knex, tenantId, alert.matched_rule_id);
      if (!shouldReset) continue;

      const adapter = await resolveAdapter(alert.provider);
      if (!adapter) continue;

      const now = new Date().toISOString();
      try {
        await adapter.resetAlert({
          tenantId,
          integrationId: alert.integration_id,
          externalAlertId: alert.external_alert_id,
        });
        await db.table('rmm_alerts')
          .where({ alert_id: alert.alert_id })
          .update({ status: 'resolved', resolved_at: now, updated_at: now });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn('[RmmAlertTicketClosedSubscriber] Outbound alert reset failed', {
          tenantId,
          alertId: alert.alert_id,
          provider: alert.provider,
          error: message,
        });
        await db.table('rmm_alerts')
          .where({ alert_id: alert.alert_id })
          .update({
            metadata: knex.raw('metadata || ?::jsonb', [
              JSON.stringify({ outbound_reset_error: message, outbound_reset_failed_at: now }),
            ]),
            updated_at: now,
          });
      }
    }
  } catch (error) {
    logger.error('[RmmAlertTicketClosedSubscriber] Failed handling TICKET_CLOSED', {
      tenantId,
      ticketId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Manually linked alerts (no rule) default to resetting, same as the rule default. */
async function resetEnabledForAlert(
  knex: Awaited<ReturnType<typeof getConnection>>,
  tenantId: string,
  matchedRuleId: string | null
): Promise<boolean> {
  if (!matchedRuleId) return true;
  const rule = await tenantDb(knex, tenantId).table('rmm_alert_rules')
    .where({ rule_id: matchedRuleId })
    .first('actions');
  if (!rule) return true;
  const parsed = rmmAlertRuleActionsSchema.safeParse(
    typeof rule.actions === 'string' ? JSON.parse(rule.actions) : rule.actions ?? {}
  );
  return parsed.success ? parsed.data.resetAlertOnTicketClose : true;
}

/**
 * CE-safe adapter resolution: explicit registrations win; the NinjaOne
 * adapter loads lazily from the EE tree and is absent in CE builds.
 */
async function resolveAdapter(provider: string): Promise<RmmAlertOutboundAdapter | undefined> {
  const registered = getRmmAlertOutboundAdapter(provider);
  if (registered) return registered;
  if (provider === 'ninjaone') {
    try {
      // Resolves to the real adapter in EE builds and a CE stub exporting
      // undefined otherwise.
      const mod = await import('@enterprise/lib/integrations/ninjaone/alerts/outboundAdapter');
      return mod.ninjaOneAlertOutboundAdapter ?? undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}
