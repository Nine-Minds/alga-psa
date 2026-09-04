import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

export interface ContractMonthlyValue {
  clientContractId: string;
  /**
   * Fixed recurring value only, in minor currency units, normalized to a
   * monthly cadence. Usage lines bill recorded usage and contribute variable
   * revenue that cannot be stated as a fixed monthly amount, so they are
   * excluded here and flagged via
   * {@link ContractMonthlyValue.hasVariableUsage} instead of silently
   * reporting zero.
   */
  monthlyValueCents: number;
  currencyCode: string;
  /** True when the contract has usage-billed lines with variable, record-driven revenue. */
  hasVariableUsage: boolean;
}

export interface CurrencyAmount {
  currencyCode: string;
  totalCents: number;
}

/**
 * Cadence normalization used by every recurring-value read path. Mirrors the
 * contract-overview normalization so overview, reports, and summaries cannot
 * disagree about what a non-monthly line is worth per month.
 */
export function normalizeToMonthlyCents(amountCents: number, billingFrequency: string | null | undefined): number {
  switch (billingFrequency) {
    case 'weekly':
      return Math.round(amountCents * 4.33);
    case 'quarterly':
      return Math.round(amountCents / 3);
    case 'semi-annually':
    case 'semi_annually':
      return Math.round(amountCents / 6);
    case 'annually':
      return Math.round(amountCents / 12);
    default:
      // monthly (and unknown cadences, which are stored monthly by default)
      return Math.round(amountCents);
  }
}

/**
 * Currency-safe aggregation: minor units are summed per currency and never
 * across currencies — a CAD cent plus a USD cent is not a number in any
 * currency, so no single cross-currency grand total exists here by design.
 */
export function aggregateCentsByCurrency(
  items: Iterable<{ currencyCode: string; amountCents: number }>,
): CurrencyAmount[] {
  const totals = new Map<string, number>();
  for (const item of items) {
    totals.set(item.currencyCode, (totals.get(item.currencyCode) ?? 0) + item.amountCents);
  }
  return Array.from(totals.entries())
    .map(([currencyCode, totalCents]) => ({ currencyCode, totalCents }))
    .sort((a, b) => a.currencyCode.localeCompare(b.currencyCode));
}

interface FixedMemberValuationRow {
  contract_line_id: string;
  service_id: string;
  config_id: string;
  quantity: number | string | null;
  custom_rate: number | string | null;
  base_rate: number | string | null;
  pricing_basis: string | null;
}

// LEVERAGE: pattern unit-priced-fixed-line — twin of
// computeFixedCharges.isUnitPricedFixedLine; the predicate should live in one
// shared layer both the engine and this valuation import.
/**
 * A Fixed line is unit-priced when every fixed-config member is either
 * explicitly 'unit' or unset, and at least one member is explicitly 'unit'.
 * Pure legacy lines (all unset) stay bundle. Must match the billing engine's
 * predicate exactly or valuation and invoicing drift apart.
 */
function isUnitPricedMemberSet(members: Array<{ pricing_basis: string | null }>): boolean {
  return (
    members.length > 0 &&
    members.every((m) => m.pricing_basis === null || m.pricing_basis === undefined || m.pricing_basis === 'unit') &&
    members.some((m) => m.pricing_basis === 'unit')
  );
}

const toCents = (value: number | string | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'string' ? parseFloat(value) : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export interface ContractFixedMonthlyValue {
  contractId: string;
  /** Fixed recurring value in minor units, cadence-normalized to monthly. */
  monthlyValueCents: number;
  /** True when the contract has usage-billed lines with variable, record-driven revenue. */
  hasVariableUsage: boolean;
}

/**
 * Canonical per-contract fixed monthly valuation shared by the contract
 * overview, contract reports, the report summary, and renewal/expiration
 * reporting.
 *
 * Semantics (plan: contract-quantity-and-usage-semantics R7):
 *  - Explicitly unit-priced Fixed lines ("recurring seats/units") are valued as
 *    Σ quantity × unit rate over their members, honoring the latest
 *    contract_line_unit_pricing_revisions row effective at/before `asOfDate`.
 *    Future-dated revisions are scheduled values and are excluded; superseded
 *    revisions (an earlier effective date) are ignored. Zero quantity is zero.
 *  - Every other non-Usage line keeps its existing line-level custom_rate
 *    valuation (minor units) — fixed bundles stay bundle-priced.
 *  - Usage lines are record-driven variable revenue: excluded from the fixed
 *    amount and surfaced through hasVariableUsage, never encoded as zero.
 *  - Each line is normalized to a monthly cadence via its billing_frequency.
 */
export async function getContractMonthlyFixedValuesByContract(
  conn: Knex | Knex.Transaction,
  tenant: string,
  contractIds: string[],
  asOfDate?: string,
): Promise<Map<string, ContractFixedMonthlyValue>> {
  if (contractIds.length === 0) return new Map();

  const asOf = asOfDate ?? new Date().toISOString().slice(0, 10);
  const db = tenantDb(conn, tenant);

  const lines = (await db.table('contract_lines as cln')
    .whereIn('cln.contract_id', contractIds)
    .select(
      'cln.contract_line_id',
      'cln.contract_id',
      'cln.contract_line_type',
      'cln.billing_frequency',
      'cln.custom_rate',
    )) as Array<{
      contract_line_id: string;
      contract_id: string;
      contract_line_type: string | null;
      billing_frequency: string | null;
      custom_rate: number | string | null;
    }>;

  const fixedLineIds = lines
    .filter((line) => line.contract_line_type === 'Fixed')
    .map((line) => line.contract_line_id);

  const membersByLine = new Map<string, FixedMemberValuationRow[]>();
  if (fixedLineIds.length > 0) {
    const memberQuery = db.table('contract_line_service_configuration as clsc')
      .where('clsc.configuration_type', 'Fixed')
      .whereIn('clsc.contract_line_id', fixedLineIds)
      .select(
        'clsc.contract_line_id',
        'clsc.service_id',
        'clsc.config_id',
        'clsc.quantity',
        'clsc.custom_rate',
        'fc.base_rate',
        'fc.pricing_basis',
      );
    db.tenantJoin(memberQuery, 'contract_line_service_fixed_config as fc', 'clsc.config_id', 'fc.config_id', { type: 'left' });
    const members = (await memberQuery) as FixedMemberValuationRow[];
    for (const member of members) {
      const existing = membersByLine.get(member.contract_line_id) ?? [];
      existing.push(member);
      membersByLine.set(member.contract_line_id, existing);
    }
  }

  // Latest unit-pricing revision effective at/before asOf per (line, service,
  // config). Future revisions are scheduled values, not current commitments.
  const effectiveRevisions = new Map<string, { quantity: number; unit_rate_cents: number }>();
  if (fixedLineIds.length > 0) {
    const revisionRows = (await db.table('contract_line_unit_pricing_revisions as rev')
      .whereIn('rev.contract_line_id', fixedLineIds)
      .where('rev.effective_period_start', '<=', asOf)
      .orderBy('rev.effective_period_start', 'asc')
      .select(
        'rev.contract_line_id',
        'rev.service_id',
        'rev.config_id',
        'rev.quantity',
        'rev.unit_rate_cents',
      )) as Array<{
        contract_line_id: string;
        service_id: string;
        config_id: string;
        quantity: number | string;
        unit_rate_cents: number | string;
      }>;
    // Ascending order: later effective dates overwrite earlier (superseded) ones.
    for (const row of revisionRows) {
      effectiveRevisions.set(`${row.contract_line_id}:${row.service_id}:${row.config_id}`, {
        quantity: Number(row.quantity),
        unit_rate_cents: Number(row.unit_rate_cents),
      });
    }
  }

  const lineMonthlyCents = (line: (typeof lines)[number]): number => {
    if (line.contract_line_type === 'Usage') return 0;
    if (line.contract_line_type === 'Fixed') {
      const members = membersByLine.get(line.contract_line_id) ?? [];
      if (isUnitPricedMemberSet(members)) {
        let unitTotal = 0;
        for (const member of members) {
          const revision = effectiveRevisions.get(`${line.contract_line_id}:${member.service_id}:${member.config_id}`);
          const quantity = revision ? revision.quantity : Number(member.quantity ?? 0);
          const rateCents = revision ? revision.unit_rate_cents : (toCents(member.base_rate) ?? toCents(member.custom_rate));
          if (!Number.isFinite(quantity) || quantity <= 0 || rateCents === null || rateCents < 0) {
            // Zero/absent quantity is an explicit zero; a member without a
            // valid unit rate bills nothing (mirrors the engine's unit branch).
            continue;
          }
          unitTotal += Math.round(quantity * rateCents);
        }
        return normalizeToMonthlyCents(unitTotal, line.billing_frequency);
      }
    }
    // Bundle Fixed lines and other non-Usage line types keep the existing
    // line-level custom_rate valuation (minor units).
    return normalizeToMonthlyCents(toCents(line.custom_rate) ?? 0, line.billing_frequency);
  };

  const valueByContract = new Map<string, ContractFixedMonthlyValue>();
  for (const line of lines) {
    const existing = valueByContract.get(line.contract_id)
      ?? { contractId: line.contract_id, monthlyValueCents: 0, hasVariableUsage: false };
    if (line.contract_line_type === 'Usage') {
      existing.hasVariableUsage = true;
    } else {
      existing.monthlyValueCents += lineMonthlyCents(line);
    }
    valueByContract.set(line.contract_id, existing);
  }

  return valueByContract;
}

/**
 * Assignment-keyed rollup of {@link getContractMonthlyFixedValuesByContract}
 * used by reports that present one row per client contract assignment.
 */
export async function getContractMonthlyValuesByAssignment(
  conn: Knex | Knex.Transaction,
  tenant: string,
  clientContractIds?: string[],
  asOfDate?: string,
): Promise<Map<string, ContractMonthlyValue>> {
  if (clientContractIds?.length === 0) return new Map();

  const db = tenantDb(conn, tenant);
  const assignmentQuery = db.table('client_contracts as cc');
  db.tenantJoin(assignmentQuery, 'contracts as c', 'cc.contract_id', 'c.contract_id');
  if (clientContractIds) assignmentQuery.whereIn('cc.client_contract_id', clientContractIds);
  const assignments = (await assignmentQuery.select(
    'cc.client_contract_id',
    'cc.contract_id',
    'c.currency_code',
  )) as Array<{ client_contract_id: string; contract_id: string; currency_code: string }>;
  if (assignments.length === 0) return new Map();

  const valueByContract = await getContractMonthlyFixedValuesByContract(
    conn,
    tenant,
    Array.from(new Set(assignments.map((a) => a.contract_id))),
    asOfDate,
  );

  return new Map(assignments.map((assignment) => {
    const contractValue = valueByContract.get(assignment.contract_id);
    return [
      assignment.client_contract_id,
      {
        clientContractId: assignment.client_contract_id,
        monthlyValueCents: contractValue?.monthlyValueCents ?? 0,
        currencyCode: assignment.currency_code,
        hasVariableUsage: contractValue?.hasVariableUsage ?? false,
      },
    ];
  }));
}
