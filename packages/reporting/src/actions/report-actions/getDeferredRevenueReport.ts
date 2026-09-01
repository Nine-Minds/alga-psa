'use server';

import { z } from 'zod';
import type { Knex } from 'knex';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import type { IUserWithRoles } from '@alga-psa/types';

import { reportingActionErrorFrom, type ReportingActionError } from './reportingActionErrors';
import { buildDeferredRevenueReport } from './deferred-revenue/compose';
import type { DeferredRevenueReport } from './deferred-revenue/types';
import { isValidMonth } from './deferred-revenue/month';

export type {
  DeferredRevenueReport,
  ClientRollforward,
  CurrencySection,
  CreditDetailRow,
  BucketDetailRow,
  MovementColumns,
  FeeSource,
  CreditSourceKind,
} from './deferred-revenue/types';

const InputSchema = z.object({
  month: z.string().refine(isValidMonth, {
    message: 'month must be in YYYY-MM format',
  }),
});

export type GetDeferredRevenueReportInput = z.infer<typeof InputSchema>;

/**
 * Per-client × currency deferred-revenue / prepaid liability rollforward for
 * one calendar month, covering both client credit balances and unburned
 * prepaid bucket hours. Every number is derived live from the ledgers — no
 * snapshot tables.
 *
 * Enforced independently of the page: internal users with the `reports.read`
 * permission (the same resource the billing report actions use).
 */
async function assertCanReadDeferredRevenueReport(
  user: IUserWithRoles,
  knex: Knex,
): Promise<void> {
  if (user.user_type !== 'internal') {
    throw new Error('Permission denied: this report is for internal users only');
  }
  if (!(await hasPermission(user, 'reports', 'read', knex))) {
    throw new Error('Permission denied: Cannot read reports');
  }
}

export const getDeferredRevenueReport = withAuth(
  async (
    user,
    { tenant },
    input: GetDeferredRevenueReportInput,
  ): Promise<DeferredRevenueReport | ReportingActionError> => {
    const validationResult = InputSchema.safeParse(input);
    if (!validationResult.success) {
      return reportingActionErrorFrom(validationResult.error)!;
    }

    try {
      const { knex } = await createTenantKnex();
      await assertCanReadDeferredRevenueReport(user, knex);
      return await buildDeferredRevenueReport(knex, tenant, validationResult.data.month);
    } catch (error) {
      const expected = reportingActionErrorFrom(error);
      if (expected) return expected;
      throw error;
    }
  },
);
