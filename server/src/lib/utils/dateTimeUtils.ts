// src/utils/dateTimeUtils.ts

import { format, toZonedTime, fromZonedTime } from 'date-fns-tz';
import { parseISO, isToday, isYesterday } from 'date-fns';
import { Temporal } from '@js-temporal/polyfill';
import { ISO8601String } from 'server/src/types/types.d';

// Date conversion utilities

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

// Function to format date relatively (Today, Yesterday, or Date)
export function formatRelativeDateTime(date: Date, timeZone: string): string {
  const zonedDate = toZonedTime(date, timeZone);
  const timeStr = format(zonedDate, 'h:mm a', { timeZone });
  
  if (isToday(zonedDate)) {
    return `Today, ${timeStr}`;
  }
  
  if (isYesterday(zonedDate)) {
    return `Yesterday, ${timeStr}`;
  }
  
  return format(zonedDate, 'MMM dd, yyyy, h:mm a', { timeZone });
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
export function toPlainDate(date: string | Date | Temporal.PlainDate | null | undefined): Temporal.PlainDate {
  // Handle null or undefined
  if (date === null || date === undefined) {
    throw new Error('Cannot convert null or undefined to PlainDate');
  }

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
  // Make sure it's a valid Date object before calling toISOString
  if (date instanceof Date && !isNaN(date.getTime())) {
    return Temporal.Instant.from(date.toISOString())
      .toZonedDateTimeISO('UTC')
      .toPlainDate();
  }
  
  // If we get here, it's an invalid date
  throw new Error(`Invalid date value: ${date}`);
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


// Time conversion utilities

/**
 * Convert minutes to hours with decimal precision
 * @param minutes The number of minutes to convert
 * @param precision The decimal precision for the result (default: 2)
 * @returns The hours as a number with specified decimal precision
 */
export function minutesToHours(minutes: number | null | undefined, precision: number = 2): number | null {
  if (minutes === null || minutes === undefined) {
    return null;
  }
  
  return parseFloat((minutes / 60).toFixed(precision));
}

/**
 * Convert hours to minutes
 * @param hours The number of hours to convert
 * @returns The minutes as a number
 */
export function hoursToMinutes(hours: number | null | undefined): number | null {
  if (hours === null || hours === undefined) {
    return null;
  }
  
  return Math.round(hours * 60);
}

/**
 * Format minutes as a human-readable hours and minutes string
 * @param minutes The number of minutes to format
 * @returns A string in the format "X hr Y min" or "X hrs Y min"
 */
export function formatMinutesAsHoursAndMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) {
    return '0 hrs';
  }
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = Math.round(minutes % 60);
  
  const hourText = hours === 1 ? 'hr' : 'hrs';
  
  if (remainingMinutes === 0) {
    return `${hours} ${hourText}`;
  } else {
    return `${hours} ${hourText} ${remainingMinutes} min`;
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
