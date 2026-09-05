import { format } from 'date-fns';
import type { ITicketListItem, ITicketCategory } from '@alga-psa/types';

// ---------------------------------------------------------------------------
// Presentation helpers — "Refined List" look (redesign candidate #1):
// semantic status pills, a relative Due column, and the category label folded
// under the title. Shared by the MSP Ticketing Dashboard columns
// (ticket-columns.tsx) and the client-portal ticket list so both surfaces read
// identically.
// ---------------------------------------------------------------------------

// Hash used for deterministic status-pill hue selection (avatar colors come from
// the shared ClientAvatar/UserAvatar components, which derive their own hues).
export function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// Status pill hues. Every entry is a live theme token, so the same status can
// keep its stable palette slot while its actual color adapts to light/dark mode,
// the selected theme pair, and tenant custom themes. The pill background is a
// translucent tint of the hue; the solid hue is used for the dot. Closed
// statuses always resolve through the semantic success token.
export const STATUS_PILL_HUES = [
  'var(--color-primary-500)',
  'var(--color-secondary-500)',
  'var(--color-accent-500)',
  'var(--color-primary-700)',
  'var(--color-secondary-700)',
  'var(--color-accent-700)',
  'var(--color-text-500)',
];
export const STATUS_PILL_CLOSED_HUE = 'var(--color-status-success)'; // green (live token)

export function statusPillHue(statusName: string, closed: boolean): string {
  if (closed) return STATUS_PILL_CLOSED_HUE;
  return STATUS_PILL_HUES[hashString(statusName || 'status') % STATUS_PILL_HUES.length];
}

// Compact relative due label, e.g. "Overdue 2d", "in 5h", "in 3 days".
export function relativeDueLabel(due: Date, now: Date): string {
  const ms = due.getTime() - now.getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const overdue = ms < 0;
  const absMs = Math.abs(ms);
  const days = Math.floor(absMs / dayMs);
  const hours = Math.floor(absMs / (60 * 60 * 1000));
  let magnitude: string;
  if (days >= 1) magnitude = `${days}d`;
  else if (hours >= 1) magnitude = `${hours}h`;
  else magnitude = `${Math.max(1, Math.round(absMs / 60000))}m`;
  if (overdue) return `Overdue ${magnitude}`;
  return days >= 1 ? `in ${days} days` : `in ${magnitude}`;
}

// Smart due-date label matching candidate #1: "Overdue 1d" / "Today 4:00 PM" /
// "Tomorrow 9:00 AM" / "Fri, Jun 21" (year added only when not the current year).
export function formatDuePrimary(due: Date, now: Date): string {
  if (due.getTime() < now.getTime()) {
    return relativeDueLabel(due, now); // "Overdue 5h" / "Overdue 1d"
  }
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const dueDay = new Date(due);
  dueDay.setHours(0, 0, 0, 0);
  const dayDiff = Math.round((dueDay.getTime() - startOfToday.getTime()) / 86400000);
  const isMidnight = due.getHours() === 0 && due.getMinutes() === 0;
  if (dayDiff === 0) return isMidnight ? 'Today' : `Today ${format(due, 'h:mm a')}`;
  if (dayDiff === 1) return isMidnight ? 'Tomorrow' : `Tomorrow ${format(due, 'h:mm a')}`;
  return format(due, due.getFullYear() === now.getFullYear() ? 'EEE, MMM d' : 'MMM d, yyyy');
}

// Calendar-day count to a future due date, for the secondary "in N days" hint.
export function daysUntil(due: Date, now: Date): number {
  const a = new Date(now); a.setHours(0, 0, 0, 0);
  const b = new Date(due); b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

// Shared category label resolver, used by both the category column and the
// category subtitle folded under the title cell.
export function formatCategoryLabel(record: ITicketListItem, categories: ITicketCategory[]): string {
  const categoryId = record.category_id || null;
  if (!categoryId && !record.subcategory_id) return 'No Category';
  if (record.subcategory_id) {
    const subcategory = categories.find(c => c.category_id === record.subcategory_id);
    if (!subcategory) return 'Unknown Category';
    const parent = categories.find(c => c.category_id === subcategory.parent_category);
    return parent ? `${parent.category_name} → ${subcategory.category_name}` : subcategory.category_name;
  }
  const category = categories.find(c => c.category_id === categoryId);
  if (!category) return 'Unknown Category';
  return category.category_name;
}
