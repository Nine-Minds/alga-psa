/**
 * Server-only loader and field projection for the public (email-link) quote
 * review page.
 *
 * SECURITY: the public page is reachable with nothing but a bearer token, so
 * what it exposes is an explicit allow-list built here. Everything not named in
 * the `PUBLIC_QUOTE_*_FIELDS` lists is dropped: no cost / cost_currency,
 * internal_notes, created_by / updated_by / accepted_by (user ids), contact and
 * client ids, converted contract / invoice ids, opportunity id, activities,
 * tax-resolution inputs, or any other MSP-only column.
 *
 * Note: the authenticated portal action (getClientQuoteById) returns the whole
 * Quote.getById() row, so there is no existing client-facing projection to
 * reuse; this module is that projection, written as an allow-list so a new
 * column never leaks by default.
 */
import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IQuote, IQuoteItem } from '@alga-psa/types';
import Quote from '../models/quote';
import QuoteActivity from '../models/quoteActivity';
import { resolveEmailLocale } from '@alga-psa/notifications/notifications/emailLocaleResolver';
import { QUOTE_ACTIVITY_TYPES } from '../lib/quoteActivityTypes';
import { resolveQuoteItemTaxesIfIncluded } from './quoteCalculationService';

export const PUBLIC_QUOTE_FIELDS = [
  'quote_id',
  'quote_number',
  'title',
  'description',
  'quote_date',
  'valid_until',
  'status',
  'po_number',
  'currency_code',
  'subtotal',
  'discount_total',
  'tax',
  'total_amount',
  'client_notes',
  'terms_and_conditions',
  'terms_and_conditions_block',
] as const satisfies ReadonlyArray<keyof IQuote>;

export const PUBLIC_QUOTE_ITEM_FIELDS = [
  'quote_item_id',
  'description',
  'quantity',
  'unit_price',
  'total_price',
  'display_order',
  'is_optional',
  'is_selected',
  'is_discount',
  'location_id',
  // Server-resolved per-row tax input for the live optional-item preview (a number, no tenant data).
  'tax_amount_if_included',
] as const satisfies ReadonlyArray<keyof IQuoteItem>;

export const PUBLIC_QUOTE_LOCATION_FIELDS = [
  'location_id',
  'location_name',
  'address_line1',
  'address_line2',
  'address_line3',
  'city',
  'state_province',
  'postal_code',
  'country_code',
  'country_name',
] as const;

export type PublicQuote = Pick<IQuote, (typeof PUBLIC_QUOTE_FIELDS)[number]>;
export type PublicQuoteItem = Pick<IQuoteItem, (typeof PUBLIC_QUOTE_ITEM_FIELDS)[number]>;
export type PublicQuoteLocation = {
  [K in (typeof PUBLIC_QUOTE_LOCATION_FIELDS)[number]]?: string | null;
} & { location_id: string };

export interface PublicQuoteView {
  quote: PublicQuote;
  items: PublicQuoteItem[];
  locations: PublicQuoteLocation[];
}

function pick<T extends object, K extends keyof T>(source: T, keys: ReadonlyArray<K>): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const key of keys) {
    // Normalise undefined to null so the result is JSON-serialisable and stable.
    (out as any)[key] = (source as any)[key] === undefined ? null : (source as any)[key];
  }
  return out;
}

const toIso = (value: unknown): unknown =>
  value instanceof Date ? value.toISOString() : value;

/** Pure allow-list projection. Dates become ISO strings so the result can cross the RSC boundary. */
export function projectPublicQuote(quote: IQuote): PublicQuote {
  const projected = pick(quote, PUBLIC_QUOTE_FIELDS) as any;
  projected.quote_date = toIso(projected.quote_date);
  projected.valid_until = toIso(projected.valid_until);
  return projected as PublicQuote;
}

export function projectPublicQuoteItems(items: ReadonlyArray<IQuoteItem>): PublicQuoteItem[] {
  return items.map((item) => pick(item, PUBLIC_QUOTE_ITEM_FIELDS));
}

/** Loads the quote the way the portal does (Quote.getById) and returns only the allow-listed view. */
export async function loadPublicQuoteView(
  knex: Knex | Knex.Transaction,
  tenant: string,
  quoteId: string,
): Promise<PublicQuoteView | null> {
  const quote = await Quote.getById(knex, tenant, quoteId);
  // Templates and drafts are never client-facing (mirrors getAuthorizedClientQuote).
  if (!quote || quote.is_template || quote.status === 'draft') {
    return null;
  }

  // Server-resolved per-row tax for the live optional-item preview (not a DB column), same as
  // getClientQuoteById. Runs on the caller's knex/trx, so the submit path computes it inside its
  // locked transaction. Values are plain numbers (Map<string, number>), safe for canonicalJson.
  // The item tax is part of the hashed view (see fingerprintPublicQuoteView): the signature binds
  // to the tax inputs the signer saw, and a tax-rate change between render and submit yields `changed`.
  let sourceItems: IQuoteItem[] = quote.quote_items ?? [];
  if (quote.status === 'sent' && sourceItems.length > 0) {
    const taxByItemId = await resolveQuoteItemTaxesIfIncluded(knex, tenant, quoteId);
    sourceItems = sourceItems.map((item) =>
      taxByItemId.has(item.quote_item_id)
        ? { ...item, tax_amount_if_included: Number(taxByItemId.get(item.quote_item_id)) }
        : item,
    );
  }
  const items = projectPublicQuoteItems(sourceItems);

  const locationIds = Array.from(
    new Set(items.map((i) => i.location_id).filter((id): id is string => Boolean(id && id.trim()))),
  );
  let locations: PublicQuoteLocation[] = [];
  if (quote.client_id && locationIds.length > 0) {
    locations = await tenantDb(knex, tenant)
      .table('client_locations')
      .select(...PUBLIC_QUOTE_LOCATION_FIELDS)
      .where({ client_id: quote.client_id })
      .whereIn('location_id', locationIds);
  }

  return { quote: projectPublicQuote(quote), items, locations };
}

/**
 * Canonical JSON: object keys sorted recursively, so equal content always serialises
 * identically. Values with a toJSON (Date, and anything alike) serialise through it
 * first; any other non-plain object (Map, Set, class instance, ...) throws rather than
 * silently hashing as '{}', so a new column type can never be dropped from the signed content.
 */
function canonicalJson(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (typeof value === 'object' && typeof (value as { toJSON?: unknown }).toJSON === 'function') {
    return canonicalJson((value as { toJSON: () => unknown }).toJSON());
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new TypeError(`canonicalJson: unsupported non-plain object ${(value as object).constructor?.name ?? 'unknown'}`);
    }
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
  }
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (typeof value === 'function' || typeof value === 'symbol') {
    throw new TypeError(`canonicalJson: unsupported ${typeof value}`);
  }
  return JSON.stringify(value);
}

/**
 * Pure: sha256 over everything the public page shows - the quote fields, the items
 * (stable order) and the locations (sorted by location_id).
 */
export function fingerprintPublicQuoteView(view: Pick<PublicQuoteView, 'quote' | 'items' | 'locations'>): string {
  const items = [...view.items].sort(
    (a, b) =>
      (Number(a.display_order) || 0) - (Number(b.display_order) || 0) ||
      String(a.quote_item_id).localeCompare(String(b.quote_item_id)),
  );
  const locations = [...(view.locations ?? [])].sort((a, b) =>
    String(a.location_id).localeCompare(String(b.location_id)),
  );
  return createHash('sha256').update(canonicalJson({ quote: view.quote, items, locations }), 'utf8').digest('hex');
}

/**
 * Content fingerprint of the full public view of a quote - quote, items and locations (null if it is not client-facing).
 * The public page and the decision submit both use this one function, so a signature can
 * only bind to the content that was rendered. Deliberately not based on updated_at.
 */
export async function computePublicQuoteFingerprint(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  quoteId: string,
): Promise<string | null> {
  const view = await loadPublicQuoteView(knexOrTrx, tenant, quoteId);
  return view ? fingerprintPublicQuoteView(view) : null;
}

const VIEW_DEBOUNCE_MS = 60_000;

/**
 * Records "viewed via email link" on the quote's activity log, at most once per
 * (link, minute). Call only for a successfully resolved link. The token is never
 * recorded; the link id and recipient email identify who opened it.
 *
 * Returns true when an entry was written.
 */
export async function recordQuoteViewedViaEmailLink(
  knex: Knex | Knex.Transaction,
  tenant: string,
  input: { quoteId: string; linkId: string; recipientEmail: string; now?: Date },
): Promise<boolean> {
  const since = new Date((input.now ?? new Date()).getTime() - VIEW_DEBOUNCE_MS);

  const recent = await tenantDb(knex, tenant)
    .table('quote_activities')
    .where({ quote_id: input.quoteId, activity_type: QUOTE_ACTIVITY_TYPES.viewedViaEmailLink })
    .whereRaw(`metadata->>'link_id' = ?`, [input.linkId])
    .where('created_at', '>', since)
    .first();
  if (recent) {
    return false;
  }

  await QuoteActivity.create(knex, tenant, {
    quote_id: input.quoteId,
    activity_type: QUOTE_ACTIVITY_TYPES.viewedViaEmailLink,
    description: 'Quote viewed via email link',
    performed_by: null,
    metadata: { link_id: input.linkId, recipient_email: input.recipientEmail },
  });
  return true;
}

/**
 * Locale for the page: the recipient contact's client default, then the
 * client-portal default, then the org default (same hierarchy the portal
 * invitation emails use). Never throws; falls back to the app default.
 */
export async function resolveQuoteRecipientLocale(
  knex: Knex | Knex.Transaction,
  tenant: string,
  recipient: { contactId: string | null; email: string },
): Promise<string> {
  try {
    let clientId: string | undefined;
    if (recipient.contactId) {
      const contact = await tenantDb(knex, tenant)
        .table('contacts')
        .where({ contact_name_id: recipient.contactId })
        .first('client_id');
      clientId = contact?.client_id ?? undefined;
    }
    return await resolveEmailLocale(tenant, {
      email: recipient.email,
      userType: 'client',
      ...(clientId ? { clientId } : {}),
    });
  } catch {
    return 'en';
  }
}
