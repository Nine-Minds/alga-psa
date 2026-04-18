'use server';

/**
 * Client-location lookups scoped to billing flows. Returns the subset of
 * location fields needed by quote/invoice/contract UI and PDFs without
 * adding a cross-package dependency on @alga-psa/clients.
 */

import type { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { IClientLocation } from '@alga-psa/types';

/**
 * Subset of IClientLocation fields that billing surfaces (quote/invoice/contract UI and PDFs)
 * rely on. Kept minimal on purpose — clients can add more over time as needed.
 */
export type BillingLocationSummary = Pick<
  IClientLocation,
  | 'location_id'
  | 'client_id'
  | 'location_name'
  | 'address_line1'
  | 'address_line2'
  | 'address_line3'
  | 'city'
  | 'state_province'
  | 'postal_code'
  | 'country_code'
  | 'country_name'
  | 'region_code'
  | 'is_active'
  | 'is_default'
  | 'is_billing_address'
  | 'is_shipping_address'
  | 'phone'
  | 'fax'
  | 'email'
>;

/**
 * Fetch active client locations for a given client, ordered so the
 * default/billing address comes first.
 *
 * Used by quote/invoice/contract editors to populate location pickers.
 */
export const getActiveClientLocationsForBilling = withAuth(async (
  _user,
  { tenant },
  clientId: string,
): Promise<BillingLocationSummary[]> => {
  if (!clientId) {
    return [];
  }

  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return trx('client_locations')
      .select<BillingLocationSummary[]>(
        'location_id',
        'client_id',
        'location_name',
        'address_line1',
        'address_line2',
        'address_line3',
        'city',
        'state_province',
        'postal_code',
        'country_code',
        'country_name',
        'region_code',
        'is_active',
        'is_default',
        'is_billing_address',
        'is_shipping_address',
        'phone',
        'fax',
        'email',
      )
      .where({
        tenant,
        client_id: clientId,
        is_active: true,
      })
      .orderBy('is_default', 'desc')
      .orderBy('is_billing_address', 'desc')
      .orderBy('location_name', 'asc');
  });
});
