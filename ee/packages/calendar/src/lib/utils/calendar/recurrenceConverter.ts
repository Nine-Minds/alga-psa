/**
 * Recurrence pattern converter utilities.
 *
 * Day numbering matches the schedule UI and generateOccurrences: Monday = 0 …
 * Sunday = 6. (An earlier Sunday-first list shifted every imported weekly
 * series by one day.)
 */

import type { IRecurrencePattern } from '@alga-psa/types';

const DAY_NAMES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
const WEEKDAY_INDEXES = [0, 1, 2, 3, 4];
const SUPPORTED_FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const;
const SUPPORTED_ORDINALS = [1, 2, 3, 4, -1];

export interface RecurrencePatternResult {
  unsupported?: false;
  pattern: IRecurrencePattern;
}

export interface UnsupportedRecurrenceResult {
  unsupported: true;
  reason: string;
}

export type RecurrenceConversion = RecurrencePatternResult | UnsupportedRecurrenceResult;

export function isUnsupportedRecurrence(
  conversion: RecurrenceConversion | null
): conversion is UnsupportedRecurrenceResult {
  return conversion?.unsupported === true;
}

export function convertRecurrencePatternToRRULE(pattern: IRecurrencePattern): string | null {
  if (!pattern || !pattern.frequency) {
    return null;
  }

  const parts: string[] = [];
  const freq = pattern.frequency.toUpperCase();
  parts.push(`FREQ=${freq}`);

  if (pattern.interval && pattern.interval > 1) {
    parts.push(`INTERVAL=${pattern.interval}`);
  }

  if (pattern.daysOfWeek && pattern.daysOfWeek.length > 0) {
    const ordinal = pattern.weekOfMonth ? String(pattern.weekOfMonth) : '';
    const byday = pattern.daysOfWeek
      .map((day) => DAY_NAMES[day])
      .filter((name): name is (typeof DAY_NAMES)[number] => Boolean(name))
      .map((name) => `${ordinal}${name}`)
      .join(',');
    if (byday) {
      parts.push(`BYDAY=${byday}`);
    }
  }

  if (pattern.dayOfMonth) {
    parts.push(`BYMONTHDAY=${pattern.dayOfMonth}`);
  }

  if (pattern.monthOfYear) {
    parts.push(`BYMONTH=${pattern.monthOfYear}`);
  }

  if (pattern.count) {
    parts.push(`COUNT=${pattern.count}`);
  }

  if (pattern.endDate) {
    const untilDate = new Date(pattern.endDate);
    untilDate.setUTCHours(23, 59, 59, 999);
    parts.push(`UNTIL=${formatRRULEDate(untilDate)}`);
  }

  if (pattern.workdaysOnly && (pattern.frequency === 'daily' || pattern.frequency === 'weekly')) {
    if (pattern.frequency === 'daily') {
      parts.push('BYDAY=MO,TU,WE,TH,FR');
      const freqIndex = parts.findIndex((part) => part.startsWith('FREQ='));
      if (freqIndex !== -1) {
        parts[freqIndex] = 'FREQ=WEEKLY';
      }
    } else if (pattern.frequency === 'weekly') {
      const existingByday = parts.find((part) => part.startsWith('BYDAY='));
      if (existingByday) {
        const days = existingByday.replace('BYDAY=', '').split(',');
        const weekdays = days.filter((day) => ['MO', 'TU', 'WE', 'TH', 'FR'].includes(day));
        if (weekdays.length > 0) {
          const index = parts.indexOf(existingByday);
          parts[index] = `BYDAY=${weekdays.join(',')}`;
        } else {
          parts.push('BYDAY=MO,TU,WE,TH,FR');
        }
      } else {
        parts.push('BYDAY=MO,TU,WE,TH,FR');
      }
    }
  }

  if (pattern.exceptions && pattern.exceptions.length > 0) {
    const exdates = pattern.exceptions
      .map((date) => formatRRULEDate(new Date(date)))
      .join(',');
    parts.push(`EXDATE=${exdates}`);
  }

  return parts.join(';');
}

/**
 * Convert a provider `recurrence[]` array (Google) or a single RRULE string into
 * an Alga pattern. Rules Alga cannot express come back as an explicit
 * `unsupported` result so the caller can fall back deliberately instead of
 * importing a mangled (or empty) pattern.
 */
export function convertRecurrenceLinesToPattern(
  lines: string[] | string | undefined | null,
  startDate: Date,
  timeZone?: string
): RecurrenceConversion | null {
  const rawLines = (Array.isArray(lines) ? lines : lines ? [lines] : [])
    .filter((line): line is string => typeof line === 'string' && line.trim().length > 0);

  if (rawLines.length === 0) {
    return null;
  }

  const rruleBodies: string[] = [];
  const exceptions: Date[] = [];

  for (const rawLine of rawLines) {
    const line = rawLine.trim();
    // "RRULE:FREQ=…", "EXDATE;TZID=America/New_York:20261203T101500", or a bare
    // RRULE body (the shape Alga itself emits).
    const named = /^([A-Za-z][A-Za-z0-9-]*)(?:;[^:]*)?:(.*)$/.exec(line);
    const name = named
      ? named[1].toUpperCase()
      : line.toUpperCase().includes('FREQ=')
        ? 'RRULE'
        : '';
    const value = named ? named[2] : line;

    switch (name) {
      case 'RRULE':
        rruleBodies.push(value);
        break;
      case 'EXDATE':
        for (const part of value.split(',')) {
          const parsed = parseRRULEDate(part.trim());
          if (parsed) exceptions.push(parsed);
        }
        break;
      case 'RDATE':
        return { unsupported: true, reason: 'RDATE lines are not supported' };
      case 'DTSTART':
      case 'DTEND':
      case 'DURATION':
        break;
      default:
        // Unknown component: ignore rather than fail the whole series.
        break;
    }
  }

  if (rruleBodies.length === 0) {
    return null;
  }
  if (rruleBodies.length > 1) {
    return { unsupported: true, reason: 'Multiple RRULE lines are not supported' };
  }

  return parseRRULEBody(rruleBodies[0], startDate, exceptions, timeZone);
}

function parseRRULEBody(
  body: string,
  startDate: Date,
  extraExceptions: Date[],
  timeZone?: string
): RecurrenceConversion {
  const rruleMap: Record<string, string> = {};
  for (const component of body.split(';')) {
    const index = component.indexOf('=');
    if (index <= 0) continue;
    rruleMap[component.slice(0, index).trim().toUpperCase()] = component.slice(index + 1).trim();
  }

  const freq = rruleMap['FREQ']?.toLowerCase();
  if (!freq) {
    return { unsupported: true, reason: 'RRULE has no FREQ' };
  }
  if (!SUPPORTED_FREQUENCIES.includes(freq as (typeof SUPPORTED_FREQUENCIES)[number])) {
    return { unsupported: true, reason: `FREQ=${freq.toUpperCase()} is not supported` };
  }

  for (const unsupportedKey of ['BYWEEKNO', 'BYYEARDAY', 'BYHOUR', 'BYMINUTE', 'BYSECOND']) {
    if (rruleMap[unsupportedKey]) {
      return { unsupported: true, reason: `${unsupportedKey} is not supported` };
    }
  }

  const pattern: IRecurrencePattern = {
    frequency: freq as IRecurrencePattern['frequency'],
    interval: 1,
    startDate,
  };

  if (rruleMap['INTERVAL']) {
    pattern.interval = parseInt(rruleMap['INTERVAL'], 10) || 1;
  }

  let bydayOrdinal: number | undefined;
  if (rruleMap['BYDAY']) {
    const daysOfWeek: number[] = [];
    const ordinals = new Set<number>();
    for (const token of rruleMap['BYDAY'].split(',')) {
      const match = /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/i.exec(token.trim());
      if (!match) {
        return { unsupported: true, reason: `Unsupported BYDAY token "${token.trim()}"` };
      }
      if (match[1]) {
        ordinals.add(parseInt(match[1], 10));
      }
      const index = DAY_NAMES.indexOf(match[2].toUpperCase() as (typeof DAY_NAMES)[number]);
      if (index !== -1 && !daysOfWeek.includes(index)) {
        daysOfWeek.push(index);
      }
    }

    if (ordinals.size > 1) {
      return { unsupported: true, reason: 'Mixed BYDAY ordinals are not supported' };
    }
    if (ordinals.size === 1) {
      const ordinal = [...ordinals][0];
      if (!SUPPORTED_ORDINALS.includes(ordinal)) {
        return { unsupported: true, reason: `BYDAY ordinal ${ordinal} is not supported` };
      }
      bydayOrdinal = ordinal;
    }

    if (daysOfWeek.length > 0) {
      pattern.daysOfWeek = daysOfWeek;
    }
  }

  if (rruleMap['BYSETPOS']) {
    const values = rruleMap['BYSETPOS'].split(',').map((value) => parseInt(value.trim(), 10));
    if (values.length > 1) {
      return { unsupported: true, reason: 'Multiple BYSETPOS values are not supported' };
    }
    const [setPos] = values;
    if (!SUPPORTED_ORDINALS.includes(setPos)) {
      return { unsupported: true, reason: `BYSETPOS ${rruleMap['BYSETPOS']} is not supported` };
    }
    if (bydayOrdinal !== undefined && bydayOrdinal !== setPos) {
      return { unsupported: true, reason: 'Conflicting BYDAY ordinal and BYSETPOS' };
    }
    if (!pattern.daysOfWeek || pattern.daysOfWeek.length === 0) {
      return { unsupported: true, reason: 'BYSETPOS without BYDAY is not supported' };
    }
    bydayOrdinal = setPos;
  }

  if (bydayOrdinal !== undefined) {
    pattern.weekOfMonth = bydayOrdinal as IRecurrencePattern['weekOfMonth'];
  }

  if (rruleMap['BYMONTHDAY']) {
    const values = rruleMap['BYMONTHDAY'].split(',');
    if (values.length > 1) {
      return { unsupported: true, reason: 'Multiple BYMONTHDAY values are not supported' };
    }
    const dayOfMonth = parseInt(values[0], 10);
    if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
      return { unsupported: true, reason: `BYMONTHDAY ${values[0]} is not supported` };
    }
    pattern.dayOfMonth = dayOfMonth;
  }

  if (rruleMap['BYMONTH']) {
    const values = rruleMap['BYMONTH'].split(',');
    if (values.length > 1) {
      return { unsupported: true, reason: 'Multiple BYMONTH values are not supported' };
    }
    const monthOfYear = parseInt(values[0], 10);
    if (!Number.isInteger(monthOfYear) || monthOfYear < 1 || monthOfYear > 12) {
      return { unsupported: true, reason: `BYMONTH ${values[0]} is not supported` };
    }
    pattern.monthOfYear = monthOfYear;
  }

  if (rruleMap['COUNT']) {
    const count = parseInt(rruleMap['COUNT'], 10);
    if (Number.isInteger(count) && count > 0) {
      pattern.count = count;
    }
  }

  if (rruleMap['UNTIL']) {
    const untilDate = parseRRULEDate(rruleMap['UNTIL']);
    if (untilDate) {
      pattern.endDate = untilDate;
    }
  }

  if (
    pattern.frequency === 'weekly' &&
    pattern.daysOfWeek &&
    pattern.daysOfWeek.length === WEEKDAY_INDEXES.length &&
    WEEKDAY_INDEXES.every((day) => pattern.daysOfWeek!.includes(day))
  ) {
    pattern.workdaysOnly = true;
  }

  const inlineExceptions = rruleMap['EXDATE']
    ? rruleMap['EXDATE']
        .split(',')
        .map((value) => parseRRULEDate(value.trim()))
        .filter((date): date is Date => date !== null)
    : [];

  const allExceptions = [...extraExceptions, ...inlineExceptions];
  if (allExceptions.length > 0) {
    pattern.exceptions = allExceptions;
  }

  if (timeZone) {
    pattern.timeZone = timeZone;
  }

  return { pattern };
}

/**
 * Back-compatible single-RRULE entry point. Unsupported rules resolve to null;
 * callers that need to distinguish "cannot express" from "not recurring" should
 * use convertRecurrenceLinesToPattern.
 */
export function convertRRULEToRecurrencePattern(
  rrule: string,
  startDate: Date,
  timeZone?: string
): IRecurrencePattern | null {
  const conversion = convertRecurrenceLinesToPattern(rrule, startDate, timeZone);
  if (!conversion || isUnsupportedRecurrence(conversion)) {
    return null;
  }
  return conversion.pattern;
}

function formatRRULEDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

function parseRRULEDate(dateStr: string): Date | null {
  try {
    // 20270101T045959Z and the floating 20270101T045959 (TZID-qualified) form.
    const basic = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(dateStr);
    if (basic) {
      return new Date(
        Date.UTC(
          parseInt(basic[1], 10),
          parseInt(basic[2], 10) - 1,
          parseInt(basic[3], 10),
          basic[4] ? parseInt(basic[4], 10) : 0,
          basic[5] ? parseInt(basic[5], 10) : 0,
          basic[6] ? parseInt(basic[6], 10) : 0
        )
      );
    }

    const parsed = new Date(dateStr);
    return isNaN(parsed.getTime()) ? null : parsed;
  } catch (error) {
    console.error('Failed to parse RRULE date:', dateStr, error);
    return null;
  }
}

export function parseEXDATE(exdateStr: string): Date[] {
  if (!exdateStr) {
    return [];
  }

  return exdateStr
    .split(',')
    .map((dateStr) => parseRRULEDate(dateStr.trim()))
    .filter((date): date is Date => date !== null);
}

export function formatEXDATE(exceptions: Date[]): string {
  if (!exceptions || exceptions.length === 0) {
    return '';
  }

  return exceptions.map((date) => formatRRULEDate(date)).join(',');
}
