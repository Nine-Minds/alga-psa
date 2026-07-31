import type { Clock } from './types';

const UNIT_MS = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
} as const;

type DurationUnit = keyof typeof UNIT_MS;

/** Parse durations like "500ms", "30s", "4h30m", "32d" into milliseconds. */
export function parseDuration(input: string): number {
  const pattern = /(\d+(?:\.\d+)?)(ms|s|m|h|d|w)/g;
  let totalMs = 0;
  let matchedLength = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    totalMs += Number(match[1]) * UNIT_MS[match[2] as DurationUnit];
    matchedLength += match[0].length;
  }
  if (matchedLength === 0 || matchedLength !== input.length) {
    throw new Error(`Invalid duration "${input}" — expected forms like "500ms", "30s", "4h30m", "32d"`);
  }
  return totalMs;
}

/**
 * System time plus a controllable forward offset, shared by every emulator
 * in a host. Advancing the clock is how tests exercise token expiry, billing
 * periods, and other time-driven behavior deterministically.
 */
export class VirtualClock implements Clock {
  private offsetMs = 0;

  now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }

  get offset(): number {
    return this.offsetMs;
  }

  advance(duration: string | number): void {
    const ms = typeof duration === 'number' ? duration : parseDuration(duration);
    if (!Number.isFinite(ms) || ms < 0) {
      throw new Error(`Clock can only advance forward; got ${ms}ms`);
    }
    this.offsetMs += ms;
  }

  resetOffset(): void {
    this.offsetMs = 0;
  }
}

/** Deterministic PRNG (mulberry32). Same seed, same sequence. */
export function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
