// src/utils/dateTimeUtils.ts

import { format, toZonedTime, fromZonedTime } from 'date-fns-tz';
import { parseISO } from 'date-fns';
import { Temporal } from '@js-temporal/polyfill';
import { ISO8601String } from '@/types/types.d';

// Function to convert UTC date to local timezone
export function utcToLocal(utcDate: string, timeZone: string): Date {
  const date = parseISO(utcDate);
  return toZonedTime(date, timeZone);
}

// Function to convert local date to UTC
export function localToUtc(localDate: Date, timeZone: string): Date {
  return fromZonedTime(localDate, timeZone);
}

// Function to format date for display (with time)
export function formatDateTime(date: Date, timeZone: string, formatString: string = 'yyyy-MM-dd HH:mm:ss'): string {
  return format(toZonedTime(date, timeZone), formatString, { timeZone });
}

// Function to format date only (without time)
export function formatDateOnly(date: Date, formatString: string = 'yyyy-MM-dd'): string {
  return format(date, formatString);
}

// Function to format UTC date as string with no time (00:00:00Z)
export function formatUtcDateNoTime(date: Date): string {
  return date.getUTCFullYear() + '-' + 
         String(date.getUTCMonth() + 1).padStart(2, '0') + '-' + 
         String(date.getUTCDate()).padStart(2, '0') + 
         'T00:00:00Z';
}

// Function to get user's timezone
export function getUserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Convert a date string, Date object, or Temporal.PlainDate to a Temporal.PlainDate
 * Handles both date-only strings and full ISO timestamps
 */
export function toPlainDate(date: string | Date | Temporal.PlainDate): Temporal.PlainDate {
  if (date instanceof Temporal.PlainDate) {
    return date;
  }
  if (typeof date === 'string') {
    // If it's a full ISO timestamp (contains 'T' or 'Z')
    if (date.includes('T') || date.includes('Z')) {
      return Temporal.Instant.from(date)
        .toZonedDateTimeISO('UTC')
        .toPlainDate();
    }
    // If it's already a date-only string (YYYY-MM-DD)
    return Temporal.PlainDate.from(date);
  }
  // If it's a Date object, convert through UTC
  return Temporal.Instant.from(date.toISOString())
    .toZonedDateTimeISO('UTC')
    .toPlainDate();
}

/**
 * Convert a Temporal.PlainDate to an ISO date string (YYYY-MM-DD)
 */
export function toISODate(date: Temporal.PlainDate): string {
  return date.toString();
}

/**
 * Convert a Temporal.PlainDate to an ISO timestamp at UTC midnight
 */
export function toISOTimestamp(date: Temporal.PlainDate): ISO8601String {
  return `${date.toString()}T00:00:00.000Z`;
}

/**
 * Get the current date as a Temporal.PlainDate
 */
export function getCurrentDate(): Temporal.PlainDate {
  return Temporal.Now.plainDateISO();
}

/**
 * Parse a date string into a Temporal.PlainDate, with error handling
 */
export function parseDateSafe(dateStr: string | null | undefined): Temporal.PlainDate | null {
  if (!dateStr) return null;
  try {
    return toPlainDate(dateStr);
  } catch (error) {
    console.error('Error parsing date:', error);
    return null;
  }
}

// Example usage in a component
// import React from 'react';
// import { utcToLocal, formatDateTime, formatDateOnly, getUserTimeZone } from '../utils/dateTimeUtils';

// interface TicketProps {
//   createdAt: string; // UTC date string
//   dueDate: string;   // UTC date string
// }

// const TicketDisplay: React.FC<TicketProps> = ({ createdAt, dueDate }) => {
//   const userTimeZone = getUserTimeZone();
//   const localCreatedAt = utcToLocal(createdAt, userTimeZone);
//   const localDueDate = utcToLocal(dueDate, userTimeZone);

//   return (
//     <div>
//       <p>Created: {formatDateTime(localCreatedAt, userTimeZone)}</p>
//       <p>Due Date: {formatDateOnly(localDueDate)}</p>
//     </div>
//   );
// };

// export default TicketDisplay;
