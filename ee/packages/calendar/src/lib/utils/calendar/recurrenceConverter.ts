/**
 * Recurrence pattern converter utilities.
 */

import type { IRecurrencePattern } from '@alga-psa/types';

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
    const dayNames = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
    const byday = pattern.daysOfWeek.map((day) => dayNames[day]).join(',');
    parts.push(`BYDAY=${byday}`);
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

export function convertRRULEToRecurrencePattern(
  rrule: string,
  startDate: Date
): IRecurrencePattern | null {
  if (!rrule || !rrule.trim()) {
    return null;
  }

  const pattern: Partial<IRecurrencePattern> = {
    startDate,
    interval: 1,
  };

  const components = rrule.split(';');
  const rruleMap: Record<string, string> = {};

  for (const component of components) {
    const [key, value] = component.split('=');
    if (key && value) {
      rruleMap[key.toUpperCase()] = value;
    }
  }

  const freq = rruleMap['FREQ']?.toLowerCase();
  if (!freq || !['daily', 'weekly', 'monthly', 'yearly'].includes(freq)) {
    return null;
  }
  pattern.frequency = freq as 'daily' | 'weekly' | 'monthly' | 'yearly';

  if (rruleMap['INTERVAL']) {
    pattern.interval = parseInt(rruleMap['INTERVAL'], 10) || 1;
  }

  if (rruleMap['BYDAY']) {
    const dayNames = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
    const days = rruleMap['BYDAY'].split(',');
    pattern.daysOfWeek = days
      .map((day) => dayNames.indexOf(day.trim()))
      .filter((index) => index !== -1);
  }

  if (rruleMap['BYMONTHDAY']) {
    pattern.dayOfMonth = parseInt(rruleMap['BYMONTHDAY'], 10);
  }

  if (rruleMap['BYMONTH']) {
    pattern.monthOfYear = parseInt(rruleMap['BYMONTH'], 10);
  }

  if (rruleMap['COUNT']) {
    pattern.count = parseInt(rruleMap['COUNT'], 10);
  }

  if (rruleMap['UNTIL']) {
    const untilDate = parseRRULEDate(rruleMap['UNTIL']);
    if (untilDate) {
      pattern.endDate = untilDate;
    }
  }

  if (pattern.daysOfWeek && pattern.daysOfWeek.length > 0) {
    const weekdays = [1, 2, 3, 4, 5];
    const isWorkdaysOnly = pattern.daysOfWeek.every((day) => weekdays.includes(day));
    if (isWorkdaysOnly && pattern.frequency === 'weekly') {
      pattern.workdaysOnly = true;
    }
  }

  if (rruleMap['EXDATE']) {
    const exdates = rruleMap['EXDATE'].split(',');
    pattern.exceptions = exdates
      .map((dateStr) => parseRRULEDate(dateStr.trim()))
      .filter((date): date is Date => date !== null);
  }

  return pattern as IRecurrencePattern;
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
    if (dateStr.length === 16 && dateStr.includes('T')) {
      const year = parseInt(dateStr.substring(0, 4), 10);
      const month = parseInt(dateStr.substring(4, 6), 10) - 1;
      const day = parseInt(dateStr.substring(6, 8), 10);
      const hours = parseInt(dateStr.substring(9, 11), 10);
      const minutes = parseInt(dateStr.substring(11, 13), 10);
      const seconds = parseInt(dateStr.substring(13, 15), 10);
      return new Date(Date.UTC(year, month, day, hours, minutes, seconds));
    }

    if (dateStr.length === 8) {
      const year = parseInt(dateStr.substring(0, 4), 10);
      const month = parseInt(dateStr.substring(4, 6), 10) - 1;
      const day = parseInt(dateStr.substring(6, 8), 10);
      return new Date(Date.UTC(year, month, day, 0, 0, 0));
    }

    return new Date(dateStr);
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
