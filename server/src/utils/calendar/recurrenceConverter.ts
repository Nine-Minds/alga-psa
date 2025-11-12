/**
 * Recurrence pattern converter utilities
 * Converts between Alga recurrence patterns and RFC 5545 RRULE format
 */

import { IRecurrencePattern } from '../../interfaces/schedule.interfaces';

/**
 * Convert Alga recurrence pattern to RFC 5545 RRULE string
 */
export function convertRecurrencePatternToRRULE(pattern: IRecurrencePattern): string | null {
  if (!pattern || !pattern.frequency) {
    return null;
  }

  const parts: string[] = [];

  // FREQ (required)
  const freq = pattern.frequency.toUpperCase();
  parts.push(`FREQ=${freq}`);

  // INTERVAL
  if (pattern.interval && pattern.interval > 1) {
    parts.push(`INTERVAL=${pattern.interval}`);
  }

  // BYDAY (for weekly, monthly, yearly)
  if (pattern.daysOfWeek && pattern.daysOfWeek.length > 0) {
    const dayNames = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
    const byday = pattern.daysOfWeek
      .map(day => dayNames[day])
      .join(',');
    parts.push(`BYDAY=${byday}`);
  }

  // BYMONTHDAY (for monthly/yearly)
  if (pattern.dayOfMonth) {
    parts.push(`BYMONTHDAY=${pattern.dayOfMonth}`);
  }

  // BYMONTH (for yearly)
  if (pattern.monthOfYear) {
    parts.push(`BYMONTH=${pattern.monthOfYear}`);
  }

  // COUNT
  if (pattern.count) {
    parts.push(`COUNT=${pattern.count}`);
  }

  // UNTIL (end date)
  if (pattern.endDate) {
    const untilDate = new Date(pattern.endDate);
    untilDate.setUTCHours(23, 59, 59, 999); // End of day in UTC
    parts.push(`UNTIL=${formatRRULEDate(untilDate)}`);
  }

  // Handle workdaysOnly for daily/weekly patterns
  if (pattern.workdaysOnly && (pattern.frequency === 'daily' || pattern.frequency === 'weekly')) {
    if (pattern.frequency === 'daily') {
      // Convert daily workdays to weekly with weekdays
      parts.push('BYDAY=MO,TU,WE,TH,FR');
      // Remove FREQ=DAILY and add FREQ=WEEKLY
      const freqIndex = parts.findIndex(p => p.startsWith('FREQ='));
      if (freqIndex !== -1) {
        parts[freqIndex] = 'FREQ=WEEKLY';
      }
    } else if (pattern.frequency === 'weekly') {
      // Ensure only weekdays are included
      const existingByday = parts.find(p => p.startsWith('BYDAY='));
      if (existingByday) {
        const days = existingByday.replace('BYDAY=', '').split(',');
        const weekdays = days.filter(d => ['MO', 'TU', 'WE', 'TH', 'FR'].includes(d));
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

  // EXDATE (exception dates)
  if (pattern.exceptions && pattern.exceptions.length > 0) {
    const exdates = pattern.exceptions
      .map(date => formatRRULEDate(new Date(date)))
      .join(',');
    parts.push(`EXDATE=${exdates}`);
  }

  return parts.join(';');
}

/**
 * Convert RFC 5545 RRULE string to Alga recurrence pattern
 */
export function convertRRULEToRecurrencePattern(rrule: string, startDate: Date): IRecurrencePattern | null {
  if (!rrule || !rrule.trim()) {
    return null;
  }

  const pattern: Partial<IRecurrencePattern> = {
    startDate: startDate,
    interval: 1
  };

  // Parse RRULE components
  const components = rrule.split(';');
  const rruleMap: Record<string, string> = {};

  for (const component of components) {
    const [key, value] = component.split('=');
    if (key && value) {
      rruleMap[key.toUpperCase()] = value;
    }
  }

  // FREQ (required)
  const freq = rruleMap['FREQ']?.toLowerCase();
  if (!freq || !['daily', 'weekly', 'monthly', 'yearly'].includes(freq)) {
    return null;
  }
  pattern.frequency = freq as 'daily' | 'weekly' | 'monthly' | 'yearly';

  // INTERVAL
  if (rruleMap['INTERVAL']) {
    pattern.interval = parseInt(rruleMap['INTERVAL'], 10) || 1;
  }

  // BYDAY
  if (rruleMap['BYDAY']) {
    const dayNames = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
    const days = rruleMap['BYDAY'].split(',');
    pattern.daysOfWeek = days
      .map(day => dayNames.indexOf(day.trim()))
      .filter(index => index !== -1);
  }

  // BYMONTHDAY
  if (rruleMap['BYMONTHDAY']) {
    pattern.dayOfMonth = parseInt(rruleMap['BYMONTHDAY'], 10);
  }

  // BYMONTH
  if (rruleMap['BYMONTH']) {
    pattern.monthOfYear = parseInt(rruleMap['BYMONTH'], 10);
  }

  // COUNT
  if (rruleMap['COUNT']) {
    pattern.count = parseInt(rruleMap['COUNT'], 10);
  }

  // UNTIL
  if (rruleMap['UNTIL']) {
    const untilDate = parseRRULEDate(rruleMap['UNTIL']);
    if (untilDate) {
      pattern.endDate = untilDate;
    }
  }

  // Check for workdaysOnly (if BYDAY contains only weekdays)
  if (pattern.daysOfWeek && pattern.daysOfWeek.length > 0) {
    const weekdays = [1, 2, 3, 4, 5]; // MO-FR
    const isWorkdaysOnly = pattern.daysOfWeek.every(day => weekdays.includes(day));
    if (isWorkdaysOnly && pattern.frequency === 'weekly') {
      pattern.workdaysOnly = true;
    }
  }

  // EXDATE (exception dates)
  // Note: EXDATE is typically in a separate EXDATE property, not in RRULE
  // But we'll handle it if present in the RRULE string (non-standard)
  if (rruleMap['EXDATE']) {
    const exdates = rruleMap['EXDATE'].split(',');
    pattern.exceptions = exdates
      .map(dateStr => parseRRULEDate(dateStr.trim()))
      .filter((date): date is Date => date !== null);
  }

  return pattern as IRecurrencePattern;
}

/**
 * Format date for RRULE (YYYYMMDDTHHMMSSZ format)
 */
function formatRRULEDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

/**
 * Parse RRULE date format (YYYYMMDDTHHMMSSZ or YYYYMMDD)
 */
function parseRRULEDate(dateStr: string): Date | null {
  try {
    // Handle YYYYMMDDTHHMMSSZ format
    if (dateStr.length === 16 && dateStr.includes('T')) {
      const year = parseInt(dateStr.substring(0, 4), 10);
      const month = parseInt(dateStr.substring(4, 6), 10) - 1;
      const day = parseInt(dateStr.substring(6, 8), 10);
      const hours = parseInt(dateStr.substring(9, 11), 10);
      const minutes = parseInt(dateStr.substring(11, 13), 10);
      const seconds = parseInt(dateStr.substring(13, 15), 10);
      return new Date(Date.UTC(year, month, day, hours, minutes, seconds));
    }
    
    // Handle YYYYMMDD format (all-day events)
    if (dateStr.length === 8) {
      const year = parseInt(dateStr.substring(0, 4), 10);
      const month = parseInt(dateStr.substring(4, 6), 10) - 1;
      const day = parseInt(dateStr.substring(6, 8), 10);
      return new Date(Date.UTC(year, month, day, 0, 0, 0));
    }

    // Fallback: try ISO format
    return new Date(dateStr);
  } catch (error) {
    console.error('Failed to parse RRULE date:', dateStr, error);
    return null;
  }
}

/**
 * Extract exception dates from EXDATE property (separate from RRULE)
 */
export function parseEXDATE(exdateStr: string): Date[] {
  if (!exdateStr) {
    return [];
  }

  const dates = exdateStr.split(',');
  return dates
    .map(dateStr => parseRRULEDate(dateStr.trim()))
    .filter((date): date is Date => date !== null);
}

/**
 * Format exception dates for EXDATE property
 */
export function formatEXDATE(exceptions: Date[]): string {
  if (!exceptions || exceptions.length === 0) {
    return '';
  }

  return exceptions
    .map(date => formatRRULEDate(date))
    .join(',');
}

