'use server';

import type { Knex } from 'knex';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { actionError, type ActionMessageError } from '@alga-psa/ui/lib/errorHandling';
import { listClientBillingProfiles } from '@alga-psa/shared/billingClients/billingProfiles';
import {
  ageInvoicesByProfile,
  buildProfileStatement,
  summariseClientAr,
  type ClientArSummary,
  type ProfileStatement,
} from '@alga-psa/shared/billingClients/billingProfileAr';
import { getAvailableCreditByProfile, getUnattributedCredit } from '../lib/creditBalance';

/**
 * Profile-scoped AR: balances, aging, credit, and statements (F112–F115).
 *
 * Decision D7 is what these read: a segmented client's receivable is one figure
 * per entity that gets billed, and the client figure is their sum. Both come
 * out of the same query here so the parts provably add up — a breakdown that
 * disagreed with the total would leave a collector with no way to tell which
 * number to trust.
 */

export type BillingProfileArError = ActionMessageError;

const permissionDenied = (): BillingProfileArError =>
  actionError('Permission denied: you do not have access to this client’s billing.', 'msp/billing:errors.permissions.clientBillingAccess');

/**
 * The client's AR, per billing profile and in total (F113, F115).
 *
 * A client with one profile gets one row equal to the totals — the same figure
 * it has always had — and `isSegmented` is false, which is the signal every
 * profile surface uses to stay hidden (decision D6).
 */
export const getClientArSummary = withAuth(async (
  user,
  { tenant },
  clientId: string,
): Promise<ClientArSummary | BillingProfileArError> => {
  if (!(await hasPermission(user, 'invoice', 'read'))) {
    return permissionDenied();
  }

  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const db = (await import('@alga-psa/db')).tenantDb(trx, tenant);

    // Outstanding balance per invoice, net of recorded payments and applied
    // credit — the same definition the client command centre ages on, so the
    // two surfaces cannot disagree about what is owed.
    const paidSubquery = db
      .table('invoice_payments')
      .select('invoice_id')
      .sum({ paid_amount: 'amount' })
      .groupBy('invoice_id')
      .as('ip');

    const query = db.table('invoices as i');
    query.leftJoin(paidSubquery, function joinPayments(this: Knex.JoinClause) {
      this.on('ip.invoice_id', '=', 'i.invoice_id');
    });
    const invoices = await query
      .where('i.client_id', clientId)
      .whereNotNull('i.finalized_at')
      .andWhere(function nonPrepayment(this: Knex.QueryBuilder) {
        this.whereNull('i.is_prepayment').orWhere('i.is_prepayment', false);
      })
      .select(
        'i.billing_profile_id',
        'i.due_date',
        'i.total_amount',
        'i.credit_applied',
        'ip.paid_amount',
      );

    const profiles = await listClientBillingProfiles(trx, tenant, clientId, {
      includeInactive: true,
    });
    const creditByProfile = await getAvailableCreditByProfile(trx, tenant, clientId);
    const unattributedCreditCents = await getUnattributedCredit(trx, tenant, clientId);

    return summariseClientAr({
      profiles,
      aged: ageInvoicesByProfile(invoices as any[], Date.now()),
      creditByProfile,
      unattributedCreditCents,
    });
  });
});

/**
 * A statement for one billing profile over one period (F114).
 *
 * The profile is required rather than optional: a statement is a demand
 * addressed to whoever pays it, and a client-wide statement sent to a franchise
 * site would both disclose figures it has no right to and ask it to reconcile
 * money it never owed. A client-level view is the set of these, one per profile.
 */
export const getBillingProfileStatement = withAuth(async (
  user,
  { tenant },
  input: { clientId: string; billingProfileId: string; periodStart: string; periodEnd: string },
): Promise<ProfileStatement | BillingProfileArError> => {
  if (!(await hasPermission(user, 'invoice', 'read'))) {
    return permissionDenied();
  }

  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const profiles = await listClientBillingProfiles(trx, tenant, input.clientId, {
      includeInactive: true,
    });
    if (!profiles.some((profile) => profile.billing_profile_id === input.billingProfileId)) {
      // A profile from another client would produce a statement addressed to
      // the wrong entity, which is worse than producing nothing.
      return actionError('That billing profile does not belong to this client.', 'msp/billing:errors.billingProfile.notThisClient');
    }

    return buildProfileStatement(trx, tenant, input.clientId, input.billingProfileId, {
      start: input.periodStart,
      end: input.periodEnd,
    });
  });
});
