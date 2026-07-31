import { Temporal } from '@js-temporal/polyfill';
import type { Knex } from 'knex';
import { resolveEffectiveTimeZone, tenantDb } from '@alga-psa/db';
import { createNotificationFromTemplateInternal } from '@alga-psa/notifications/actions';
import { getEmailNotificationService } from '@alga-psa/notifications';
import { getOpportunitySettings } from '../models/opportunitySettingsModel';

export interface OpportunityDigestSummary {
  userId: string;
  actionsDue: number;
  stalledDeals: number;
  newSuggestions: number;
  winsLastWeek: number;
}

export async function runOpportunityWeeklyDigest(
  knex: Knex,
  tenant: string,
  now: Temporal.Instant = Temporal.Now.instant(),
): Promise<OpportunityDigestSummary[]> {
  const db = tenantDb(knex, tenant);
  const timezone = await resolveEffectiveTimeZone(knex, tenant);
  const zonedNow = now.toZonedDateTimeISO(timezone);
  const startOfThisWeekDate = zonedNow.toPlainDate().subtract({ days: zonedNow.dayOfWeek - 1 });
  const startOfThisWeek = startOfThisWeekDate.toZonedDateTime({ timeZone: timezone }).toInstant();
  const startOfNextWeek = startOfThisWeekDate.add({ days: 7 })
    .toZonedDateTime({ timeZone: timezone }).toInstant();
  const startOfLastWeek = startOfThisWeekDate.subtract({ days: 7 })
    .toZonedDateTime({ timeZone: timezone }).toInstant();
  const settings = await getOpportunitySettings(knex, tenant);
  const stalledCutoff = now.subtract({ hours: settings.nudge_days * 24 });

  const owners = await db.table('opportunities as o')
    .modify((query) => db.tenantJoin(query, 'users as u', 'o.owner_id', 'u.user_id'))
    .where({ 'o.status': 'open', 'u.user_type': 'internal', 'u.is_inactive': false })
    .whereNotNull('u.email')
    .distinct('o.owner_id as user_id', 'u.email', 'u.first_name');
  if (owners.length === 0) return [];

  const ownerIds = owners.map((owner) => owner.user_id);
  const [actionCounts, stalledCounts, winCounts, suggestionCountRow, emailSubtype] = await Promise.all([
    db.table('opportunities')
      .where({ status: 'open' })
      .whereIn('owner_id', ownerIds)
      .where('next_action_due', '>=', startOfThisWeek.toString())
      .where('next_action_due', '<', startOfNextWeek.toString())
      .groupBy('owner_id')
      .select('owner_id')
      .count({ count: '*' }),
    db.table('opportunities')
      .where({ status: 'open' })
      .whereIn('owner_id', ownerIds)
      .where('last_activity_at', '<=', stalledCutoff.toString())
      .groupBy('owner_id')
      .select('owner_id')
      .count({ count: '*' }),
    db.table('opportunities')
      .where({ status: 'won' })
      .whereIn('owner_id', ownerIds)
      .where('won_at', '>=', startOfLastWeek.toString())
      .where('won_at', '<', startOfThisWeek.toString())
      .groupBy('owner_id')
      .select('owner_id')
      .count({ count: '*' }),
    db.table('opportunity_suggestions')
      .where({ status: 'pending' })
      .where('created_at', '>=', startOfLastWeek.toString())
      .count({ count: '*' })
      .first(),
    db.table('notification_subtypes')
      .where({ name: 'Opportunity Weekly Digest' })
      .select('id')
      .first(),
  ]);

  if (!emailSubtype) throw new Error('Opportunity Weekly Digest email subtype missing');
  const actionByOwner = new Map(actionCounts.map((row) => [row.owner_id, Number(row.count)]));
  const stalledByOwner = new Map(stalledCounts.map((row) => [row.owner_id, Number(row.count)]));
  const winsByOwner = new Map(winCounts.map((row) => [row.owner_id, Number(row.count)]));
  const newSuggestions = Number(suggestionCountRow?.count ?? 0);
  const queuePath = '/msp/opportunities';
  const baseUrl = String(process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? '').replace(/\/$/, '');
  const summaries: OpportunityDigestSummary[] = [];

  for (const owner of owners) {
    const summary: OpportunityDigestSummary = {
      userId: owner.user_id,
      actionsDue: actionByOwner.get(owner.user_id) ?? 0,
      stalledDeals: stalledByOwner.get(owner.user_id) ?? 0,
      newSuggestions,
      winsLastWeek: winsByOwner.get(owner.user_id) ?? 0,
    };
    summaries.push(summary);

    await createNotificationFromTemplateInternal(knex, {
      tenant,
      user_id: owner.user_id,
      template_name: 'opportunity-weekly-digest',
      type: 'info',
      category: 'opportunities',
      link: queuePath,
      data: {
        actionsDue: String(summary.actionsDue),
        stalledDeals: String(summary.stalledDeals),
        newSuggestions: String(summary.newSuggestions),
        winsLastWeek: String(summary.winsLastWeek),
      },
      metadata: { ...summary, week_start: startOfThisWeekDate.toString() },
    });

    await getEmailNotificationService().sendNotification({
      tenant,
      userId: owner.user_id,
      subtypeId: Number(emailSubtype.id),
      emailAddress: owner.email,
      templateName: 'opportunity-weekly-digest',
      data: {
        digest: {
          actionsDue: summary.actionsDue,
          stalledDeals: summary.stalledDeals,
          newSuggestions: summary.newSuggestions,
          winsLastWeek: summary.winsLastWeek,
          url: `${baseUrl}${queuePath}`,
        },
      },
    });
  }

  return summaries;
}
