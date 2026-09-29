/**
 * Client-safe calendar color helpers (no DB imports), shared by the schedule
 * UI and the server-side calendar list.
 */

const PERSONAL_CALENDAR_PALETTE = [
  '#2563eb',
  '#16a34a',
  '#db2777',
  '#ea580c',
  '#7c3aed',
  '#0891b2',
  '#ca8a04',
  '#dc2626',
  '#4f46e5',
  '#059669',
  '#9333ea',
  '#0d9488',
];

/** Stable color for a person's calendar, derived from their user id. */
export function personalCalendarColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return PERSONAL_CALENDAR_PALETTE[hash % PERSONAL_CALENDAR_PALETTE.length];
}
