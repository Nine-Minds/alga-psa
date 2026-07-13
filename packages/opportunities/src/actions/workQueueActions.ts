'use server';

import { Temporal } from '@js-temporal/polyfill';
import type { Knex } from 'knex';
import { createTenantKnex, resolveEffectiveTimeZone, tenantDb } from '@alga-psa/db';
import { hasPermission, withAuth } from '@alga-psa/auth';
import type {
  IQueueSuggestionItem,
  IWorkQueue,
  OpportunityGeneratorKey,
} from '@alga-psa/types';
import { composeWhy, type WhyFacts } from '../lib/whyComposer';
import {
  bucketQueueActionItems,
  plainDate,
  type ProposalFactRow,
  type QueueOpportunityRow,
  type VerbalFactRow,
} from '../lib/workQueueBuckets';
import { getOpportunitySettings } from '../models/opportunitySettingsModel';
import { getOpportunityLessonFacts } from '../lib/lessons';

function numericEvidence(evidence: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = evidence[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function stringEvidence(evidence: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = evidence[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function stringArrayEvidence(evidence: Record<string, unknown>, ...keys: string[]): string[] {
  for (const key of keys) {
    const value = evidence[key];
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    }
  }
  return [];
}

function requireEvidence<T>(value: T | null, generator: OpportunityGeneratorKey, field: string): T {
  if (value === null) throw new Error(`Suggestion ${generator} evidence is missing ${field}`);
  return value;
}

function suggestionCopy(
  generator: OpportunityGeneratorKey,
  clientName: string,
  evidence: Record<string, unknown>,
  today: Temporal.PlainDate,
  timezone: string,
): { facts: WhyFacts; how: string } {
  switch (generator) {
    case 'renewal': {
      let daysToRenewal = numericEvidence(evidence, 'daysToRenewal', 'days_to_renewal');
      const renewalDate = stringEvidence(evidence, 'renewalDate', 'renewal_date', 'contract_end_date');
      if (daysToRenewal === null && renewalDate) {
        daysToRenewal = today.until(plainDate(renewalDate, timezone)).days;
      }
      const days = requireEvidence(daysToRenewal, generator, 'daysToRenewal or renewalDate');
      return {
        facts: { kind: 'suggestion_renewal', clientName, daysToRenewal: days },
        how: `Start ${clientName}'s renewal conversation before the deadline.`,
      };
    }
    case 'tm_conversion': {
      const names = stringArrayEvidence(evidence, 'clientNames', 'client_names');
      if (names.length === 0) names.push(clientName);
      const count = numericEvidence(evidence, 'clientCount', 'client_count') ?? names.length;
      return {
        facts: { kind: 'suggestion_tm_conversion', clientCount: count, clientNames: names },
        how: 'Compare trailing T&M spend with a recurring agreement.',
      };
    }
    case 'whitespace': {
      const service = requireEvidence(
        stringEvidence(evidence, 'missingServiceName', 'missing_service_name', 'service_name'),
        generator,
        'missingServiceName',
      );
      return {
        facts: { kind: 'suggestion_whitespace', clientName, missingServiceName: service },
        how: `Show ${clientName} the missing ${service} coverage.`,
      };
    }
    case 'asset_aging': {
      const assetIds = Array.isArray(evidence.asset_ids) ? evidence.asset_ids : [];
      const count = numericEvidence(evidence, 'assetCount', 'asset_count') ?? (assetIds.length || null);
      const years = requireEvidence(
        numericEvidence(evidence, 'oldestYears', 'oldest_years', 'oldest_asset_years'),
        generator,
        'oldestYears',
      );
      const assetCount = requireEvidence(count, generator, 'assetCount');
      return {
        facts: { kind: 'suggestion_asset_aging', clientName, assetCount, oldestYears: years },
        how: `Scope a refresh for ${assetCount} aging asset${assetCount === 1 ? '' : 's'}.`,
      };
    }
  }
}

export async function assembleWorkQueue(
  knex: Knex,
  tenant: string,
  userId: string,
  userFirstName: string,
  now: Temporal.Instant = Temporal.Now.instant(),
): Promise<IWorkQueue> {
  const db = tenantDb(knex, tenant);
  const timezone = await resolveEffectiveTimeZone(knex, tenant);
  const zonedNow = now.toZonedDateTimeISO(timezone);
  const today = zonedNow.toPlainDate();
  const settings = await getOpportunitySettings(knex, tenant);

  const opportunities = await db.table('opportunities as o')
    .modify((query) => db.tenantJoin(query, 'clients as c', 'o.client_id', 'c.client_id'))
    .where({ 'o.status': 'open', 'o.owner_id': userId })
    .whereNotNull('o.next_action_due')
    .select(
      'o.opportunity_id',
      'o.opportunity_number',
      'o.title',
      'c.client_name',
      'o.stage',
      'o.mrr_cents',
      'o.nrr_cents',
      'o.hardware_cents',
      'o.currency_code',
      'o.next_action',
      'o.next_action_due',
      'o.last_activity_at',
    ) as QueueOpportunityRow[];

  const opportunityIds = opportunities.map((row) => row.opportunity_id);
  const proposalFacts: ProposalFactRow[] = opportunityIds.length === 0 ? [] : await db.table('quotes')
    .whereIn('opportunity_id', opportunityIds)
    .whereNotNull('sent_at')
    .distinctOn('opportunity_id')
    .select('opportunity_id', 'quote_number', 'sent_at')
    .orderBy('opportunity_id')
    .orderBy('sent_at', 'asc');
  const verbalFacts: VerbalFactRow[] = opportunityIds.length === 0 ? [] : await db.table('opportunity_evidence')
    .whereIn('opportunity_id', opportunityIds)
    .where({ checkpoint: 'verbal' })
    .whereNull('corrected_at')
    .select('opportunity_id')
    .min({ recorded_at: 'recorded_at' })
    .groupBy('opportunity_id');

  const { do_today: doToday, going_quiet: goingQuiet } = bucketQueueActionItems({
    opportunities,
    proposalFacts,
    verbalFacts,
    nudgeDays: settings.nudge_days,
    timezone,
    now,
  });

  const suggestions = await db.table('opportunity_suggestions as s')
    .modify((query) => db.tenantJoin(query, 'clients as c', 's.client_id', 'c.client_id'))
    .where({ 's.status': 'pending' })
    .select('s.*', 'c.client_name') as Array<Record<string, unknown> & { client_name: string }>;
  const moneyFound: IQueueSuggestionItem[] = suggestions.map((row) => {
    const evidence = typeof row.evidence === 'object' && row.evidence !== null
      ? row.evidence as Record<string, unknown>
      : {};
    const generator = row.generator_key as OpportunityGeneratorKey;
    const copy = suggestionCopy(generator, row.client_name, evidence, today, timezone);
    return {
      kind: 'suggestion',
      suggestion_id: String(row.suggestion_id),
      generator_key: generator,
      title: String(row.title),
      client_name: row.client_name,
      mrr_cents: Number(row.mrr_cents ?? 0),
      nrr_cents: Number(row.nrr_cents ?? 0),
      currency_code: String(row.currency_code),
      how: copy.how,
      why: composeWhy(copy.facts),
    };
  });

  const billingSettings = await db.table('default_billing_settings')
    .select('default_currency_code')
    .first();
  const currencyCode = billingSettings?.default_currency_code
    ?? opportunities[0]?.currency_code
    ?? suggestions[0]?.currency_code
    ?? 'USD';

  const lessonFacts = await getOpportunityLessonFacts(
    knex,
    tenant,
    new Date(now.epochMilliseconds),
  );
  const selectedLesson = lessonFacts.length === 0
    ? null
    : lessonFacts[(today.dayOfYear - 1) % lessonFacts.length];
  const lesson = selectedLesson == null ? null : selectedLesson.kind === 'lesson_assessment_conversion'
    ? {
        insight_key: 'assessment_conversion',
        why: composeWhy(selectedLesson),
        action_label: 'View assessment deals',
        action_href: '/msp/opportunities?tab=pipeline&stage=assessment',
      }
    : {
        insight_key: 'quote_velocity',
        why: composeWhy(selectedLesson),
        action_label: 'Review the pipeline',
        action_href: '/msp/opportunities?tab=pipeline',
      };

  return {
    user_first_name: userFirstName,
    date: now.toString(),
    found_mrr_cents: moneyFound.reduce((sum, item) => sum + item.mrr_cents, 0),
    found_nrr_cents: moneyFound.reduce((sum, item) => sum + item.nrr_cents, 0),
    currency_code: String(currencyCode),
    do_today: doToday,
    going_quiet: goingQuiet,
    money_found: moneyFound,
    lesson,
  };
}

export const getWorkQueue = withAuth(async (user, { tenant }): Promise<IWorkQueue> => {
  if (!await hasPermission(user as any, 'opportunities', 'read')) {
    throw new Error('Permission denied: opportunities read required');
  }
  const userId = (user as any)?.user_id;
  if (!userId) throw new Error('user is not logged in');
  const { knex } = await createTenantKnex();
  return assembleWorkQueue(knex, tenant, userId, String((user as any)?.first_name ?? ''));
});
