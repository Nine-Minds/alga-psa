import { Temporal } from '@js-temporal/polyfill';
import type { IQueueActionItem, IWorkQueue } from '@alga-psa/types';
import { composeWhy } from './whyComposer';

export interface QueueOpportunityRow {
  opportunity_id: string;
  opportunity_number: string;
  title: string;
  client_name: string;
  stage: IQueueActionItem['stage'];
  mrr_cents: string | number;
  nrr_cents: string | number;
  hardware_cents: string | number;
  currency_code: string;
  next_action: string | null;
  next_action_due: Date | string;
  last_activity_at: Date | string;
}

export interface ProposalFactRow {
  opportunity_id: string;
  quote_number: string | null;
  sent_at: Date | string;
}

export interface VerbalFactRow {
  opportunity_id: string;
  recorded_at: Date | string;
}

const asIso = (value: Date | string): string => value instanceof Date ? value.toISOString() : String(value);

export function plainDate(value: Date | string, timezone: string): Temporal.PlainDate {
  const iso = asIso(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return Temporal.PlainDate.from(iso);
  return Temporal.Instant.from(iso).toZonedDateTimeISO(timezone).toPlainDate();
}

function elapsedCalendarDays(value: Date | string, today: Temporal.PlainDate, timezone: string): number {
  return Math.max(0, plainDate(value, timezone).until(today).days);
}

function actionItem(
  row: QueueOpportunityRow,
  kind: IQueueActionItem['kind'],
  why: IQueueActionItem['why'],
  today: Temporal.PlainDate,
  timezone: string,
): IQueueActionItem {
  return {
    kind,
    opportunity_id: row.opportunity_id,
    opportunity_number: row.opportunity_number,
    title: row.title,
    client_name: row.client_name,
    stage: row.stage,
    mrr_cents: Number(row.mrr_cents),
    nrr_cents: Number(row.nrr_cents),
    hardware_cents: Number(row.hardware_cents),
    currency_code: row.currency_code,
    next_action: row.next_action,
    next_action_due: asIso(row.next_action_due),
    days_overdue: elapsedCalendarDays(row.next_action_due, today, timezone),
    days_since_activity: elapsedCalendarDays(row.last_activity_at, today, timezone),
    why,
    is_screen_primary: false,
  };
}

export function bucketQueueActionItems(input: {
  opportunities: QueueOpportunityRow[];
  proposalFacts?: ProposalFactRow[];
  verbalFacts?: VerbalFactRow[];
  nudgeDays: number;
  timezone: string;
  now: Temporal.Instant;
}): Pick<IWorkQueue, 'do_today' | 'going_quiet'> {
  const zonedNow = input.now.toZonedDateTimeISO(input.timezone);
  const today = zonedNow.toPlainDate();
  const tomorrowStart = today.add({ days: 1 }).toZonedDateTime({ timeZone: input.timezone }).toInstant();
  const proposalByOpportunity = new Map(
    (input.proposalFacts ?? []).map((row) => [row.opportunity_id, row]),
  );
  const verbalByOpportunity = new Map(
    (input.verbalFacts ?? []).map((row) => [row.opportunity_id, row]),
  );
  const dueRows = input.opportunities
    .filter((row) => Temporal.Instant.compare(Temporal.Instant.from(asIso(row.next_action_due)), tomorrowStart) < 0)
    .sort((a, b) => Temporal.Instant.compare(
      Temporal.Instant.from(asIso(a.next_action_due)),
      Temporal.Instant.from(asIso(b.next_action_due)),
    ));
  const dueIds = new Set(dueRows.map((row) => row.opportunity_id));
  const doToday = dueRows.map((row) => {
    const proposal = proposalByOpportunity.get(row.opportunity_id);
    return actionItem(row, 'action_due', composeWhy({
      kind: 'action_due',
      clientName: row.client_name,
      daysOverdue: elapsedCalendarDays(row.next_action_due, today, input.timezone),
      daysSinceProposal: proposal ? elapsedCalendarDays(proposal.sent_at, today, input.timezone) : null,
      quoteNumber: proposal?.quote_number ?? null,
      // The interaction schema does not distinguish inbound from outbound.
      inboundSinceLastTouch: null,
    }), today, input.timezone);
  });
  if (doToday[0]) doToday[0].is_screen_primary = true;

  const quietCutoff = input.now.subtract({ hours: input.nudgeDays * 24 });
  const goingQuiet = input.opportunities
    .filter((row) => !dueIds.has(row.opportunity_id))
    .filter((row) => Temporal.Instant.compare(Temporal.Instant.from(asIso(row.last_activity_at)), quietCutoff) <= 0)
    .sort((a, b) => Temporal.Instant.compare(
      Temporal.Instant.from(asIso(a.last_activity_at)),
      Temporal.Instant.from(asIso(b.last_activity_at)),
    ))
    .map((row) => {
      const verbal = verbalByOpportunity.get(row.opportunity_id);
      return actionItem(row, 'going_quiet', composeWhy({
        kind: 'going_quiet',
        clientName: row.client_name,
        daysSinceActivity: elapsedCalendarDays(row.last_activity_at, today, input.timezone),
        daysSinceVerbal: verbal ? elapsedCalendarDays(verbal.recorded_at, today, input.timezone) : null,
      }), today, input.timezone);
    });

  return { do_today: doToday, going_quiet: goingQuiet };
}
