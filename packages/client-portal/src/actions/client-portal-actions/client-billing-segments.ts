'use server';

/* eslint-disable custom-rules/no-feature-to-feature-imports -- Portal segment views intentionally compose the billing feature's profile model. */

import type { Knex } from 'knex';
import { getConnection, tenantDb, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import type { BillingProfileSource } from '@alga-psa/types';
import { listClientBillingProfiles } from '@alga-psa/shared/billingClients/billingProfiles';
import {
  getClientIdFromPortalUser,
  hasClientBillingReadPermission,
} from './clientBillingPermissions';
import {
  getPermittedBillingProfileIds,
  restrictToPermittedProfiles,
} from './clientBillingProfileAccess';

/**
 * Portal segment views (F071–F078).
 *
 * A client whose organisation is split across separately-billed sites or
 * entities gets one portal login that shows the whole organisation *and* which
 * costs belong to which part of it. That is the shape the feature exists for:
 * shape B in particular is one manager over several legal entities who needs
 * both views at once.
 *
 * A client with a single profile sees exactly what it saw before — no selector,
 * no segment tab, no per-segment numbers (F077). The rule is the same
 * `profiles.length > 1` used everywhere else, and it comes from the same shared
 * model.
 *
 * Every query here is scoped by the portal user's own client, resolved from
 * their contact, and gated on the same billing-read permission the rest of the
 * portal billing surface uses (F078). Passing a `billingProfileId` never widens
 * that: it can only narrow within the caller's own client.
 */

export type PortalSegmentActionError =
  | { readonly actionError: string }
  | { readonly permissionError: string };

export type PortalSegmentResult<T> = T | PortalSegmentActionError;

export interface PortalBillingProfile {
  billingProfileId: string;
  name: string;
  isDefault: boolean;
}

export interface PortalSegmentSpendRow {
  billingProfileId: string;
  name: string;
  netAmount: number;
  taxAmount: number;
  total: number;
  chargeCount: number;
}

export interface PortalSegmentSpend {
  /** Total across every profile the viewer may see — the organisation view. */
  organizationTotal: number;
  currencyCode: string | null;
  periodStart: string;
  periodEnd: string;
  rows: PortalSegmentSpendRow[];
}

export interface PortalSegmentChargeRow {
  itemId: string;
  invoiceId: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  description: string | null;
  netAmount: number;
  taxAmount: number;
  billingProfileSource: BillingProfileSource | null;
}

function permissionError(message: string): PortalSegmentActionError {
  return { permissionError: message };
}

function isSegmentActionError(value: unknown): value is PortalSegmentActionError {
  const candidate = value as Record<string, unknown> | null;
  return Boolean(
    candidate &&
      typeof candidate === 'object' &&
      (typeof candidate.actionError === 'string' || typeof candidate.permissionError === 'string'),
  );
}

/**
 * A portal invoice is only visible once finalized, and the same is true of the
 * charges behind these numbers: a draft's amounts still move, so showing them
 * would give the client a figure that changes on refresh.
 */
const PORTAL_VISIBLE_INVOICE_STATUSES = ['sent', 'paid', 'partially_paid', 'overdue', 'finalized'];

/** The caller's own client, or an error. Never takes a client id from input. */
async function resolvePortalClient(
  trx: Knex.Transaction,
  user: any,
  tenant: string,
): Promise<string | PortalSegmentActionError> {
  const clientId = await getClientIdFromPortalUser(trx, user, tenant);
  if (!clientId) {
    return permissionError('Unauthorized');
  }
  if (!(await hasClientBillingReadPermission(trx, user, tenant))) {
    return permissionError('Unauthorized to access billing data');
  }
  return clientId;
}

/**
 * The segments this portal user may see (F072).
 *
 * Returns one row for an unsegmented client, which is what lets every portal
 * surface treat `length > 1` as "show the selector" without a separate empty
 * case. A user restricted to a subset sees only their subset (F124).
 */
export const getPortalBillingProfiles = withAuth(async (
  user,
  { tenant },
): Promise<PortalSegmentResult<PortalBillingProfile[]>> => {
  const knex = await getConnection(tenant);
  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const clientId = await resolvePortalClient(trx, user, tenant);
    if (isSegmentActionError(clientId)) return clientId;

    const profiles = await listClientBillingProfiles(trx, tenant, clientId);
    const permitted = await getPermittedBillingProfileIds(trx, tenant, user, clientId);
    return restrictToPermittedProfiles(profiles, permitted).map((profile) => ({
      billingProfileId: profile.billing_profile_id,
      name: profile.name,
      isDefault: profile.is_default,
    }));
  });
});

/**
 * Organisation-wide spend and its per-segment breakdown (F071, F073).
 *
 * Both numbers come from the same query over the same rows, so the parts
 * provably sum to the whole — a client comparing the two and finding a gap
 * would have no way to tell which was wrong.
 */
export const getPortalSpendByBillingProfile = withAuth(async (
  user,
  { tenant },
  input: { periodStart: string; periodEnd: string },
): Promise<PortalSegmentResult<PortalSegmentSpend>> => {
  const knex = await getConnection(tenant);
  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const clientId = await resolvePortalClient(trx, user, tenant);
    if (isSegmentActionError(clientId)) return clientId;

    const db = tenantDb(trx, tenant);
    const profiles = await listClientBillingProfiles(trx, tenant, clientId, {
      includeInactive: true,
    });
    const permitted = await getPermittedBillingProfileIds(trx, tenant, user, clientId);
    const visible = restrictToPermittedProfiles(profiles, permitted);
    const namesById = new Map(visible.map((profile) => [profile.billing_profile_id, profile.name]));

    const query = db.table('invoice_charges as ic');
    db.tenantJoin(query, 'invoices as i', 'i.invoice_id', 'ic.invoice_id');
    query
      .where('i.client_id', clientId)
      .whereIn('i.status', PORTAL_VISIBLE_INVOICE_STATUSES)
      .whereNotNull('i.finalized_at')
      .where('i.invoice_date', '>=', input.periodStart)
      .where('i.invoice_date', '<', input.periodEnd)
      .whereIn('ic.billing_profile_id', [...namesById.keys()]);

    const rows = await query
      .groupBy('ic.billing_profile_id')
      .select(
        'ic.billing_profile_id',
        trx.raw('COALESCE(SUM(ic.net_amount), 0)::bigint AS net_amount'),
        trx.raw('COALESCE(SUM(ic.tax_amount), 0)::bigint AS tax_amount'),
        trx.raw('COUNT(ic.item_id)::bigint AS charge_count'),
      );

    const client = await db
      .table('clients')
      .where({ client_id: clientId })
      .first('default_currency_code');

    const mapped: PortalSegmentSpendRow[] = rows
      .map((row: any) => {
        const netAmount = Number(row.net_amount ?? 0);
        const taxAmount = Number(row.tax_amount ?? 0);
        return {
          billingProfileId: row.billing_profile_id as string,
          name: namesById.get(row.billing_profile_id) ?? 'Removed profile',
          netAmount,
          taxAmount,
          total: netAmount + taxAmount,
          chargeCount: Number(row.charge_count ?? 0),
        };
      })
      .sort((a, b) => b.total - a.total);

    return {
      organizationTotal: mapped.reduce((sum, row) => sum + row.total, 0),
      currencyCode: (client?.default_currency_code as string | null) ?? null,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      rows: mapped,
    };
  });
});

/** The charges behind one segment's number (F073). */
export const getPortalChargesForBillingProfile = withAuth(async (
  user,
  { tenant },
  input: { billingProfileId: string; periodStart: string; periodEnd: string },
): Promise<PortalSegmentResult<PortalSegmentChargeRow[]>> => {
  const knex = await getConnection(tenant);
  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const clientId = await resolvePortalClient(trx, user, tenant);
    if (isSegmentActionError(clientId)) return clientId;

    // The requested profile must belong to this client *and* be one the viewer
    // may see. Checked server-side, because a client that only filters in the
    // UI is not filtered at all (F078, F127).
    const permitted = await getPermittedBillingProfileIds(trx, tenant, user, clientId);
    const profiles = restrictToPermittedProfiles(
      await listClientBillingProfiles(trx, tenant, clientId, { includeInactive: true }),
      permitted,
    );
    if (!profiles.some((profile) => profile.billing_profile_id === input.billingProfileId)) {
      return permissionError('Unauthorized to access that billing segment');
    }

    const db = tenantDb(trx, tenant);
    const query = db.table('invoice_charges as ic');
    db.tenantJoin(query, 'invoices as i', 'i.invoice_id', 'ic.invoice_id');

    const rows = await query
      .where('i.client_id', clientId)
      .where('ic.billing_profile_id', input.billingProfileId)
      .whereIn('i.status', PORTAL_VISIBLE_INVOICE_STATUSES)
      .whereNotNull('i.finalized_at')
      .where('i.invoice_date', '>=', input.periodStart)
      .where('i.invoice_date', '<', input.periodEnd)
      .orderBy('i.invoice_date', 'desc')
      .select(
        'ic.item_id',
        'ic.invoice_id',
        'ic.description',
        'ic.net_amount',
        'ic.tax_amount',
        'ic.billing_profile_source',
        'i.invoice_number',
        'i.invoice_date',
      );

    return rows.map((row: any) => ({
      itemId: row.item_id,
      invoiceId: row.invoice_id,
      invoiceNumber: row.invoice_number ?? null,
      invoiceDate: row.invoice_date ? new Date(row.invoice_date).toISOString() : null,
      description: row.description ?? null,
      netAmount: Number(row.net_amount ?? 0),
      taxAmount: Number(row.tax_amount ?? 0),
      billingProfileSource: (row.billing_profile_source as BillingProfileSource | null) ?? null,
    }));
  });
});

/**
 * Invoice ids carrying at least one charge for a segment (F074).
 *
 * Returned as ids rather than as a filtered invoice list so the portal's
 * existing invoice view model — totals, tax, credit application, PDF — stays
 * the single way an invoice is rendered. A parallel "segment invoice" shape
 * would be a second answer to what an invoice looks like.
 */
export const getPortalInvoiceIdsForBillingProfile = withAuth(async (
  user,
  { tenant },
  input: { billingProfileId: string },
): Promise<PortalSegmentResult<string[]>> => {
  const knex = await getConnection(tenant);
  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const clientId = await resolvePortalClient(trx, user, tenant);
    if (isSegmentActionError(clientId)) return clientId;

    const permitted = await getPermittedBillingProfileIds(trx, tenant, user, clientId);
    const profiles = restrictToPermittedProfiles(
      await listClientBillingProfiles(trx, tenant, clientId, { includeInactive: true }),
      permitted,
    );
    if (!profiles.some((profile) => profile.billing_profile_id === input.billingProfileId)) {
      return permissionError('Unauthorized to access that billing segment');
    }

    const db = tenantDb(trx, tenant);
    const query = db.table('invoice_charges as ic');
    db.tenantJoin(query, 'invoices as i', 'i.invoice_id', 'ic.invoice_id');
    const rows = await query
      .where('i.client_id', clientId)
      .where('ic.billing_profile_id', input.billingProfileId)
      .whereNotNull('i.finalized_at')
      .distinct('ic.invoice_id')
      .select('ic.invoice_id');
    return rows.map((row: any) => row.invoice_id as string);
  });
});

/** Ticket ids attributed to a segment (F075). */
export const getPortalTicketIdsForBillingProfile = withAuth(async (
  user,
  { tenant },
  input: { billingProfileId: string },
): Promise<PortalSegmentResult<string[]>> => {
  const knex = await getConnection(tenant);
  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const clientId = await resolvePortalClient(trx, user, tenant);
    if (isSegmentActionError(clientId)) return clientId;

    const permitted = await getPermittedBillingProfileIds(trx, tenant, user, clientId);
    const profiles = restrictToPermittedProfiles(
      await listClientBillingProfiles(trx, tenant, clientId, { includeInactive: true }),
      permitted,
    );
    if (!profiles.some((profile) => profile.billing_profile_id === input.billingProfileId)) {
      return permissionError('Unauthorized to access that billing segment');
    }

    const rows = await tenantDb(trx, tenant)
      .table('tickets')
      .where({ client_id: clientId, billing_profile_id: input.billingProfileId })
      .select('ticket_id');
    return rows.map((row: any) => row.ticket_id as string);
  });
});

/**
 * Contracts and their lines attributed to a segment (F076).
 *
 * A line assignment overrides its contract's, so a contract belongs to a
 * segment when the contract itself is assigned to it *or* any of its lines is.
 */
export const getPortalContractIdsForBillingProfile = withAuth(async (
  user,
  { tenant },
  input: { billingProfileId: string },
): Promise<PortalSegmentResult<string[]>> => {
  const knex = await getConnection(tenant);
  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const clientId = await resolvePortalClient(trx, user, tenant);
    if (isSegmentActionError(clientId)) return clientId;

    const permitted = await getPermittedBillingProfileIds(trx, tenant, user, clientId);
    const profiles = restrictToPermittedProfiles(
      await listClientBillingProfiles(trx, tenant, clientId, { includeInactive: true }),
      permitted,
    );
    if (!profiles.some((profile) => profile.billing_profile_id === input.billingProfileId)) {
      return permissionError('Unauthorized to access that billing segment');
    }

    const db = tenantDb(trx, tenant);
    const query = db.table('client_contracts as cc');
    db.tenantJoin(query, 'contract_lines as cl', 'cl.contract_id', 'cc.contract_id', {
      type: 'left',
    });
    const rows = await query
      .where('cc.client_id', clientId)
      .where(function (this: Knex.QueryBuilder) {
        this.where('cc.billing_profile_id', input.billingProfileId).orWhere(
          'cl.billing_profile_id',
          input.billingProfileId,
        );
      })
      .distinct('cc.client_contract_id')
      .select('cc.client_contract_id');
    return rows.map((row: any) => row.client_contract_id as string);
  });
});
