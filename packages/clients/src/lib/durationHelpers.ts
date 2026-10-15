const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** An interaction is a single logged contact, so its duration tops out at one day. */
export const MAX_INTERACTION_DURATION_MINUTES = 1440;

export const clampDuration = (hoursInput: string, minutesInput: string) => {
  const parsedHours = parseInt(hoursInput, 10);
  const parsedMinutes = parseInt(minutesInput, 10);

  const hours = Number.isNaN(parsedHours) ? 0 : clamp(parsedHours, 0, 24);
  // When hours=24, force minutes to 0 to cap at exactly 24:00 (1440 minutes)
  const minutes = hours === 24 ? 0 : (Number.isNaN(parsedMinutes) ? 0 : clamp(parsedMinutes, 0, 59));
  const totalMinutes = (hours * 60) + minutes;

  return { hours, minutes, totalMinutes };
};

/**
 * The duration a start/end range actually represents. `hours`/`minutes` are the
 * form fields for that range and stay at zero for an inverted range, which
 * callers must reject rather than display.
 */
export const durationFromRange = (start: Date, end: Date) => {
  const totalMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
  const forFields = Math.max(totalMinutes, 0);

  return {
    hours: Math.floor(forFields / 60),
    minutes: forFields % 60,
    totalMinutes,
    exceedsCap: totalMinutes > MAX_INTERACTION_DURATION_MINUTES,
  };
};

export type InteractionDurationRejectionReason = 'end_before_start' | 'range_exceeds_cap';

export type ReconciledInteractionDuration =
  | { ok: true; duration: number | null }
  | { ok: false; reason: InteractionDurationRejectionReason };

const toDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * The single rule both the quick-add form and the interaction actions enforce: a
 * stored duration is exactly end − start. With both timestamps present the range
 * wins (and an inverted or over-cap range is rejected outright); without them the
 * supplied duration is only clamped to the cap.
 */
export const reconcileInteractionDuration = (interaction: {
  start_time?: Date | string | null;
  end_time?: Date | string | null;
  duration?: number | null;
}): ReconciledInteractionDuration => {
  const start = toDate(interaction.start_time);
  const end = toDate(interaction.end_time);

  if (start && end) {
    const { totalMinutes, exceedsCap } = durationFromRange(start, end);
    if (totalMinutes < 0) return { ok: false, reason: 'end_before_start' };
    if (exceedsCap) return { ok: false, reason: 'range_exceeds_cap' };
    return { ok: true, duration: totalMinutes > 0 ? totalMinutes : null };
  }

  const duration = typeof interaction.duration === 'number' && Number.isFinite(interaction.duration)
    ? clamp(Math.round(interaction.duration), 0, MAX_INTERACTION_DURATION_MINUTES)
    : 0;
  return { ok: true, duration: duration > 0 ? duration : null };
};
