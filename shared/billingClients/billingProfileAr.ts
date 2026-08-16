import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/**
 * Accounts receivable, per billing profile, with a client-level rollup
 * (slice S10, features F113–F115).
 *
 * Decision D7 in one sentence: a segmented client's AR is not one number, it is
 * one number *per entity that gets billed*, and the client figure is their sum.
 * A collections call about "your overdue balance" that cannot say which site is
 * overdue is not actionable, and asking one franchisee to settle another's
 * arrears is worse than not asking.
 *
 * The rollup is computed from the same rows as the breakdown rather than by a
 * second query, so the parts provably sum to the whole. A client comparing the
 * two and finding a gap would have no way to tell which was wrong.
 *
 * An unsegmented client has exactly one profile, so its breakdown has one row
 * whose figures equal the rollup — which is the number it has always seen.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The four buckets the client command centre already ages into. */
export interface ArAgingBuckets {
  currentCents: number;
  d30Cents: number;
  d60Cents: number;
  d90PlusCents: number;
}

export interface ArAgeableInvoice {
  billing_profile_id: string | null;
  due_date: string | Date | null;
  total_amount: number | string | null;
  credit_applied: number | string | null;
  paid_amount: number | string | null;
}

export interface ProfileArRow {
  billingProfileId: string;
  name: string;
  isDefault: boolean;
  aging: ArAgingBuckets;
  outstandingTotalCents: number;
  unpaidInvoiceCount: number;
  availableCreditCents: number;
}

export interface ClientArSummary {
  /** True only when the client has more than one profile — decision D6. */
  isSegmented: boolean;
  /** Sums of every row below. Identical to the pre-profile figure. */
  aging: ArAgingBuckets;
  outstandingTotalCents: number;
  unpaidInvoiceCount: number;
  availableCreditCents: number;
  rows: ProfileArRow[];
}

const emptyBuckets = (): ArAgingBuckets => ({
  currentCents: 0,
  d30Cents: 0,
  d60Cents: 0,
  d90PlusCents: 0,
});

const toNumber = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

function daysPastDue(dueDate: string | Date | null, nowMs: number): number {
  if (!dueDate) return 0;
  const due = dueDate instanceof Date ? dueDate.getTime() : new Date(dueDate).getTime();
  if (!Number.isFinite(due)) return 0;
  return Math.floor((nowMs - due) / DAY_MS);
}

/** Which bucket an outstanding balance falls in. Undated invoices are current. */
export function agingBucketFor(
  dueDate: string | Date | null,
  nowMs: number,
): keyof ArAgingBuckets {
  const pastDue = daysPastDue(dueDate, nowMs);
  if (!dueDate || pastDue <= 0) return 'currentCents';
  if (pastDue <= 30) return 'd30Cents';
  if (pastDue <= 60) return 'd60Cents';
  return 'd90PlusCents';
}

export function addBuckets(target: ArAgingBuckets, source: ArAgingBuckets): void {
  target.currentCents += source.currentCents;
  target.d30Cents += source.d30Cents;
  target.d60Cents += source.d60Cents;
  target.d90PlusCents += source.d90PlusCents;
}

export interface AgedInvoices {
  byProfile: Map<string, { aging: ArAgingBuckets; outstandingTotalCents: number; unpaidInvoiceCount: number }>;
  /** Invoices predating profiles carry none, and belong to the client alone. */
  unattributed: { aging: ArAgingBuckets; outstandingTotalCents: number; unpaidInvoiceCount: number };
}

/**
 * Age a set of invoices into buckets, split by the profile each one bills
 * (F113). Pure, so the bucket boundaries are testable without a database.
 *
 * Every invoice lands in exactly one bucket of exactly one profile, which is
 * what makes the rollup a sum rather than a second opinion.
 */
export function ageInvoicesByProfile(invoices: ArAgeableInvoice[], nowMs: number): AgedInvoices {
  const byProfile = new Map<string, { aging: ArAgingBuckets; outstandingTotalCents: number; unpaidInvoiceCount: number }>();
  const unattributed = { aging: emptyBuckets(), outstandingTotalCents: 0, unpaidInvoiceCount: 0 };

  for (const invoice of invoices) {
    const outstanding =
      toNumber(invoice.total_amount) - toNumber(invoice.credit_applied) - toNumber(invoice.paid_amount);
    if (outstanding <= 0) continue;

    const profileId = invoice.billing_profile_id;
    let entry = unattributed;
    if (profileId) {
      entry = byProfile.get(profileId) ?? {
        aging: emptyBuckets(),
        outstandingTotalCents: 0,
        unpaidInvoiceCount: 0,
      };
      byProfile.set(profileId, entry);
    }

    entry.aging[agingBucketFor(invoice.due_date, nowMs)] += outstanding;
    entry.outstandingTotalCents += outstanding;
    entry.unpaidInvoiceCount += 1;
  }

  return { byProfile, unattributed };
}

/**
 * Assemble the client's AR summary from aged invoices, per-profile credit, and
 * the client's profile list (F113–F115).
 *
 * Invoices that predate profiles are folded into the default profile's row:
 * they were billed to the client as a whole, which is what the default profile
 * *is*, and leaving them out of every row would make the rows stop summing to
 * the client total.
 */
export function summariseClientAr(input: {
  profiles: Array<{ billing_profile_id: string; name: string; is_default: boolean }>;
  aged: AgedInvoices;
  creditByProfile: Map<string, number>;
  unattributedCreditCents?: number;
}): ClientArSummary {
  const defaultProfileId =
    input.profiles.find((profile) => profile.is_default)?.billing_profile_id ??
    input.profiles[0]?.billing_profile_id ??
    null;

  const rows: ProfileArRow[] = input.profiles.map((profile) => {
    const aged = input.aged.byProfile.get(profile.billing_profile_id);
    const aging = aged ? { ...aged.aging } : emptyBuckets();
    let outstandingTotalCents = aged?.outstandingTotalCents ?? 0;
    let unpaidInvoiceCount = aged?.unpaidInvoiceCount ?? 0;
    let availableCreditCents = input.creditByProfile.get(profile.billing_profile_id) ?? 0;

    if (profile.billing_profile_id === defaultProfileId) {
      addBuckets(aging, input.aged.unattributed.aging);
      outstandingTotalCents += input.aged.unattributed.outstandingTotalCents;
      unpaidInvoiceCount += input.aged.unattributed.unpaidInvoiceCount;
      availableCreditCents += input.unattributedCreditCents ?? 0;
    }

    return {
      billingProfileId: profile.billing_profile_id,
      name: profile.name,
      isDefault: profile.is_default,
      aging,
      outstandingTotalCents,
      unpaidInvoiceCount,
      availableCreditCents,
    };
  });

  const total = emptyBuckets();
  let outstandingTotalCents = 0;
  let unpaidInvoiceCount = 0;
  let availableCreditCents = 0;
  for (const row of rows) {
    addBuckets(total, row.aging);
    outstandingTotalCents += row.outstandingTotalCents;
    unpaidInvoiceCount += row.unpaidInvoiceCount;
    availableCreditCents += row.availableCreditCents;
  }

  return {
    isSegmented: rows.length > 1,
    aging: total,
    outstandingTotalCents,
    unpaidInvoiceCount,
    availableCreditCents,
    rows,
  };
}

export interface ProfileStatementLine {
  kind: 'invoice' | 'payment' | 'credit';
  occurredAt: string;
  reference: string | null;
  description: string | null;
  /** Positive increases what is owed; negative reduces it. */
  amountCents: number;
}

export interface ProfileStatement {
  billingProfileId: string;
  periodStart: string;
  periodEnd: string;
  openingBalanceCents: number;
  closingBalanceCents: number;
  lines: ProfileStatementLine[];
}

/**
 * A statement for one billing profile over one period (F114).
 *
 * Scoped to the profile rather than the client because a statement is a demand
 * addressed to whoever pays it: showing a franchise site the parent's invoices
 * both discloses figures it has no right to and asks it to reconcile money it
 * never owed. The client-level view is the sum of these, not a separate query.
 */
export async function buildProfileStatement(
  knex: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  billingProfileId: string,
  period: { start: string; end: string },
): Promise<ProfileStatement> {
  const db = tenantDb(knex, tenant);

  const invoices = await db
    .table('invoices')
    .where({ client_id: clientId, billing_profile_id: billingProfileId })
    .whereNotNull('finalized_at')
    .select('invoice_id', 'invoice_number', 'invoice_date', 'total_amount', 'finalized_at');

  const payments = await db
    .table('invoice_payments as p')
    .whereIn(
      'p.invoice_id',
      invoices.map((invoice: any) => invoice.invoice_id),
    )
    .select('p.payment_id', 'p.invoice_id', 'p.amount', 'p.payment_date', 'p.reference_number');

  const credits = await db
    .table('credit_allocations')
    .where({ billing_profile_id: billingProfileId })
    .select('allocation_id', 'invoice_id', 'amount', 'created_at');

  const toIso = (value: unknown): string => {
    if (!value) return period.start;
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isFinite(date.getTime()) ? date.toISOString() : period.start;
  };
  const inPeriod = (iso: string) => iso >= period.start && iso < period.end;

  const all: ProfileStatementLine[] = [
    ...invoices.map((invoice: any): ProfileStatementLine => ({
      kind: 'invoice',
      occurredAt: toIso(invoice.invoice_date ?? invoice.finalized_at),
      reference: invoice.invoice_number ?? null,
      description: null,
      amountCents: toNumber(invoice.total_amount),
    })),
    ...payments.map((payment: any): ProfileStatementLine => ({
      kind: 'payment',
      occurredAt: toIso(payment.payment_date),
      reference: payment.reference_number ?? null,
      description: null,
      amountCents: -toNumber(payment.amount),
    })),
    ...credits.map((credit: any): ProfileStatementLine => ({
      kind: 'credit',
      occurredAt: toIso(credit.created_at),
      reference: null,
      description: null,
      amountCents: -toNumber(credit.amount),
    })),
  ].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));

  // Opening balance is everything that happened before the period, so the
  // statement reconciles rather than starting from zero every month.
  const openingBalanceCents = all
    .filter((line) => line.occurredAt < period.start)
    .reduce((sum, line) => sum + line.amountCents, 0);
  const lines = all.filter((line) => inPeriod(line.occurredAt));
  const closingBalanceCents = lines.reduce((sum, line) => sum + line.amountCents, openingBalanceCents);

  return {
    billingProfileId,
    periodStart: period.start,
    periodEnd: period.end,
    openingBalanceCents,
    closingBalanceCents,
    lines,
  };
}
