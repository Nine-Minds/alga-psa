/**
 * The date pattern a country writes, independent of the language it is read in.
 *
 * Digit order, separator and 12/24h clock are properties of WHERE a tenant is,
 * not of which language they picked: a German-speaking user in Australia still
 * reads 22/11/2033, and an English-speaking user in Germany still reads
 * 22.11.2033. Language contributes only names — months, weekdays — which the
 * central formatters keep taking from Intl in the translation language.
 *
 * The table is derived from CLDR's short numeric date and preferred hour cycle
 * for each country's dominant locale, generated once over the `countries`
 * reference set and checked in rather than resolved at runtime. Asking ICU for
 * a region on its own does not work: `Intl.DateTimeFormat('und-AU')` silently
 * root-falls-back and answers 11/22/2033, and composing language+country
 * ('de-AU') hands the order back to the language, which is the very coupling
 * this module exists to break. A checked-in table also renders identically on
 * the server, in the browser and on a mobile device whose ICU build differs.
 */

export type DateFieldPart = 'day' | 'month' | 'year';

export interface CountryDateFormat {
  /** ISO 3166-1 alpha-2 the shape came from; null when the fixed default applied. */
  country: string | null;
  /** Which of day/month/year is written first, second, third. */
  order: DateFieldPart[];
  /** Character written between the numeric parts. */
  separator: string;
  /** True for a 12-hour dial with AM/PM, false for 24h. */
  hour12: boolean;
  /** date-fns numeric date pattern, e.g. 'dd/MM/yyyy'. */
  datePattern: string;
  /** date-fns numeric date+time pattern, e.g. 'dd/MM/yyyy HH:mm'. */
  dateTimePattern: string;
}

type ShapeId =
  | 'DMY_SLASH_12'
  | 'DMY_SLASH_24'
  | 'DMY_DOT_24'
  | 'MDY_SLASH_12'
  | 'YMD_DASH_24'
  | 'YMD_SLASH_24'
  | 'DMY_DASH_24'
  | 'YMD_DASH_12'
  | 'YMD_SLASH_12'
  | 'YMD_DOT_24'
  | 'YMD_DOT_12'
  | 'DMY_DOT_12'
  | 'DMY_DASH_12'
  | 'YDM_DASH_24';

const ORDERS: Record<string, DateFieldPart[]> = {
  DMY: ['day', 'month', 'year'],
  MDY: ['month', 'day', 'year'],
  YMD: ['year', 'month', 'day'],
  YDM: ['year', 'day', 'month'],
};

const SEPARATORS: Record<string, string> = {
  SLASH: '/',
  DOT: '.',
  DASH: '-',
};

const PART_TOKENS: Record<DateFieldPart, string> = {
  day: 'dd',
  month: 'MM',
  year: 'yyyy',
};

/** Countries grouped by the shape they write. Every country in `countries` appears exactly once. */
const COUNTRIES_BY_SHAPE: Record<ShapeId, readonly string[]> = {
  DMY_SLASH_12: [
    'AE', 'AG', 'AR', 'AU', 'BB', 'BD', 'BH', 'BM', 'BN', 'BO', 'BS', 'CC',
    'CO', 'CR', 'CU', 'CY', 'DJ', 'DM', 'DO', 'DZ', 'EC', 'EG', 'EH', 'ET',
    'FJ', 'FM', 'GD', 'GM', 'GR', 'GT', 'GY', 'HK', 'HN', 'IN', 'IQ', 'JM',
    'JO', 'KH', 'KI', 'KN', 'KW', 'KY', 'LB', 'LC', 'LR', 'LY', 'MO', 'MR',
    'MW', 'MX', 'MY', 'NI', 'NZ', 'OM', 'PE', 'PK', 'PS', 'QA', 'SA', 'SB',
    'SD', 'SG', 'SL', 'SO', 'SS', 'SV', 'SY', 'SZ', 'TC', 'TD', 'TN', 'TO',
    'TT', 'UY', 'VC', 'VE', 'VG', 'YE', 'ZM',
  ],
  DMY_SLASH_24: [
    'AD', 'AI', 'AO', 'BE', 'BF', 'BI', 'BJ', 'BL', 'BR', 'BW', 'BZ', 'CD',
    'CG', 'CI', 'CK', 'CM', 'CV', 'CX', 'ES', 'FK', 'FR', 'GA', 'GB', 'GF',
    'GG', 'GI', 'GN', 'GP', 'GQ', 'GS', 'GW', 'ID', 'IE', 'IM', 'IO', 'IT',
    'JE', 'KE', 'KM', 'LA', 'LU', 'MA', 'MC', 'MF', 'ML', 'MM', 'MQ', 'MS',
    'MT', 'MU', 'MZ', 'NC', 'NF', 'NG', 'NR', 'NU', 'PF', 'PM', 'PN', 'PT',
    'RE', 'SC', 'SH', 'SM', 'ST', 'SX', 'TF', 'TG', 'TH', 'TJ', 'TL', 'TZ',
    'UG', 'UZ', 'VA', 'VN', 'WF', 'YT',
  ],
  DMY_DOT_24: [
    'AM', 'AT', 'AZ', 'BA', 'BG', 'BV', 'BY', 'CH', 'CZ', 'DE', 'DK', 'EE',
    'FI', 'FO', 'GE', 'HR', 'IL', 'IS', 'KZ', 'LI', 'LV', 'MD', 'ME', 'MK',
    'NO', 'PL', 'RO', 'RS', 'RU', 'SI', 'SJ', 'SK', 'TM', 'TR', 'UA',
  ],
  MDY_SLASH_12: [
    'AQ', 'AS', 'BQ', 'CW', 'ER', 'GU', 'HM', 'HT', 'MH', 'MP', 'MV', 'PA',
    'PG', 'PH', 'PR', 'PW', 'PY', 'TK', 'TV', 'UM', 'US', 'VI', 'VU', 'WS',
  ],
  YMD_DASH_24: ['AX', 'CF', 'GL', 'LK', 'LT', 'MG', 'NE', 'NP', 'RW', 'SE', 'ZW'],
  YMD_SLASH_24: ['AF', 'CN', 'IR', 'JP', 'ZA'],
  DMY_DASH_24: ['AW', 'NL', 'SN', 'SR'],
  YMD_DASH_12: ['BT', 'CA', 'LS', 'NA'],
  YMD_SLASH_12: ['GH', 'TW'],
  YMD_DOT_24: ['HU', 'MN'],
  YMD_DOT_12: ['KP', 'KR'],
  DMY_DOT_12: ['AL'],
  DMY_DASH_12: ['CL'],
  YDM_DASH_24: ['KG'],
};

function buildShape(id: ShapeId, country: string | null): CountryDateFormat {
  const [orderKey, separatorKey, clock] = id.split('_');
  const order = ORDERS[orderKey];
  const separator = SEPARATORS[separatorKey];
  const hour12 = clock === '12';
  const datePattern = order.map((part) => PART_TOKENS[part]).join(separator);

  return {
    country,
    order: [...order],
    separator,
    hour12,
    datePattern,
    dateTimePattern: `${datePattern} ${hour12 ? 'h:mm a' : 'HH:mm'}`,
  };
}

/**
 * What we render when the country is unknown, unset or the 'XX' placeholder.
 *
 * Deliberately fixed rather than language-derived: a tenant who never entered a
 * country must not have their dates shuffled by switching the UI to French.
 * US-style, matching the ticketing default ('MMM d, yyyy h:mm a') this replaces.
 */
export const SYSTEM_DATE_FORMAT: CountryDateFormat = Object.freeze(
  buildShape('MDY_SLASH_12', null),
) as CountryDateFormat;

const SHAPE_BY_COUNTRY: Map<string, ShapeId> = new Map(
  (Object.entries(COUNTRIES_BY_SHAPE) as Array<[ShapeId, readonly string[]]>)
    .flatMap(([shape, countries]) => countries.map((code) => [code, shape] as [string, ShapeId])),
);

/** The placeholder code stored by tenants who never entered a country. */
const PLACEHOLDER_COUNTRY = 'XX';

/**
 * The date shape a country writes.
 *
 * Anything we cannot place — null, blank, 'XX', a name instead of a code,
 * a country outside the reference table — returns the fixed system default
 * rather than a guess.
 */
export function countryDateFormat(countryCode?: string | null): CountryDateFormat {
  if (typeof countryCode !== 'string') return SYSTEM_DATE_FORMAT;

  const code = countryCode.trim().toUpperCase();
  if (!code || code === PLACEHOLDER_COUNTRY || !/^[A-Z]{2}$/.test(code)) {
    return SYSTEM_DATE_FORMAT;
  }

  const shape = SHAPE_BY_COUNTRY.get(code);
  return shape ? buildShape(shape, code) : SYSTEM_DATE_FORMAT;
}

/** Every country code the table covers, for tests and tooling. */
export function coveredCountryCodes(): string[] {
  return [...SHAPE_BY_COUNTRY.keys()];
}
