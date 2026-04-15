const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

export const TIME_WAIT_MAX_DURATION_MS = Number.MAX_SAFE_INTEGER;

export type TimeWaitDurationParts = {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
};

const EMPTY_DURATION_PARTS: TimeWaitDurationParts = {
  days: 0,
  hours: 0,
  minutes: 0,
  seconds: 0,
};

function coerceDurationPart(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.floor(value);
}

export function composeTimeWaitDurationMs(parts: Partial<TimeWaitDurationParts>): number | undefined {
  const days = coerceDurationPart(parts.days);
  const hours = coerceDurationPart(parts.hours);
  const minutes = coerceDurationPart(parts.minutes);
  const seconds = coerceDurationPart(parts.seconds);

  const total = (days * MS_PER_DAY)
    + (hours * MS_PER_HOUR)
    + (minutes * MS_PER_MINUTE)
    + (seconds * MS_PER_SECOND);

  return total > 0 ? total : undefined;
}

export function decomposeTimeWaitDurationMs(durationMs?: number | null): TimeWaitDurationParts {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) {
    return EMPTY_DURATION_PARTS;
  }

  const normalizedMs = durationMs % MS_PER_SECOND === 0
    ? durationMs
    : Math.ceil(durationMs / MS_PER_SECOND) * MS_PER_SECOND;

  let remaining = normalizedMs;

  const days = Math.floor(remaining / MS_PER_DAY);
  remaining -= days * MS_PER_DAY;

  const hours = Math.floor(remaining / MS_PER_HOUR);
  remaining -= hours * MS_PER_HOUR;

  const minutes = Math.floor(remaining / MS_PER_MINUTE);
  remaining -= minutes * MS_PER_MINUTE;

  const seconds = Math.floor(remaining / MS_PER_SECOND);

  return {
    days,
    hours,
    minutes,
    seconds,
  };
}

export function formatTimeWaitDuration(durationMs?: number | null): string {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) {
    return '0s';
  }

  if (durationMs < MS_PER_SECOND) {
    return `${durationMs}ms`;
  }

  if (durationMs < MS_PER_MINUTE && durationMs % MS_PER_SECOND !== 0) {
    return `${Math.round((durationMs / MS_PER_SECOND) * 10) / 10}s`;
  }

  const parts = decomposeTimeWaitDurationMs(durationMs);
  const tokens: string[] = [];

  if (parts.days > 0) tokens.push(`${parts.days}d`);
  if (parts.hours > 0) tokens.push(`${parts.hours}h`);
  if (parts.minutes > 0) tokens.push(`${parts.minutes}m`);
  if (parts.seconds > 0) tokens.push(`${parts.seconds}s`);

  return tokens.length > 0 ? tokens.join(' ') : '0s';
}

export function parseTimeWaitDurationPart(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) {
    return 0;
  }

  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.floor(value);
}

export function formatTimeWaitDurationPart(value: number): string {
  return value > 0 ? String(value) : '';
}
