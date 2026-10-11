/**
 * Shared IANA time zone helpers: storable-zone validation, zone descriptors
 * (DST observance, abbreviations, names) and picker search ranking.
 *
 * Plain `Intl` code with no React, so server actions, the REST schema and the
 * UI can all use it. Reads elsewhere stay lenient (`normalizeIanaTimeZone`);
 * only values being *written* go through `validateStorableTimeZone`.
 */
import { windowsTimeZones } from './windowsTimeZones';

export const GEOGRAPHIC_TIME_ZONE_AREAS: readonly string[] = [
  'Africa',
  'America',
  'Antarctica',
  'Arctic',
  'Asia',
  'Atlantic',
  'Australia',
  'Europe',
  'Indian',
  'Pacific',
];

/** Spellings of UTC that are stored as plain `UTC`. Compared case-insensitively. */
export const UTC_TIME_ZONE_ALIASES: readonly string[] = [
  'UTC',
  'Etc/UTC',
  'Etc/UCT',
  'Etc/Universal',
  'Etc/Zulu',
  'UCT',
  'Universal',
  'Zulu',
  'GMT',
  'Etc/GMT',
  'Etc/GMT0',
  'Etc/GMT+0',
  'Etc/GMT-0',
  'GMT0',
  'Greenwich',
  'Etc/Greenwich',
];

const UTC_ALIAS_SET: ReadonlySet<string> = new Set(UTC_TIME_ZONE_ALIASES.map((a) => a.toLowerCase()));
const GEOGRAPHIC_AREA_SET: ReadonlySet<string> = new Set(GEOGRAPHIC_TIME_ZONE_AREAS.map((a) => a.toLowerCase()));

export type StorableTimeZoneResult =
  | { ok: true; timeZone: string | null }
  | { ok: false; reason: 'unrecognized' | 'not_location'; input: string };

const isRecognizedByIntl = (timeZone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
};

/**
 * Decide whether a time zone may be stored as a user or tenant timezone.
 *
 * - Empty / null / undefined → `{ ok: true, timeZone: null }` (callers decide whether null is allowed).
 * - UTC aliases (`Etc/UTC`, `GMT`, ...) → `'UTC'`.
 * - `Area/Location` IDs in a geographic area that `Intl` recognises → unchanged.
 * - Everything else (`EST`, `Etc/GMT+5`, `US/Eastern`, `SystemV/*`, ...) → `not_location`.
 * - IDs `Intl` does not know at all → `unrecognized`.
 */
export function validateStorableTimeZone(input: string | null | undefined): StorableTimeZoneResult {
  const trimmed = typeof input === 'string' ? input.trim() : '';
  if (!trimmed) {
    return { ok: true, timeZone: null };
  }

  if (!isRecognizedByIntl(trimmed)) {
    return { ok: false, reason: 'unrecognized', input: trimmed };
  }

  if (UTC_ALIAS_SET.has(trimmed.toLowerCase())) {
    return { ok: true, timeZone: 'UTC' };
  }

  const slash = trimmed.indexOf('/');
  const area = slash > 0 ? trimmed.slice(0, slash) : '';
  if (!area || slash === trimmed.length - 1 || !GEOGRAPHIC_AREA_SET.has(area.toLowerCase())) {
    return { ok: false, reason: 'not_location', input: trimmed };
  }

  return { ok: true, timeZone: trimmed };
}

// ---------------------------------------------------------------------------
// Descriptors
// ---------------------------------------------------------------------------

export interface TimeZoneDescriptor {
  id: string;
  /** First path segment of the ID (`America`), or `Etc` for UTC. */
  area: string;
  observesDst: boolean;
  /** `shortOffset` of the standard phase, e.g. `GMT-5`. */
  standardOffset: string;
  /** `shortOffset` of the daylight phase (equals `standardOffset` for fixed zones). */
  daylightOffset: string;
  /** Every short / generic-short abbreviation for both phases, in both locales, deduplicated. */
  abbreviations: string[];
  /** Every long / generic-long name for both phases, in both locales, deduplicated. */
  names: string[];
  /** en-US `short` abbreviation in the standard phase, e.g. `EST`. */
  standardAbbreviation: string;
  /** Generic long name for DST zones (`Eastern Time`), standard-phase long name for fixed zones. User locale. */
  displayName: string;
  /** Abbreviations to show on a row in the user's locale: `[standard, daylight]` for DST zones, `[single]` otherwise. */
  displayAbbreviations: string[];
  /** True when this zone is the CLDR default zone for its en-US standard-phase name. */
  primary: boolean;
  /** True when the zone is a CLDR Windows-to-IANA default (non-Etc). */
  preferred: boolean;
}

export interface DescribeTimeZoneOptions {
  locale?: string;
  referenceDate?: Date;
}

type NameStyle = 'short' | 'shortGeneric' | 'long' | 'longGeneric' | 'shortOffset';

const FALLBACK_LOCALE = 'en-US';

const formatterCache = new Map<string, Intl.DateTimeFormat | null>();

const getFormatter = (locale: string, timeZone: string, style: NameStyle): Intl.DateTimeFormat | null => {
  const key = `${locale}|${timeZone}|${style}`;
  if (formatterCache.has(key)) {
    return formatterCache.get(key) ?? null;
  }
  let formatter: Intl.DateTimeFormat | null = null;
  try {
    formatter = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: style });
  } catch {
    formatter = null;
  }
  formatterCache.set(key, formatter);
  return formatter;
};

const readName = (locale: string, timeZone: string, style: NameStyle, date: Date): string => {
  const formatter = getFormatter(locale, timeZone, style);
  if (!formatter) return '';
  try {
    return formatter.formatToParts(date).find((p) => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
};

const resolvedCache = new Map<string, string>();

const resolveIntlTimeZone = (timeZone: string): string => {
  const cached = resolvedCache.get(timeZone);
  if (cached !== undefined) return cached;
  let resolved = timeZone;
  try {
    resolved = new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone;
  } catch {
    // keep raw
  }
  resolvedCache.set(timeZone, resolved);
  return resolved;
};

/** `GMT-5` → -300, `GMT+5:30` → 330, `GMT` → 0. Unparseable → 0. */
const parseShortOffsetMinutes = (offset: string): number => {
  const match = /^(?:GMT|UTC)(?:([+−-])(\d{1,2})(?::(\d{2}))?)?$/.exec(offset.trim());
  if (!match || !match[1]) return 0;
  const sign = match[1] === '+' ? 1 : -1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0));
};

const isEtcZone = (zone: string): boolean => zone.startsWith('Etc/');

const buildPreferredSet = (): ReadonlySet<string> => {
  const set = new Set<string>();
  for (const zone of Object.values(windowsTimeZones)) {
    if (isEtcZone(zone)) continue;
    set.add(zone);
    set.add(resolveIntlTimeZone(zone));
  }
  return set;
};

/** CLDR Windows-to-IANA default zones (non-Etc), plus their `Intl`-resolved forms. */
export const PREFERRED_TIME_ZONES: ReadonlySet<string> = buildPreferredSet();

const isPrimaryFor = (zoneId: string, standardLongName: string): boolean => {
  const mapped = windowsTimeZones[standardLongName];
  if (!mapped) return false;
  return mapped === zoneId || resolveIntlTimeZone(mapped) === resolveIntlTimeZone(zoneId);
};

const pushUnique = (target: string[], value: string) => {
  if (value && !target.includes(value)) target.push(value);
};

/**
 * Describe a zone using its January and July phases of the reference year, so
 * labels and search results do not depend on today's date. A zone observes DST
 * when the two offsets differ. The standard phase is the one with the smaller
 * UTC offset.
 */
export function describeTimeZone(id: string, options: DescribeTimeZoneOptions = {}): TimeZoneDescriptor {
  const referenceDate = options.referenceDate ?? new Date();
  const year = referenceDate.getUTCFullYear();
  const january = new Date(Date.UTC(year, 0, 15, 12));
  const july = new Date(Date.UTC(year, 6, 15, 12));

  const requested = options.locale || FALLBACK_LOCALE;
  const locales = requested === FALLBACK_LOCALE ? [FALLBACK_LOCALE] : [requested, FALLBACK_LOCALE];
  // `locale` may be unusable (invalid tag); the formatter cache yields '' and en-US still covers it.

  const janOffset = readName(FALLBACK_LOCALE, id, 'shortOffset', january);
  const julOffset = readName(FALLBACK_LOCALE, id, 'shortOffset', july);
  const observesDst = janOffset !== julOffset;

  const janIsStandard = parseShortOffsetMinutes(janOffset) <= parseShortOffsetMinutes(julOffset);
  const standardDate = janIsStandard ? january : july;
  const daylightDate = janIsStandard ? july : january;
  const standardOffset = janIsStandard ? janOffset : julOffset;
  const daylightOffset = janIsStandard ? julOffset : janOffset;

  const abbreviations: string[] = [];
  const names: string[] = [];
  for (const locale of locales) {
    for (const date of [standardDate, daylightDate]) {
      pushUnique(abbreviations, readName(locale, id, 'short', date));
      pushUnique(abbreviations, readName(locale, id, 'shortGeneric', date));
      pushUnique(names, readName(locale, id, 'long', date));
      pushUnique(names, readName(locale, id, 'longGeneric', date));
    }
  }

  const standardAbbreviation = readName(FALLBACK_LOCALE, id, 'short', standardDate);
  const standardLongEn = readName(FALLBACK_LOCALE, id, 'long', standardDate);

  const userLocale = locales[0];
  const standardLongUser = readName(userLocale, id, 'long', standardDate) || standardLongEn;
  const genericLongUser = readName(userLocale, id, 'longGeneric', standardDate);
  const displayName = observesDst ? genericLongUser || standardLongUser : standardLongUser;

  const standardShortUser = readName(userLocale, id, 'short', standardDate) || standardAbbreviation;
  const displayAbbreviations: string[] = [];
  pushUnique(displayAbbreviations, standardShortUser);
  if (observesDst) {
    pushUnique(displayAbbreviations, readName(userLocale, id, 'short', daylightDate));
  }

  const slash = id.indexOf('/');
  const area = slash > 0 ? id.slice(0, slash) : 'Etc';

  return {
    id,
    area,
    observesDst,
    standardOffset,
    daylightOffset,
    abbreviations,
    names,
    standardAbbreviation,
    displayName,
    displayAbbreviations,
    primary: isPrimaryFor(id, standardLongEn),
    preferred: PREFERRED_TIME_ZONES.has(id) || PREFERRED_TIME_ZONES.has(resolveIntlTimeZone(id)),
  };
}

// ---------------------------------------------------------------------------
// Search ranking
// ---------------------------------------------------------------------------

export interface TimeZoneSearchResult {
  bestMatches: TimeZoneDescriptor[];
  otherMatches: TimeZoneDescriptor[];
}

const MIN_NAME_QUERY_LENGTH = 3;

const normalizeQuery = (query: string): string => query.trim().toLowerCase().replace(/_/g, ' ');

const scoreNameMatch = (descriptor: TimeZoneDescriptor, query: string): number => {
  if (descriptor.standardAbbreviation.toLowerCase() === query) return 5;

  let best = 0;
  for (const abbreviation of descriptor.abbreviations) {
    if (abbreviation.toLowerCase() === query) {
      best = 4;
      break;
    }
  }
  if (best) return best;

  const allowPartial = query.length >= MIN_NAME_QUERY_LENGTH;
  for (const name of descriptor.names) {
    const lower = name.toLowerCase();
    if (lower === query) return 3;
    if (!allowPartial) continue;
    if (lower.startsWith(query)) best = Math.max(best, 2);
    else if (lower.includes(query)) best = Math.max(best, 1);
  }
  return best;
};

const matchesIdentifier = (descriptor: TimeZoneDescriptor, query: string): boolean =>
  descriptor.id.toLowerCase().replace(/_/g, ' ').includes(query);

const compareRanked = (
  a: { descriptor: TimeZoneDescriptor; score: number },
  b: { descriptor: TimeZoneDescriptor; score: number },
): number => {
  if (a.score !== b.score) return b.score - a.score;
  const da = a.descriptor;
  const db = b.descriptor;
  if (da.observesDst !== db.observesDst) return da.observesDst ? -1 : 1;
  if (da.primary !== db.primary) return da.primary ? -1 : 1;
  if (da.preferred !== db.preferred) return da.preferred ? -1 : 1;
  return da.id < db.id ? -1 : da.id > db.id ? 1 : 0;
};

/**
 * Rank descriptors for a picker search.
 *
 * `bestMatches` are zones matched by a time zone *name* (abbreviation or long
 * name), sorted by match quality, then DST-observing before fixed-offset, then
 * primary, then preferred, then ID. `otherMatches` are zones matched only by
 * ID / city / region substring, in input order; the caller groups them.
 * An empty query returns everything in `otherMatches`.
 */
export function rankTimeZoneSearch(descriptors: readonly TimeZoneDescriptor[], query: string): TimeZoneSearchResult {
  const normalized = normalizeQuery(query);
  if (!normalized) {
    return { bestMatches: [], otherMatches: [...descriptors] };
  }

  const scored: { descriptor: TimeZoneDescriptor; score: number }[] = [];
  const otherMatches: TimeZoneDescriptor[] = [];

  for (const descriptor of descriptors) {
    const score = scoreNameMatch(descriptor, normalized);
    if (score > 0) {
      scored.push({ descriptor, score });
    } else if (matchesIdentifier(descriptor, normalized)) {
      otherMatches.push(descriptor);
    }
  }

  scored.sort(compareRanked);
  return { bestMatches: scored.map((s) => s.descriptor), otherMatches };
}
