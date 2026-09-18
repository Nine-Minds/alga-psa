import { AMP_TABLE_COLUMNS, type AmpEntityType } from '@alga-psa/migration-spec';
import { CLIENT_NAME_COLUMN, FULL_NAME_COLUMN } from './engine';
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

const ENTITY_ALIASES: Partial<Record<AmpEntityType, AliasTable>> = {
  assets: ASSET_ALIASES,
  contacts: CONTACT_ALIASES,
  organizations: ORGANIZATION_ALIASES,
};

/** Lowercase and collapse spaces/underscores/hyphens into a single underscore. */
function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s_-]+/g, '_');
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
      const target = allowed.has(normalized) ? normalized : aliases[normalized];
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
