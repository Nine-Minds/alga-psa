import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { getClientDocumentLogoUrl } from '@alga-psa/formatting/avatarUtils';
import { displayAddressField, displayCountry, formatPostalAddress } from '@alga-psa/core';

const asTrimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const buildAddress = (record: Record<string, unknown> | null | undefined): string | null => {
  if (!record) {
    return null;
  }

  const parts = [
    displayAddressField(record.address_line1),
    displayAddressField(record.address_line2),
    displayAddressField(record.address_line3),
    displayAddressField(record.city),
    displayAddressField(record.state_province),
    displayAddressField(record.postal_code),
    displayCountry(record.country_name),
    displayAddressField(record.location_address),
    displayAddressField(record.address),
  ]
    .filter((value, index, collection) => value.length > 0 && collection.indexOf(value) === index);

  return formatPostalAddress(parts) || null;
};

export interface TenantParty {
  name: string;
  address: string | null;
  email: string | null;
  phone: string | null;
  logo_url: string | null;
}

/**
 * Logo an admin configured under Settings -> Branding, which is what they
 * expect on generated documents. Wide wordmark first (documents have room for
 * it), then the square mark. Light variants only: these land on white paper.
 */
async function fetchBrandingDocumentLogoUrl(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string
): Promise<string | null> {
  const record = await tenantDb(knexOrTrx, tenant).table('tenant_settings')
    .select('settings')
    .first<Record<string, unknown>>()
    .catch(() => null);

  const branding = (record?.settings as Record<string, unknown> | undefined)?.branding as
    | Record<string, unknown>
    | undefined;
  if (!branding) {
    return null;
  }

  // Deleting a slot writes '', so an empty string means "no logo", not "logo ''".
  return asTrimmedString(branding.logoWideUrl) || asTrimmedString(branding.logoUrl) || null;
}

export async function fetchTenantParty(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string
): Promise<TenantParty | null> {
  const db = tenantDb(knexOrTrx, tenant);
  const tenantClientQuery = db.table('tenant_companies as tc')
    .select(
      'tc.client_id',
      'c.client_name',
      'cl.phone',
      'cl.email',
      'cl.address_line1',
      'cl.address_line2',
      'cl.address_line3',
      'cl.city',
      'cl.state_province',
      'cl.postal_code',
      'cl.country_name'
    )
    .where({ 'tc.is_default': true })
    .whereNull('tc.deleted_at')
    .orderByRaw('cl.is_billing_address DESC NULLS LAST, cl.is_default DESC NULLS LAST');
  db.tenantJoin(tenantClientQuery, 'clients as c', 'tc.client_id', 'c.client_id');
  db.tenantJoin(tenantClientQuery, 'client_locations as cl', 'c.client_id', 'cl.client_id', {
    type: 'left',
    on(join) {
      join.andOn(function preferredLocation() {
        this.on('cl.is_billing_address', '=', knexOrTrx.raw('true'))
          .orOn('cl.is_default', '=', knexOrTrx.raw('true'));
      });
    },
  });
  const tenantClient = await tenantClientQuery.first<Record<string, unknown>>();
  const brandingLogoUrl = await fetchBrandingDocumentLogoUrl(knexOrTrx, tenant);

  if (tenantClient?.client_id) {
    const logoUrl = brandingLogoUrl
      ?? await getClientDocumentLogoUrl(String(tenantClient.client_id), tenant).catch(() => null);

    return {
      name: asTrimmedString(tenantClient.client_name) || 'Your Company',
      address: buildAddress(tenantClient),
      email: asTrimmedString(tenantClient.email) || null,
      phone: asTrimmedString(tenantClient.phone) || null,
      logo_url: logoUrl || null,
    };
  }

  const tenantRecord = await db.table('tenants')
    .select('client_name')
    .first<Record<string, unknown>>();

  const tenantName = asTrimmedString(tenantRecord?.client_name);
  if (!tenantName) {
    return null;
  }

  return {
    name: tenantName,
    address: null,
    email: null,
    phone: null,
    logo_url: brandingLogoUrl,
  };
}
