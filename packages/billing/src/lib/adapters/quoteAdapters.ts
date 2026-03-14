import type { IQuote, QuoteViewModel, QuoteViewModelLineItem, QuoteViewModelParty, QuoteViewModelPhase } from '@alga-psa/types';
import { getClientLogoUrl } from '@alga-psa/formatting/avatarUtils';
import type { Knex } from 'knex';

import Quote from '../../models/quote';

const asTrimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const toFiniteNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

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

const mapQuoteItemToViewModel = (item: NonNullable<IQuote['quote_items']>[number]): QuoteViewModelLineItem => ({
  quote_item_id: item.quote_item_id,
  service_id: item.service_id ?? null,
  service_name: item.service_name ?? null,
  service_sku: item.service_sku ?? null,
  billing_method: item.billing_method ?? null,
  description: item.description,
  quantity: toFiniteNumber(item.quantity),
  unit_price: toFiniteNumber(item.unit_price),
  total_price: toFiniteNumber(item.total_price),
  tax_amount: toFiniteNumber(item.tax_amount),
  net_amount: toFiniteNumber(item.net_amount),
  unit_of_measure: item.unit_of_measure ?? null,
  phase: item.phase ?? null,
  is_optional: Boolean(item.is_optional),
  is_selected: item.is_selected !== false,
  is_recurring: Boolean(item.is_recurring),
  billing_frequency: item.billing_frequency ?? null,
  is_discount: Boolean(item.is_discount),
  discount_type: item.discount_type ?? null,
  discount_percentage: item.discount_percentage ?? null,
  applies_to_item_id: item.applies_to_item_id ?? null,
  applies_to_service_id: item.applies_to_service_id ?? null,
  tax_region: item.tax_region ?? null,
  tax_rate: item.tax_rate ?? null,
});

const buildPhaseViewModels = (items: QuoteViewModelLineItem[]): QuoteViewModelPhase[] => {
  const grouped = new Map<string, QuoteViewModelLineItem[]>();

  for (const item of items) {
    const phaseName = asTrimmedString(item.phase) || 'General';
    const existing = grouped.get(phaseName);
    if (existing) {
      existing.push(item);
    } else {
      grouped.set(phaseName, [item]);
    }
  }

  return Array.from(grouped.entries()).map(([name, phaseItems]) => ({
    name,
    items: phaseItems,
  }));
};

async function fetchClientParty(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  clientId?: string | null
): Promise<QuoteViewModelParty | null> {
  if (!clientId) {
    return null;
  }

  const client = await knexOrTrx('clients as c')
    .leftJoin('client_locations as cl', function joinLocations() {
      this.on('c.client_id', '=', 'cl.client_id')
        .andOn('c.tenant', '=', 'cl.tenant')
        .andOn(function preferredLocation() {
          this.on('cl.is_billing_address', '=', knexOrTrx.raw('true'))
            .orOn('cl.is_default', '=', knexOrTrx.raw('true'));
        });
    })
    .select(
      'c.client_name',
      'c.billing_email',
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
    .where({ 'c.tenant': tenant, 'c.client_id': clientId })
    .orderByRaw('cl.is_billing_address DESC NULLS LAST, cl.is_default DESC NULLS LAST')
    .first<Record<string, unknown>>();

  if (!client) {
    return null;
  }

  const logoUrl = await getClientLogoUrl(clientId, tenant).catch(() => null);

  return {
    name: asTrimmedString(client.client_name) || 'Client',
    address: buildAddress(client),
    email: asTrimmedString(client.billing_email) || asTrimmedString(client.email) || null,
    phone: asTrimmedString(client.phone) || null,
    logo_url: logoUrl || null,
  };
}

async function fetchContactParty(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  contactId?: string | null
): Promise<QuoteViewModelParty | null> {
  if (!contactId) {
    return null;
  }

  const contact = await knexOrTrx('contacts')
    .select('full_name', 'email', 'phone_number')
    .where({ tenant, contact_name_id: contactId })
    .first<Record<string, unknown>>();

  if (!contact) {
    return null;
  }

  return {
    name: asTrimmedString(contact.full_name) || 'Contact',
    email: asTrimmedString(contact.email) || null,
    phone: asTrimmedString(contact.phone_number) || null,
    address: null,
    logo_url: null,
  };
}

async function fetchTenantParty(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string
): Promise<QuoteViewModelParty | null> {
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

export async function mapLoadedQuoteToViewModel(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  quote: IQuote
): Promise<QuoteViewModel> {
  const [client, contact, tenantParty] = await Promise.all([
    fetchClientParty(knexOrTrx, tenant, quote.client_id),
    fetchContactParty(knexOrTrx, tenant, quote.contact_id),
    fetchTenantParty(knexOrTrx, tenant),
  ]);

  const lineItems = (quote.quote_items ?? []).map(mapQuoteItemToViewModel);

  return {
    quote_id: quote.quote_id,
    quote_number: quote.quote_number ?? `Draft ${quote.quote_id}`,
    title: quote.title,
    description: quote.description ?? null,
    scope_of_work: quote.description ?? null,
    quote_date: quote.quote_date ?? null,
    valid_until: quote.valid_until ?? null,
    status: quote.status ?? null,
    version: Number(quote.version ?? 1),
    po_number: quote.po_number ?? null,
    currency_code: quote.currency_code,
    subtotal: toFiniteNumber(quote.subtotal),
    discount_total: toFiniteNumber(quote.discount_total),
    tax: toFiniteNumber(quote.tax),
    total_amount: toFiniteNumber(quote.total_amount),
    terms_and_conditions: quote.terms_and_conditions ?? null,
    client_notes: quote.client_notes ?? null,
    client_id: quote.client_id ?? null,
    contact_id: quote.contact_id ?? null,
    client,
    contact,
    tenant: tenantParty,
    line_items: lineItems,
    phases: buildPhaseViewModels(lineItems),
  };
}

export async function mapDbQuoteToViewModel(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  quoteId: string
): Promise<QuoteViewModel | null> {
  const quote = await Quote.getById(knexOrTrx, tenant, quoteId);

  if (!quote) {
    return null;
  }

  return mapLoadedQuoteToViewModel(knexOrTrx, tenant, quote);
}
