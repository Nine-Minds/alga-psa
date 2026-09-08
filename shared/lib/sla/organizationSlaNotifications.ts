import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { OrganizationSlaClock } from './organizationSlaClock';

export interface OrganizationSlaNotificationCandidate {
  thresholdId: string;
  thresholdPercent: number;
  slaType: 'response' | 'resolution';
  notificationType: 'warning' | 'breach';
  dueAt: string | null;
  elapsedMilliseconds: number;
  targetMinutes: number;
  configuration: { notifyAssignee: boolean; notifyBoardManager: boolean; notifyEscalationManager: boolean; channels: string[] };
}

/** Internal retained-obligation helper. Use the policy owner's existing threshold
 * configuration. Completed targets never gain new notices from later observations
 * or configuration changes. The event that completes a target can capture its crossing. */
export async function pendingOrganizationSlaNotifications(trx: Knex.Transaction, policyId: string,
  previous: OrganizationSlaClock, current: OrganizationSlaClock): Promise<OrganizationSlaNotificationCandidate[]> {
  if (!trx.isTransaction) throw new Error('SLA notification capture requires the obligation transaction');
  if (previous.resolution.completedAt || (previous.pauseReasons.length && current.pauseReasons.length)) return [];
  const owner = tenantDb(trx, current.identity.tenant);
  const thresholds = await owner.table('sla_notification_thresholds').where('sla_policy_id', policyId)
    .where('threshold_percent', '>', 0).orderBy('threshold_percent').forShare();
  if (!thresholds.length) return [];
  const captured = await owner.table('sla_organization_notification_events').where('obligation_id', current.identity.obligationId)
    .select('sla_type', 'threshold_percent');
  const seen = new Set(captured.map(row => `${row.sla_type}:${row.threshold_percent}`));
  const pending: OrganizationSlaNotificationCandidate[] = [];
  for (const slaType of ['response', 'resolution'] as const) {
    const target = current[slaType];
    if (previous[slaType].completedAt || previous.resolution.completedAt || target.targetMinutes === null) continue;
    const elapsed = target.completedElapsedMilliseconds ?? current.elapsedMilliseconds;
    for (const threshold of thresholds) {
      const percent = threshold.threshold_percent as number;
      const boundary = target.targetMinutes * 60000 * percent / 100;
      // Completion exactly at the target is met, matching the shared SLA clock.
      if ((percent >= 100 ? elapsed <= boundary : elapsed < boundary) || seen.has(`${slaType}:${percent}`)) continue;
      pending.push({ thresholdId: threshold.threshold_id, thresholdPercent: percent, slaType,
        notificationType: percent >= 100 ? 'breach' : 'warning', dueAt: target.breachedAt ?? target.dueAt ?? previous[slaType].dueAt,
        elapsedMilliseconds: elapsed, targetMinutes: target.targetMinutes,
        configuration: { notifyAssignee: Boolean(threshold.notify_assignee), notifyBoardManager: Boolean(threshold.notify_board_manager),
          notifyEscalationManager: Boolean(threshold.notify_escalation_manager), channels: threshold.channels ?? ['in_app'] } });
    }
  }
  return pending;
}

/** Source clock, threshold crossing, and pending notification commit together.
 * No title, body, recipient, or foreign directory data is a delivery authority. */
export async function captureOrganizationSlaNotifications(trx: Knex.Transaction, policyId: string,
  operationId: string, previous: OrganizationSlaClock, current: OrganizationSlaClock): Promise<void> {
  const pending = await pendingOrganizationSlaNotifications(trx, policyId, previous, current);
  if (!pending.length) return;
  await tenantDb(trx, current.identity.tenant).table('sla_organization_notification_events').insert(pending.map(item => ({
    tenant: current.identity.tenant, notification_event_id: randomUUID(), obligation_id: current.identity.obligationId,
    source_operation_id: operationId, threshold_id: item.thresholdId, threshold_percent: item.thresholdPercent,
    sla_type: item.slaType, notification_type: item.notificationType, configuration: JSON.stringify(item.configuration),
    due_at: item.dueAt, elapsed_milliseconds: item.elapsedMilliseconds, target_minutes: item.targetMinutes, occurred_at: current.observedAt,
  }))).onConflict(['tenant', 'obligation_id', 'sla_type', 'threshold_percent']).ignore();
}
