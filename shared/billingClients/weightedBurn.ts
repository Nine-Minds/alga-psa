/**
 * Weighted bucket burn calculator — pure, no DB.
 *
 * Weighted minutes are the single unit of account for bucket-of-hours pools:
 * per-service `burn_multiplier` and an optional after-hours schedule rule are
 * combined by **max-wins** (never compounded). The weighted result depletes
 * the pool AND flows into overage billing.
 *
 * Classification math comes from `lib/businessHours/businessHoursSegmentation`
 * (the canonical home; @alga-psa/sla re-exports it) — do not fork it.
 */

import {
  segmentSpanByBusinessHours,
  isWithinBusinessHours,
  type BusinessHourSegment,
  type BusinessHoursScheduleInput,
} from '../lib/businessHours/businessHoursSegmentation';

/** The after-hours rule attached to a pool: a multiplier plus its schedule. */
export interface AfterHoursRule {
  multiplier: number;
  schedule: BusinessHoursScheduleInput;
}

export interface WeightedBurnInput {
  /** Wall-clock span start (UTC). */
  startTime: Date;
  /** Wall-clock span end (UTC). */
  endTime: Date;
  /** Billable duration in minutes (can be fractional, can differ from wall clock). */
  billableDuration: number;
}

export interface WeightedBurnSegment extends BusinessHourSegment {
  /** The multiplier applied to this segment (member multiplier, or max with after-hours). */
  multiplier: number;
  /** Billable minutes apportioned to this segment. */
  billableMinutes: number;
  /** Weighted minutes produced by this segment. */
  weightedMinutes: number;
}

export interface WeightedBurnResult {
  /** Total weighted minutes, rounded to 2 decimals. */
  weightedMinutes: number;
  /** Per-segment breakdown for diagnostics. */
  segments: WeightedBurnSegment[];
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Compute weighted burn minutes for one draw.
 *
 * - No after-hours rule: the whole span burns at `memberMultiplier`.
 * - With a rule: the span is split into in/out-of-hours segments (schedule
 *   timezone); each segment's multiplier is `memberMultiplier` when in-hours
 *   and `max(memberMultiplier, afterHoursMultiplier)` when out-of-hours
 *   (max-wins — premiums never compound).
 * - `billableDuration` is apportioned across segments by wall-clock fraction,
 *   so a span whose billable duration differs from its wall clock still
 *   prorates by overlap.
 * - Zero-length span (startTime >= endTime): one segment classified by
 *   `startTime`; the full `billableDuration` is attributed to it. This is the
 *   path usage-tracking draws (no time span) use, burning at
 *   `memberMultiplier` only unless `startTime` falls out-of-hours under a rule.
 *
 * @param input the draw's wall-clock span and billable duration (minutes)
 * @param memberMultiplier the pool member's per-service multiplier (> 0)
 * @param afterHoursRule optional after-hours rule
 */
export function computeWeightedMinutes(
  input: WeightedBurnInput,
  memberMultiplier: number,
  afterHoursRule: AfterHoursRule | null
): WeightedBurnResult {
  const { startTime, endTime, billableDuration } = input;
  const normalizedMemberMultiplier = memberMultiplier > 0 ? memberMultiplier : 1;

  let baseSegments: BusinessHourSegment[];
  if (afterHoursRule) {
    baseSegments = segmentSpanByBusinessHours(afterHoursRule.schedule, startTime, endTime);
  } else {
    baseSegments = [{ start: startTime, end: endTime, isBusinessHours: true }];
  }

  const wallClockMs = Math.max(0, endTime.getTime() - startTime.getTime());

  const segments: WeightedBurnSegment[] = baseSegments.map((segment) => {
    let multiplier: number;
    if (!afterHoursRule) {
      multiplier = normalizedMemberMultiplier;
    } else if (segment.isBusinessHours) {
      multiplier = normalizedMemberMultiplier;
    } else {
      multiplier = Math.max(normalizedMemberMultiplier, afterHoursRule.multiplier);
    }

    let billableMinutes: number;
    if (wallClockMs === 0) {
      // Zero-length span: attribute the entire billable duration to the single
      // segment (classified by startTime).
      billableMinutes = billableDuration;
    } else {
      const segmentMs = Math.max(0, segment.end.getTime() - segment.start.getTime());
      billableMinutes = billableDuration * (segmentMs / wallClockMs);
    }

    return {
      start: segment.start,
      end: segment.end,
      isBusinessHours: segment.isBusinessHours,
      multiplier,
      billableMinutes,
      weightedMinutes: billableMinutes * multiplier,
    };
  });

  const weightedMinutes = round2(segments.reduce((sum, segment) => sum + segment.weightedMinutes, 0));

  return { weightedMinutes, segments };
}

/**
 * Convenience predicate for zero-length draws (usage tracking has no time
 * span). Whether the after-hours rule applies is decided by the instant itself.
 */
export function isAfterHoursInstant(
  schedule: BusinessHoursScheduleInput,
  instant: Date
): boolean {
  return !isWithinBusinessHours(schedule, instant);
}

export { round2 };
