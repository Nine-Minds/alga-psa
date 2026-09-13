'use server';

/**
 * Rate review: the assisted reclassification pass for legacy `unreviewed`
 * contract-line rates (plan §1.4).
 *
 * Preview proposes `inherited` (exact match — a provable no-op on the next
 * invoice) or `custom` (pure relabel — the rate column is untouched), or skips
 * the row with a reason. Apply re-runs the same comparison inside the tenant
 * billing lock and refuses any row that drifted since preview.
 */

import { createTenantKnex } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { lockTenantBilling } from '../lib/billing/billingMutationLock';
import {
  loadFixedLineRateInputs,
  toResolverInput,
  type FixedLineRateInputBundle,
} from '../lib/billing/pricing/loadFixedLineRateInputs';
import {
  classifyLineRateProvenance,
  nextBillingPeriodBoundary,
  type LineRateClassification,
  type LineRateSkipReason,
} from '../lib/billing/pricing/classifyLineRateProvenance';
import { resolveFixedLineRate } from '../lib/billing/pricing/resolveFixedLineRate';

export type RateReviewActionError = ActionMessageError | ActionPermissionError;

export interface RateReviewPeriod {
  start: string;
  end: string;
}

export interface RateReviewRow {
  contractLineId: string;
  contractId: string | null;
  contractName: string | null;
  clientId: string | null;
  currency: string;
  storedRateCents: number | null;
  resolvedRateCents: number | null;
  currentProvenance: string | null;
  proposed: LineRateClassification;
  skipReason: LineRateSkipReason | null;
  reason: string | null;
}

export interface RateReviewPreview {
  period: RateReviewPeriod;
  rows: RateReviewRow[];
  summary: {
    total: number;
    inherited: number;
    custom: number;
    skipped: number;
  };
}

export interface RateReviewDecision {
  contractLineId: string;
  target: 'inherited' | 'custom';
}

export interface RateReviewApplied {
  contractLineId: string;
  target: 'inherited' | 'custom';
}

export interface RateReviewRefused {
  contractLineId: string;
  target: 'inherited' | 'custom';
  reason: string;
  skipReason: LineRateSkipReason | null;
}

export interface RateReviewApplyResult {
  applied: RateReviewApplied[];
  refused: RateReviewRefused[];
}

function resolvePeriod(period?: RateReviewPeriod): RateReviewPeriod {
  if (period?.start && period?.end) {
    return period;
  }
  return nextBillingPeriodBoundary(new Date());
}

function classifyBundle(
  bundle: FixedLineRateInputBundle,
  period: RateReviewPeriod,
) {
  return classifyLineRateProvenance({
    resolver: toResolverInput(bundle, period),
    storedRateCents: bundle.line.custom_rate === null ? null : Number(bundle.line.custom_rate),
    currentProvenance: bundle.line.rate_provenance
      ? String(bundle.line.rate_provenance)
      : null,
    contractIsActive: bundle.contractIsActive,
    contractHasEnded: bundle.contractHasEnded,
    serviceIds: bundle.serviceIds,
  });
}

async function loadUnreviewedLineIds(
  trx: Knex | Knex.Transaction,
  tenant: string,
): Promise<string[]> {
  const rows = await trx('contract_lines')
    .where({ tenant, rate_provenance: 'unreviewed' })
    // Live lines carry a contract; template lines are never billed.
    .whereNotNull('contract_id')
    .select('contract_line_id');
  return rows.map((row: { contract_line_id: string }) => row.contract_line_id);
}

export const previewRateReclassification = withAuth(
  async (
    user,
    { tenant },
    options: { period?: RateReviewPeriod } = {},
  ): Promise<RateReviewPreview | RateReviewActionError> => {
    if (!(await hasPermission(user, 'billing', 'read'))) {
      return permissionError(
        'Permission denied: Cannot review contract rates',
        'msp/billing:errors.permissions.billingRead',
      );
    }

    const period = resolvePeriod(options.period);
    const { knex } = await createTenantKnex();

    try {
      return await withTransaction(knex, async (trx: Knex.Transaction) => {
        const lineIds = await loadUnreviewedLineIds(trx, tenant);
        const bundles = await loadFixedLineRateInputs(trx, tenant, lineIds);

        const rows: RateReviewRow[] = [];
        for (const bundle of bundles.values()) {
          const classification = classifyBundle(bundle, period);
          rows.push({
            contractLineId: bundle.contractLineId,
            contractId: bundle.contractId,
            contractName: bundle.contractName,
            clientId: bundle.clientId,
            currency: bundle.currency,
            storedRateCents: classification.storedRateCents,
            resolvedRateCents: classification.resolvedRateCents,
            currentProvenance: bundle.line.rate_provenance
              ? String(bundle.line.rate_provenance)
              : null,
            proposed: classification.classification,
            skipReason: classification.skipReason,
            reason: classification.reason,
          });
        }

        rows.sort((a, b) =>
          (a.contractName ?? '').localeCompare(b.contractName ?? ''),
        );

        return {
          period,
          rows,
          summary: {
            total: rows.length,
            inherited: rows.filter((row) => row.proposed === 'inherited').length,
            custom: rows.filter((row) => row.proposed === 'custom').length,
            skipped: rows.filter((row) => row.proposed === 'skip').length,
          },
        };
      });
    } catch (error) {
      console.error('[rateReviewActions] previewRateReclassification failed:', error);
      return actionError(
        'Could not load rates for review. Please try again.',
        'msp/billing:errors.rateReview.previewFailed',
      );
    }
  },
);

export const applyRateReclassification = withAuth(
  async (
    user,
    { tenant },
    decisions: RateReviewDecision[],
    options: { period?: RateReviewPeriod } = {},
  ): Promise<RateReviewApplyResult | RateReviewActionError> => {
    if (!(await hasPermission(user, 'billing', 'update'))) {
      return permissionError(
        'Permission denied: Cannot reclassify contract rates',
        'msp/billing:errors.permissions.billingUpdate',
      );
    }

    const period = resolvePeriod(options.period);
    const { knex } = await createTenantKnex();

    try {
      return await withTransaction(knex, async (trx: Knex.Transaction) => {
        // Serialize against other billing mutations for this tenant, then
        // re-run the comparison so a row that changed since preview is refused.
        await lockTenantBilling(trx, tenant);

        const lineIds = [...new Set(decisions.map((d) => d.contractLineId))];
        const bundles = await loadFixedLineRateInputs(trx, tenant, lineIds);

        const applied: RateReviewApplied[] = [];
        const refused: RateReviewRefused[] = [];

        for (const decision of decisions) {
          const bundle = bundles.get(decision.contractLineId);
          if (!bundle) {
            refused.push({
              ...decision,
              reason: 'Contract line not found or is a template.',
              skipReason: null,
            });
            continue;
          }

          const classification = classifyBundle(bundle, period);
          if (classification.classification !== decision.target) {
            refused.push({
              ...decision,
              reason:
                classification.reason ??
                `No longer classifies as ${decision.target}.`,
              skipReason: classification.skipReason,
            });
            continue;
          }

          if (decision.target === 'inherited') {
            await trx('contract_lines')
              .where({ tenant, contract_line_id: bundle.contractLineId })
              .update({ custom_rate: null, rate_provenance: 'inherited' });
          } else {
            await trx('contract_lines')
              .where({ tenant, contract_line_id: bundle.contractLineId })
              .update({ rate_provenance: 'custom' });
          }
          applied.push(decision);
        }

        return { applied, refused };
      });
    } catch (error) {
      console.error('[rateReviewActions] applyRateReclassification failed:', error);
      return actionError(
        'Could not apply rate review. No changes were made.',
        'msp/billing:errors.rateReview.applyFailed',
      );
    }
  },
);

/**
 * Reset a single line to the catalog (plan §3.3). Shares the apply path, the
 * resolver and the transaction with the reclassification pass.
 */
export const resetContractLineRateToStandard = withAuth(
  async (
    user,
    { tenant },
    contractLineId: string,
    options: { period?: RateReviewPeriod } = {},
  ): Promise<RateReviewApplyResult | RateReviewActionError> => {
    if (!(await hasPermission(user, 'billing', 'update'))) {
      return permissionError(
        'Permission denied: Cannot reset contract rates',
        'msp/billing:errors.permissions.billingUpdate',
      );
    }

    const period = resolvePeriod(options.period);
    const { knex } = await createTenantKnex();

    try {
      return await withTransaction(knex, async (trx: Knex.Transaction) => {
        await lockTenantBilling(trx, tenant);

        const bundles = await loadFixedLineRateInputs(trx, tenant, [contractLineId]);
        const bundle = bundles.get(contractLineId);
        if (!bundle) {
          return {
            applied: [],
            refused: [
              {
                contractLineId,
                target: 'inherited' as const,
                reason: 'Contract line not found or is a template.',
                skipReason: null,
              },
            ],
          };
        }

        const classification = classifyBundle(bundle, period);
        // Reset is a deliberate operator action, not the exact-match
        // reclassification (plan §3.3): it must be available precisely for a
        // line wrongly marked `custom`, which the classifier would skip. The
        // only precondition is that the line resolves to a number at all.
        const resolved = resolveFixedLineRate(toResolverInput(bundle, period));
        if (resolved.line.rateCents === null) {
          return {
            applied: [],
            refused: [
              {
                contractLineId,
                target: 'inherited' as const,
                reason:
                  classification.reason ??
                  'The line resolves to no catalog rate.',
                skipReason: classification.skipReason,
              },
            ],
          };
        }

        await trx('contract_lines')
          .where({ tenant, contract_line_id: contractLineId })
          .update({ custom_rate: null, rate_provenance: 'inherited' });

        return {
          applied: [{ contractLineId, target: 'inherited' as const }],
          refused: [],
        };
      });
    } catch (error) {
      console.error('[rateReviewActions] resetContractLineRateToStandard failed:', error);
      return actionError(
        'Could not reset the line rate. No changes were made.',
        'msp/billing:errors.rateReview.resetFailed',
      );
    }
  },
);
