import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { WhyFacts } from './whyComposer';

export interface AssessmentConversionLessonRow {
  status: 'open' | 'won' | 'lost';
  created_at: Date | string;
}

export interface QuoteVelocityLessonRow {
  status: 'won' | 'lost';
  created_at: Date | string;
  first_quote_sent_at: Date | string;
}

type AssessmentConversionFacts = Extract<WhyFacts, { kind: 'lesson_assessment_conversion' }>;
type QuoteVelocityFacts = Extract<WhyFacts, { kind: 'lesson_quote_velocity' }>;

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function calendarMonthsSince(value: Date | string, now: Date): number {
  const then = asDate(value);
  return Math.max(
    0,
    (now.getUTCFullYear() - then.getUTCFullYear()) * 12
      + now.getUTCMonth()
      - then.getUTCMonth(),
  );
}

export function computeAssessmentConversionLesson(
  rows: AssessmentConversionLessonRow[],
  now = new Date(),
): AssessmentConversionFacts | null {
  const closed = rows.filter((row) => row.status === 'won' || row.status === 'lost');
  if (closed.length < 5) return null;
  const won = closed.filter((row) => row.status === 'won').length;
  const latestCreated = rows.reduce((latest, row) => {
    const created = asDate(row.created_at);
    return created > latest ? created : latest;
  }, new Date(0));
  return {
    kind: 'lesson_assessment_conversion',
    wonPerFive: Math.round((won / closed.length) * 5),
    monthsSinceLastProposed: calendarMonthsSince(latestCreated, now),
  };
}

export function computeQuoteVelocityLesson(
  rows: QuoteVelocityLessonRow[],
): QuoteVelocityFacts | null {
  if (rows.length < 10) return null;

  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const early = rows.filter((row) => (
    asDate(row.first_quote_sent_at).getTime() - asDate(row.created_at).getTime()
  ) <= weekMs);
  const later = rows.filter((row) => !early.includes(row));
  if (early.length === 0 || later.length === 0) return null;

  const earlyRate = early.filter((row) => row.status === 'won').length / early.length;
  const laterRate = later.filter((row) => row.status === 'won').length / later.length;
  if (laterRate === 0) return null;

  const ratio = earlyRate / laterRate;
  if (!Number.isFinite(ratio)) return null;
  return {
    kind: 'lesson_quote_velocity',
    weekCloseRatio: Math.round(ratio * 10) / 10,
  };
}

export async function getOpportunityLessonFacts(
  knex: Knex | Knex.Transaction,
  tenant: string,
  now = new Date(),
): Promise<WhyFacts[]> {
  const db = tenantDb(knex, tenant);
  const assessmentQuery = db.table('opportunities as o');
  db.tenantJoin(assessmentQuery, 'opportunity_evidence as e', 'o.opportunity_id', 'e.opportunity_id');
  const quoteQuery = db.table('opportunities as o');
  db.tenantJoin(quoteQuery, 'quotes as q', 'o.opportunity_id', 'q.opportunity_id');

  const [assessmentRows, quoteRows] = await Promise.all([
    assessmentQuery
      .where({ 'e.checkpoint': 'assessment' })
      .whereNull('e.corrected_at')
      .distinct('o.opportunity_id', 'o.status', 'o.created_at') as Promise<AssessmentConversionLessonRow[]>,
    quoteQuery
      .whereIn('o.status', ['won', 'lost'])
      .whereNotNull('q.sent_at')
      .select('o.opportunity_id', 'o.status', 'o.created_at')
      .min({ first_quote_sent_at: 'q.sent_at' })
      .groupBy('o.opportunity_id', 'o.status', 'o.created_at') as Promise<QuoteVelocityLessonRow[]>,
  ]);

  const facts: Array<AssessmentConversionFacts | QuoteVelocityFacts | null> = [
    computeAssessmentConversionLesson(assessmentRows, now),
    computeQuoteVelocityLesson(quoteRows),
  ];
  return facts.filter(
    (item): item is AssessmentConversionFacts | QuoteVelocityFacts => item !== null,
  );
}
