'use server';

import type { Knex } from 'knex';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import {
  actionError,
  permissionError,
} from '@alga-psa/ui/lib/errorHandling';
import {
  queryGhostUsageReport,
  setGhostUsageReviewDisposition,
} from '../lib/ghostUsage';
import type {
  GhostUsageActionError,
  GhostUsageFilters,
  GhostUsageReportResult,
  GhostDisposition,
} from '../lib/ghostUsageTypes';

/**
 * Ghost-usage report actions (PRD §16). CE, deterministic, no AI.
 * The EE classifier actions live in server/src (D12: passed to the UI as props)
 * so this package stays free of @ee imports.
 */
/** §16.1/§16.8 — funnel + candidates + worklist. Requires inventory:read. */
export const getGhostUsageReport = withAuth(async (
  _user,
  { tenant: _tenant },
  _filters: GhostUsageFilters = {},
): Promise<GhostUsageReportResult | GhostUsageActionError> => {
  if (!(await hasPermission(_user, 'inventory', 'read'))) {
    return permissionError('Permission denied: inventory:read required');
  }
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) =>
    queryGhostUsageReport(trx, _tenant, _filters),
  );
});

/** §17.6 — human disposition on a review row. Requires inventory:update. */
export const setGhostUsageDisposition = withAuth(async (
  _user,
  { tenant: _tenant },
  _input: { review_id: string; disposition: GhostDisposition },
): Promise<void | GhostUsageActionError> => {
  if (!(await hasPermission(_user, 'inventory', 'update'))) {
    return permissionError('Permission denied: inventory:update required');
  }
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const updated = await setGhostUsageReviewDisposition(
      trx,
      _tenant,
      _user.user_id,
      _input.review_id,
      _input.disposition,
    );
    if (!updated) {
      return actionError('Review not found. It may have already been updated. Refresh and try again.');
    }
  });
});

export type {
  GhostUsageActionError,
  GhostUsageFilters,
  GhostUsageReportResult,
  GhostUsageCandidateRow,
  GhostUsageFunnel,
  GhostUsageAiStatus,
  GhostDisposition,
  GhostClassificationVerdict,
  GhostRunResult,
} from '../lib/ghostUsageTypes';
