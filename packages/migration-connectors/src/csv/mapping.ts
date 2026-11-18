import { AMP_TABLE_COLUMNS, type AmpEntityType } from '@alga-psa/migration-spec';
import { CLIENT_NAME_COLUMN, FULL_NAME_COLUMN, MONEY_COLUMN_CURRENCY } from './engine';

const MONEY_COLUMNS: ReadonlySet<string> = new Set(Object.keys(MONEY_COLUMN_CURRENCY));
import { parseSpreadsheet } from './parse';

/** Normalized source header -> canonical AMP column (or an engine sentinel). */
type AliasTable = Record<string, string>;

/**
 * Asset aliases, keyed by normalized header. Preserves the legacy asset
 * spellings; the dead `asset tag` entry is deliberately not carried over.
 */
const ASSET_ALIASES: AliasTable = {
  asset_type: 'asset_type_name',
  asset_name: 'name',
  hostname: 'name',
  serial_number: 'serial_number',
  serial: 'serial_number',
};

/**
 * Contacts aliases. `Name`/`Full Name` map to the engine's full-name transform
 * and client/company/account spellings map to the carried client-name column.
 */
const CONTACT_ALIASES: AliasTable = {
  email: 'email',
  email_address: 'email',
  e_mail: 'email',
  first_name: 'first_name',
  firstname: 'first_name',
  given_name: 'first_name',
  last_name: 'last_name',
  lastname: 'last_name',
  surname: 'last_name',
  family_name: 'last_name',
  phone: 'phone',
  phone_number: 'phone',
  telephone: 'phone',
  mobile: 'phone',
  title: 'title',
  job_title: 'title',
  name: FULL_NAME_COLUMN,
  full_name: FULL_NAME_COLUMN,
  client: CLIENT_NAME_COLUMN,
  client_name: CLIENT_NAME_COLUMN,
  company: CLIENT_NAME_COLUMN,
  company_name: CLIENT_NAME_COLUMN,
  account: CLIENT_NAME_COLUMN,
  account_name: CLIENT_NAME_COLUMN,
  organization: CLIENT_NAME_COLUMN,
};

/** Organization aliases: client/company/account spellings all name the client. */
const ORGANIZATION_ALIASES: AliasTable = {
  client: 'name',
  client_name: 'name',
  company: 'name',
  company_name: 'name',
  account: 'name',
  account_name: 'name',
  organization: 'name',
  website: 'website',
  url: 'website',
  phone: 'phone',
  phone_number: 'phone',
};

/**
 * Product aliases for distributor and price-list exports. Money headers map to
 * the `*_minor` columns; the engine reads those cells as major-unit decimals.
 */
const PRODUCT_ALIASES: AliasTable = {
  product_name: 'name',
  item_name: 'name',
  item: 'name',
  product: 'name',
  title: 'name',
  part_description: 'description',
  item_description: 'description',
  product_description: 'description',
  sku: 'sku',
  item_number: 'sku',
  item_no: 'sku',
  item_id: 'sku',
  part_number: 'sku',
  part_no: 'sku',
  part: 'sku',
  mpn: 'sku',
  manufacturer_part_number: 'sku',
  category: 'category_name',
  product_category: 'category_name',
  product_type: 'category_name',
  uom: 'unit_of_measure',
  unit: 'unit_of_measure',
  unit_of_measure: 'unit_of_measure',
  list_price: 'price_minor',
  msrp: 'price_minor',
  price: 'price_minor',
  sell_price: 'price_minor',
  retail_price: 'price_minor',
  unit_price: 'price_minor',
  currency: 'price_currency',
  price_currency: 'price_currency',
  cost: 'cost_minor',
  unit_cost: 'cost_minor',
  dealer_cost: 'cost_minor',
  buy_price: 'cost_minor',
  cost_currency: 'cost_currency',
  active: 'is_active',
  is_active: 'is_active',
  enabled: 'is_active',
};

/** Vendor price-list aliases: one row per (vendor, product) offer. */
const VENDOR_PRODUCT_ALIASES: AliasTable = {
  vendor: 'vendor_name',
  vendor_name: 'vendor_name',
  supplier: 'vendor_name',
  supplier_name: 'vendor_name',
  distributor: 'vendor_name',
  distributor_name: 'vendor_name',
  sku: 'product_sku',
  our_sku: 'product_sku',
  product_sku: 'product_sku',
  item_number: 'product_sku',
  item_no: 'product_sku',
  part_number: 'product_sku',
  part_no: 'product_sku',
  part: 'product_sku',
  mpn: 'product_sku',
  manufacturer_part_number: 'product_sku',
  vendor_sku: 'vendor_sku',
  vendor_part_number: 'vendor_sku',
  vendor_part_no: 'vendor_sku',
  vendor_item_number: 'vendor_sku',
  supplier_sku: 'vendor_sku',
  supplier_part_number: 'vendor_sku',
  distributor_sku: 'vendor_sku',
  cost: 'unit_cost_minor',
  unit_cost: 'unit_cost_minor',
  dealer_cost: 'unit_cost_minor',
  buy_price: 'unit_cost_minor',
  price: 'unit_cost_minor',
  currency: 'cost_currency',
  cost_currency: 'cost_currency',
  lead_time: 'lead_time_days',
  lead_time_days: 'lead_time_days',
  preferred: 'is_preferred',
  is_preferred: 'is_preferred',
  preferred_vendor: 'is_preferred',
};

const ENTITY_ALIASES: Partial<Record<AmpEntityType, AliasTable>> = {
  assets: ASSET_ALIASES,
  contacts: CONTACT_ALIASES,
  organizations: ORGANIZATION_ALIASES,
  products: PRODUCT_ALIASES,
  vendor_products: VENDOR_PRODUCT_ALIASES,
};

/** Lowercase and collapse spaces/underscores/hyphens into a single underscore. */
function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[#.]/g, '')
    .replace(/[\s_-]+/g, '_')
    .replace(/_\((.*?)\)/g, '_$1')
    .replace(/[()]/g, '')
    .replace(/^_+|_+$/g, '');
}

/**
 * Maps canonical and legacy headers per entity; unmatched source columns are
 * preserved as bounded AMP diagnostics. Separator-insensitive, so `First Name`,
 * `first_name`, and `first-name` all resolve to the same target.
 */
export async function inferSpreadsheetMapping(path: string, entityType: AmpEntityType): Promise<Record<string, string>> {
  const { headers } = await parseSpreadsheet(path);
  const allowed = new Set(AMP_TABLE_COLUMNS[entityType]);
  const aliases = ENTITY_ALIASES[entityType] ?? {};
  const specials = entityType === 'contacts' ? new Set([FULL_NAME_COLUMN, CLIENT_NAME_COLUMN]) : new Set<string>();
  return Object.fromEntries(
    headers.flatMap((header) => {
      const normalized = normalizeHeader(header);
      // `*_minor` headers are ambiguous in a spreadsheet (cells hold decimal
      // major units), so money columns resolve only through explicit aliases.
      const exact = allowed.has(normalized) && !MONEY_COLUMNS.has(normalized) ? normalized : undefined;
      const target = exact ?? aliases[normalized];
      if (!target) {
        return [];
      }
      if (allowed.has(target) || specials.has(target)) {
        return [[header, target]];
      }
      return [];
    })
  );
}
