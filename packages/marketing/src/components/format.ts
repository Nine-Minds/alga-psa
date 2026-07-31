// Shared formatting helpers for marketing UI components.

export function formatDate(value?: string | null): string {
  if (!value) return '—';
  // Date-only values (campaign start/end) must not pass through the Date
  // UTC parser — 'YYYY-MM-DD' parses as UTC midnight and renders as the
  // previous day west of UTC. Build them in local calendar terms.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatTime(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Start-of-day for grouping agenda items by calendar day. */
export function dayStart(value: string | Date): Date {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** "overdue 2d" / "overdue 5h" when the scheduled time has passed; null otherwise. */
export function overdueLabel(scheduledAt?: string | null): string | null {
  if (!scheduledAt) return null;
  const due = new Date(scheduledAt).getTime();
  if (Number.isNaN(due) || due >= Date.now()) return null;
  const diffMs = Date.now() - due;
  const days = Math.floor(diffMs / 86_400_000);
  if (days >= 1) return `overdue ${days}d`;
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours >= 1) return `overdue ${hours}h`;
  return 'overdue';
}

/** Human label for a sequence step delay: 0 → immediate, then min/hours/days. */
export function delayLabel(minutes: number): string {
  if (minutes <= 0) return 'immediately';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return hours === 1 ? '1 hour' : `${hours} hours`;
  const days = Math.round(minutes / 1440);
  return days === 1 ? '1 day' : `${days} days`;
}

/**
 * "day 5" style chip for journey cards: cumulative days from enrollment,
 * including the step's own delay (mockup indexing: delays of 0/2d/3d label
 * "immediately" / "day 2" / "day 5").
 */
export function journeyDayLabel(cumulativeMinutes: number): string {
  if (cumulativeMinutes <= 0) return 'immediately';
  const days = Math.round(cumulativeMinutes / 1440);
  return days <= 0 ? 'day 1' : `day ${days}`;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Short platform chip label, e.g. "linkedin" → "in", "youtube" → "YT". */
export function platformChip(platform: string): string {
  const normalized = (platform || '').trim().toLowerCase();
  const known: Record<string, string> = {
    linkedin: 'in',
    youtube: 'YT',
    x: 'X',
    twitter: 'X',
    facebook: 'fb',
    instagram: 'IG',
    tiktok: 'TT',
    blog: 'blog',
    email: '@',
  };
  if (known[normalized]) return known[normalized];
  if (!normalized) return '?';
  return normalized.slice(0, 2);
}
