import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  resolveMemberRate,
  type UnitPricingRevisionRateRow,
  type ServicePriceRateRow,
} from './resolveFixedLineRate';
import {
  selectLatestApplicableRevision,
  toRecurringUnitRevisionCandidate,
  type RecurringUnitRevisionCandidate,
} from './recurringUnitPricing';

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
  /** `contract_line_services.custom_rate` — the legacy service-line override. */
  service_line_custom_rate?: number | string | null;
  base_rate: number | string | null;
  pricing_basis: string | null;
  /** Catalog rate (minor units) — the engine's last fallback for a member with no configured rate. */
  default_rate: number | string | null;
  /** `service_catalog.item_kind`; `product` marks the recurring product path. */
  item_kind?: string | null;
}

// LEVERAGE: pattern unit-priced-fixed-service — twin of
// computeFixedCharges.isUnitPricedFixedService; the predicate should live in
// one shared layer both the engine and this valuation import.
/**
 * Pricing basis is per SERVICE, matching the billing engine: only members
 * explicitly opted into 'unit' are valued as quantity × unit rate; NULL and
 * 'bundle' members keep the fixed-bundle valuation. Must match the engine's
 * predicate exactly or valuation and invoicing drift apart.
 */
function isUnitPricedMember(member: { pricing_basis: string | null }): boolean {
  return member.pricing_basis === 'unit';
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

  // Contract currency drives the currency-specific catalog price, matching the
  // invoice engine's `service_prices` join.
  const contractCurrencies = new Map<string, string>();
  if (contractIds.length > 0) {
    const contractRows = (await db.table('contracts')
      .whereIn('contract_id', contractIds)
      .select('contract_id', 'currency_code')) as Array<{
      contract_id: string;
      currency_code: string | null;
    }>;
    for (const contract of contractRows) {
      contractCurrencies.set(
        contract.contract_id,
        (contract.currency_code && String(contract.currency_code).trim()) || 'USD',
      );
    }
  }
  const tenantSettings = (await db.table('default_billing_settings')
    .select('default_currency_code')
    .first()) as { default_currency_code?: string | null } | undefined;
  const tenantDefaultCurrency =
    (tenantSettings?.default_currency_code && String(tenantSettings.default_currency_code).trim()) ||
    'USD';

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
        'sc.default_rate',
        'sc.item_kind',
      );
    db.tenantJoin(memberQuery, 'contract_line_service_fixed_config as fc', 'clsc.config_id', 'fc.config_id', { type: 'left' });
    db.tenantJoin(memberQuery, 'service_catalog as sc', 'clsc.service_id', 'sc.service_id', { type: 'left' });
    const members = (await memberQuery) as FixedMemberValuationRow[];
    for (const member of members) {
      member.service_line_custom_rate = null;
      const existing = membersByLine.get(member.contract_line_id) ?? [];
      existing.push(member);
      membersByLine.set(member.contract_line_id, existing);
    }
  }

  // Legacy service-line overrides (`contract_line_services.custom_rate`) — the
  // product baseline consults these before the catalog price.
  const serviceLineRates = new Map<string, number | string | null>();
  if (fixedLineIds.length > 0) {
    const serviceLineRows = (await db.table('contract_line_services')
      .whereIn('contract_line_id', fixedLineIds)
      .select('contract_line_id', 'service_id', 'custom_rate')) as Array<{
      contract_line_id: string;
      service_id: string;
      custom_rate: number | string | null;
    }>;
    for (const row of serviceLineRows) {
      serviceLineRates.set(`${row.contract_line_id}:${row.service_id}`, row.custom_rate ?? null);
    }
    for (const [lineId, members] of membersByLine) {
      for (const member of members) {
        member.service_line_custom_rate =
          serviceLineRates.get(`${lineId}:${member.service_id}`) ?? null;
      }
    }
  }

  // Currency/period-specific catalog prices for every member service. The shared
  // resolver admits only the matching currency and latest effective date.
  const memberServiceIds = new Set<string>();
  for (const members of membersByLine.values()) {
    for (const member of members) memberServiceIds.add(member.service_id);
  }
  const catalogPrices: ServicePriceRateRow[] = memberServiceIds.size > 0
    ? ((await db.table('service_prices')
        .whereIn('service_id', [...memberServiceIds])
        .select('price_id', 'service_id', 'currency_code', 'rate', 'effective_date', 'created_at')) as ServicePriceRateRow[])
    : [];

  // Unit-pricing revisions effective at/before asOf, keyed for the shared
  // resolver and for quantity selection. Future revisions are scheduled values,
  // not current commitments. Products use this same store.
  const revisionsByLine = new Map<string, UnitPricingRevisionRateRow[]>();
  const candidatesByKey = new Map<string, RecurringUnitRevisionCandidate[]>();
  if (fixedLineIds.length > 0) {
    const revisionRows = (await db.table('contract_line_unit_pricing_revisions as rev')
      .whereIn('rev.contract_line_id', fixedLineIds)
      .where('rev.effective_period_start', '<=', asOf)
      .orderBy('rev.effective_period_start', 'asc')
      .select(
        'rev.revision_id',
        'rev.contract_line_id',
        'rev.service_id',
        'rev.config_id',
        'rev.quantity',
        'rev.unit_rate_cents',
        'rev.price_policy',
        'rev.version',
        'rev.created_at',
        'rev.effective_period_start',
      )) as Array<{
        revision_id: string;
        contract_line_id: string;
        service_id: string;
        config_id: string;
        quantity: number | string;
        unit_rate_cents: number | string | null;
        price_policy: string | null;
        version: number | string | null;
        created_at: string | Date | null;
        effective_period_start: string | Date;
      }>;
    for (const row of revisionRows) {
      const resolverRow: UnitPricingRevisionRateRow = {
        revision_id: row.revision_id,
        service_id: row.service_id,
        config_id: row.config_id,
        effective_period_start: row.effective_period_start,
        unit_rate_cents:
          row.unit_rate_cents === null || row.unit_rate_cents === undefined
            ? null
            : Number(row.unit_rate_cents),
        price_policy: row.price_policy,
        version: row.version === null || row.version === undefined ? null : Number(row.version),
        created_at: row.created_at,
      };
      const lineRevisions = revisionsByLine.get(row.contract_line_id) ?? [];
      lineRevisions.push(resolverRow);
      revisionsByLine.set(row.contract_line_id, lineRevisions);

      const key = `${row.contract_line_id}:${row.service_id}:${row.config_id}`;
      const candidates = candidatesByKey.get(key) ?? [];
      candidates.push(
        toRecurringUnitRevisionCandidate({
          revision_id: row.revision_id,
          quantity: Number(row.quantity),
          unit_rate_cents: row.unit_rate_cents,
          price_policy: row.price_policy,
          version: row.version,
          effective_period_start: row.effective_period_start,
          created_at: row.created_at,
        }),
      );
      candidatesByKey.set(key, candidates);
    }
  }

  // Usage configurations make revenue variable REGARDLESS of the line type
  // that carries them: the engine bills a Usage configuration record-driven on
  // any line, so valuation must flag it the same way (never silently treat a
  // Fixed/Hourly line's usage service as if it did not exist).
  const lineIdsWithUsageConfigs = new Set<string>();
  if (lines.length > 0) {
    const usageConfigRows = (await db.table('contract_line_service_configuration')
      .where('configuration_type', 'Usage')
      .whereIn('contract_line_id', lines.map((line) => line.contract_line_id))
      .select('contract_line_id')) as Array<{ contract_line_id: string }>;
    for (const row of usageConfigRows) {
      lineIdsWithUsageConfigs.add(row.contract_line_id);
    }
  }

  const lineMonthlyCents = (line: (typeof lines)[number]): number => {
    if (line.contract_line_type === 'Usage') return 0;
    if (line.contract_line_type === 'Fixed') {
      const members = membersByLine.get(line.contract_line_id) ?? [];
      const currency = contractCurrencies.get(line.contract_id) ?? 'USD';
      const revisions = revisionsByLine.get(line.contract_line_id) ?? [];
      // `resolveMemberRate` is the same pure chain the invoice engine and the
      // deferred-revenue loader use, including currency/period-specific
      // `service_prices` and catalog-policy revisions.
      const revisionInput = {
        period: { start: asOf, end: asOf },
        currency,
        revisions,
        catalogPrices,
        tenantDefaultCurrency,
      };
      const revisionKey = (member: FixedMemberValuationRow) =>
        `${line.contract_line_id}:${member.service_id}:${member.config_id}`;
      const hasApplicableRevision = (member: FixedMemberValuationRow) =>
        (candidatesByKey.get(revisionKey(member)) ?? []).length > 0;
      // A member is unit-valued when it is explicitly unit-priced, when it
      // carries an applicable scheduled revision, or — once the line is
      // actively revision-managed — when it is a catalog product (products share
      // the revision store and must value consistently with the invoice instead
      // of the wizard's placeholder base_rate). Members on untouched lines keep
      // their legacy valuation path so existing contracts are unchanged.
      const lineHasEffectiveRevision = members.some(hasApplicableRevision);
      const isEffectiveUnitMember = (member: FixedMemberValuationRow) =>
        isUnitPricedMember(member) ||
        hasApplicableRevision(member) ||
        (lineHasEffectiveRevision && member.item_kind === 'product');
      const unitMembers = members.filter(isEffectiveUnitMember);
      const bundleMembers = members.filter((member) => !isEffectiveUnitMember(member));

      // Unit-valued members: Σ quantity × effective resolved rate. Quantity
      // comes from the latest applicable revision (products/services share the
      // store) else the configuration column. The rate chain is the shared
      // resolver's: revision override, else product contract override, else the
      // currency catalog price; a catalog-policy revision follows the currency
      // price dynamically and an explicit override (including zero) wins.
      let totalCents = 0;
      for (const member of unitMembers) {
        const latest = selectLatestApplicableRevision(
          candidatesByKey.get(revisionKey(member)) ?? [],
          asOf,
        );
        const quantity = latest ? latest.quantity : Number(member.quantity ?? 0);
        const resolved = resolveMemberRate(revisionInput, {
          service_id: member.service_id,
          config_id: member.config_id,
          configuration_quantity: member.quantity,
          configuration_custom_rate: member.custom_rate,
          service_base_rate: member.base_rate,
          service_line_custom_rate: member.service_line_custom_rate,
          default_rate: member.default_rate,
          pricing_basis: member.pricing_basis,
          item_kind: member.item_kind,
        });
        const rateCents = resolved.rateCents;
        if (!Number.isFinite(quantity) || quantity <= 0 || rateCents === null || rateCents < 0) {
          // Zero/absent quantity is an explicit zero; a member without a
          // valid unit rate bills nothing (mirrors the engine's unit branch).
          continue;
        }
        totalCents += Math.round(quantity * rateCents);
      }

      // Bundle members: the line-level rate is authoritative when present.
      // When it is absent the engine derives the fee from the members
      // (base rates, then catalog rates) — mirror that instead of valuing an
      // invoiceable bundle at zero.
      if (bundleMembers.length > 0) {
        const lineRateCents = toCents(line.custom_rate);
        if (lineRateCents !== null) {
          totalCents += lineRateCents;
        } else {
          const deriveFrom = (rateOf: (member: FixedMemberValuationRow) => number | null): number | null => {
            let derived = 0;
            let hasRate = false;
            for (const member of bundleMembers) {
              const rate = rateOf(member);
              if (rate !== null) {
                const quantity = Number(member.quantity ?? 1) || 1;
                derived += rate * quantity;
                hasRate = true;
              }
            }
            return hasRate ? Math.round(derived) : null;
          };
          const derivedCents =
            deriveFrom((member) => toCents(member.base_rate)) ??
            deriveFrom((member) => toCents(member.default_rate));
          if (derivedCents !== null) {
            totalCents += derivedCents;
          }
        }
      } else if (unitMembers.length === 0) {
        // No members at all: the line-level rate stands alone.
        totalCents += toCents(line.custom_rate) ?? 0;
      }
      return normalizeToMonthlyCents(totalCents, line.billing_frequency);
    }
    // Other non-Usage line types keep the existing line-level custom_rate
    // valuation (minor units).
    return normalizeToMonthlyCents(toCents(line.custom_rate) ?? 0, line.billing_frequency);
  };

  const valueByContract = new Map<string, ContractFixedMonthlyValue>();
  for (const line of lines) {
    const existing = valueByContract.get(line.contract_id)
      ?? { contractId: line.contract_id, monthlyValueCents: 0, hasVariableUsage: false };
    if (line.contract_line_type === 'Usage' || lineIdsWithUsageConfigs.has(line.contract_line_id)) {
      existing.hasVariableUsage = true;
    }
    if (line.contract_line_type !== 'Usage') {
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
