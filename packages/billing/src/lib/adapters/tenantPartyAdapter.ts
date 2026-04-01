import type { Knex } from 'knex';
import { getClientLogoUrl } from '@alga-psa/formatting/avatarUtils';

const asTrimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const buildAddress = (record: Record<string, unknown> | null | undefined): string | null => {
  if (!record) {
    return null;
  }

  const parts = [
    record.address_line1,
    record.address_line2,
    record.address_line3,
    record.city,
    record.state_province,
    record.postal_code,
    record.country_name,
    record.location_address,
    record.address,
  ]
    .map(asTrimmedString)
    .filter((value, index, collection) => value.length > 0 && collection.indexOf(value) === index);

  return parts.length > 0 ? parts.join(', ') : null;
};

export interface TenantParty {
  name: string;
  address: string | null;
  email: string | null;
  phone: string | null;
  logo_url: string | null;
}

export async function fetchTenantParty(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string
): Promise<TenantParty | null> {
  const tenantClient = await knexOrTrx('tenant_companies as tc')
    .join('clients as c', function joinClients() {
      this.on('tc.client_id', '=', 'c.client_id').andOn('tc.tenant', '=', 'c.tenant');
    })
    .leftJoin('client_locations as cl', function joinLocations() {
      this.on('c.client_id', '=', 'cl.client_id')
        .andOn('c.tenant', '=', 'cl.tenant')
        .andOn(function preferredLocation() {
          this.on('cl.is_billing_address', '=', knexOrTrx.raw('true'))
            .orOn('cl.is_default', '=', knexOrTrx.raw('true'));
        });
    })
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
    .where({ 'tc.tenant': tenant, 'tc.is_default': true })
    .whereNull('tc.deleted_at')
    .orderByRaw('cl.is_billing_address DESC NULLS LAST, cl.is_default DESC NULLS LAST')
    .first<Record<string, unknown>>();

  if (tenantClient?.client_id) {
    const logoUrl = await getClientLogoUrl(String(tenantClient.client_id), tenant).catch(() => null);

    return {
      name: asTrimmedString(tenantClient.client_name) || 'Your Company',
      address: buildAddress(tenantClient),
      email: asTrimmedString(tenantClient.email) || null,
      phone: asTrimmedString(tenantClient.phone) || null,
      logo_url: logoUrl || null,
    };
  }

  const tenantRecord = await knexOrTrx('tenants')
    .select('client_name')
    .where({ tenant })
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
    logo_url: null,
  };
}
