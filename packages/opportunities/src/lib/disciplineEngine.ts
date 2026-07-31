import { Temporal } from '@js-temporal/polyfill';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  buildOpportunityEscalatedPayload,
  buildOpportunityNextActionOverduePayload,
  buildOpportunityStalledPayload,
} from './opportunityEventBuilders';
import { publishOpportunityEventAfterCommit } from './opportunityEvents';
import { getOpportunitySettings } from '../models/opportunitySettingsModel';

interface DisciplineOpportunityRow {
  opportunity_id: string;
  opportunity_number: string;
  client_id: string;
  client_name: string;
  title: string;
  owner_id: string;
  owner_first_name: string | null;
  owner_last_name: string | null;
  reports_to: string | null;
  next_action: string;
  next_action_due: Date | string;
  last_activity_at: Date | string;
  last_nudged_at: Date | string | null;
  last_escalated_at: Date | string | null;
  overdue_notified_at: Date | string | null;
}

export interface OpportunityDisciplineResult {
  nudged: number;
  escalated: number;
  overdue: number;
  calendarEntries: number;
  managerNotifications: number;
}

export interface OpportunityDisciplineDecision {
  nudge: boolean;
  escalate: boolean;
  overdue: boolean;
  escalationMode: 'solo' | 'team';
}

const asInstant = (value: Date | string): Temporal.Instant => Temporal.Instant.from(
  value instanceof Date ? value.toISOString() : String(value),
);

const isNewActivityEpisode = (marker: Date | string | null, activity: Date | string): boolean =>
  marker === null || Temporal.Instant.compare(asInstant(marker), asInstant(activity)) < 0;

const isNewOverdueEpisode = (marker: Date | string | null, due: Date | string): boolean =>
  marker === null || Temporal.Instant.compare(asInstant(marker), asInstant(due)) < 0;

export function classifyOpportunityDiscipline(input: {
  lastActivityAt: Date | string;
  nextActionDue: Date | string;
  lastNudgedAt: Date | string | null;
  lastEscalatedAt: Date | string | null;
  overdueNotifiedAt: Date | string | null;
  nudgeDays: number;
  interruptDays: number;
  escalationMode: 'solo' | 'team';
  now: Temporal.Instant;
}): OpportunityDisciplineDecision {
  const activity = asInstant(input.lastActivityAt);
  const due = asInstant(input.nextActionDue);
  return {
    nudge: Temporal.Instant.compare(
      activity,
      input.now.subtract({ hours: input.nudgeDays * 24 }),
    ) <= 0 && isNewActivityEpisode(input.lastNudgedAt, input.lastActivityAt),
    escalate: Temporal.Instant.compare(
      activity,
      input.now.subtract({ hours: input.interruptDays * 24 }),
    ) <= 0 && isNewActivityEpisode(input.lastEscalatedAt, input.lastActivityAt),
    overdue: Temporal.Instant.compare(due, input.now) < 0
      && isNewOverdueEpisode(input.overdueNotifiedAt, input.nextActionDue),
    escalationMode: input.escalationMode,
  };
}

async function tenantAdminIds(trx: Knex.Transaction, tenant: string): Promise<string[]> {
  const db = tenantDb(trx, tenant);
  const query = db.table('users as u');
  db.tenantJoin(query, 'user_roles as ur', 'u.user_id', 'ur.user_id');
  db.tenantJoin(query, 'roles as r', 'ur.role_id', 'r.role_id');
  return query
    .where({ 'u.user_type': 'internal', 'u.is_inactive': false })
    .whereRaw('LOWER(r.role_name) IN (?, ?)', ['admin', 'owner'])
    .distinct('u.user_id')
    .pluck('u.user_id');
}

export async function runOpportunityDiscipline(
  knex: Knex,
  tenant: string,
  now: Temporal.Instant = Temporal.Now.instant(),
): Promise<OpportunityDisciplineResult> {
  const settings = await getOpportunitySettings(knex, tenant);
  const result: OpportunityDisciplineResult = {
    nudged: 0,
    escalated: 0,
    overdue: 0,
    calendarEntries: 0,
    managerNotifications: 0,
  };

  await knex.transaction(async (trx) => {
    await trx.raw('select set_config(?, ?, true)', ['app.current_tenant', tenant]);
    await trx.raw('select set_config(?, ?, true)', ['app.current_user', 'system']);
    const db = tenantDb(trx, tenant);
    const query = db.table('opportunities as o');
    db.tenantJoin(query, 'clients as c', 'o.client_id', 'c.client_id');
    db.tenantJoin(query, 'users as u', 'o.owner_id', 'u.user_id');
    const opportunities = await query
      .where({ 'o.status': 'open' })
      .whereNotNull('o.next_action')
      .whereNotNull('o.next_action_due')
      .select(
        'o.opportunity_id',
        'o.opportunity_number',
        'o.client_id',
        'c.client_name',
        'o.title',
        'o.owner_id',
        'u.first_name as owner_first_name',
        'u.last_name as owner_last_name',
        'u.reports_to',
        'o.next_action',
        'o.next_action_due',
        'o.last_activity_at',
        'o.last_nudged_at',
        'o.last_escalated_at',
        'o.overdue_notified_at',
      )
      .forUpdate('o') as DisciplineOpportunityRow[];

    let adminIds: string[] | null = null;
    for (const opportunity of opportunities) {
      const activityInstant = asInstant(opportunity.last_activity_at);
      const dueInstant = asInstant(opportunity.next_action_due);
      const daysSinceActivity = Math.max(0, Math.floor(now.since(activityInstant).total('hours') / 24));
      const markerPatch: Record<string, string> = {};
      const decision = classifyOpportunityDiscipline({
        lastActivityAt: opportunity.last_activity_at,
        nextActionDue: opportunity.next_action_due,
        lastNudgedAt: opportunity.last_nudged_at,
        lastEscalatedAt: opportunity.last_escalated_at,
        overdueNotifiedAt: opportunity.overdue_notified_at,
        nudgeDays: settings.nudge_days,
        interruptDays: settings.interrupt_days,
        escalationMode: settings.escalation_mode,
        now,
      });

      if (decision.nudge) {
        publishOpportunityEventAfterCommit(
          trx,
          tenant,
          'OPPORTUNITY_STALLED',
          buildOpportunityStalledPayload({
            opportunityId: opportunity.opportunity_id,
            clientId: opportunity.client_id,
            ownerId: opportunity.owner_id,
            daysSinceActivity,
            stalledAt: now.toString(),
          }),
          `opportunity_stalled:${opportunity.opportunity_id}:${activityInstant.toString()}`,
        );
        markerPatch.last_nudged_at = now.toString();
        result.nudged += 1;
      }

      if (decision.escalate) {
        let escalatedToUserId: string | undefined = opportunity.owner_id;
        if (decision.escalationMode === 'solo') {
          // The published system workflow owns the customizable side effect.
        } else {
          const recipients = opportunity.reports_to
            ? [opportunity.reports_to]
            : (adminIds ??= await tenantAdminIds(trx, tenant));
          escalatedToUserId = recipients.find((id) => id !== opportunity.owner_id) ?? opportunity.owner_id;
        }
        publishOpportunityEventAfterCommit(
          trx,
          tenant,
          'OPPORTUNITY_ESCALATED',
          buildOpportunityEscalatedPayload({
            opportunityId: opportunity.opportunity_id,
            clientId: opportunity.client_id,
            ownerId: opportunity.owner_id,
            escalatedToUserId,
            escalatedAt: now.toString(),
          }),
          `opportunity_escalated:${opportunity.opportunity_id}:${activityInstant.toString()}`,
        );
        markerPatch.last_escalated_at = now.toString();
        result.escalated += 1;
      }

      if (decision.overdue) {
        publishOpportunityEventAfterCommit(
          trx,
          tenant,
          'OPPORTUNITY_NEXT_ACTION_OVERDUE',
          buildOpportunityNextActionOverduePayload({
            opportunityId: opportunity.opportunity_id,
            clientId: opportunity.client_id,
            ownerId: opportunity.owner_id,
            nextAction: opportunity.next_action,
            dueAt: dueInstant.toString(),
            overdueAt: now.toString(),
          }),
          `opportunity_next_action_overdue:${opportunity.opportunity_id}:${dueInstant.toString()}`,
        );
        markerPatch.overdue_notified_at = now.toString();
        result.overdue += 1;
      }

      if (Object.keys(markerPatch).length > 0) {
        await db.table('opportunities')
          .where({ opportunity_id: opportunity.opportunity_id })
          .update({ ...markerPatch, updated_at: now.toString() });
      }
    }
  });

  return result;
}
