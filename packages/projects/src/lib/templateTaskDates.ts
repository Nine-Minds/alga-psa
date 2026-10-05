import { addDays } from 'date-fns';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Days from the phase start to a task's start, as stored on a template task.
 * A start before the phase start has no offset to express, so it is dropped.
 */
export function startOffsetDaysFromDates(
  taskStart: Date | string | null | undefined,
  phaseStart: Date | string | null | undefined,
): number | null {
  if (!taskStart || !phaseStart) return null;
  const offset = Math.round((new Date(taskStart).getTime() - new Date(phaseStart).getTime()) / MS_PER_DAY);
  return offset >= 0 ? offset : null;
}

/**
 * Dates for a task created from a template. Both counts are measured from the
 * phase start. An offset past the due date would give a task that starts after
 * it is due, so that start is left undated.
 */
export function templateTaskDates(params: {
  phaseStart: Date | string | null | undefined;
  durationDays: number | null | undefined;
  startOffsetDays: number | null | undefined;
}): { start_date: Date | null; due_date: Date | null } {
  const { phaseStart, durationDays, startOffsetDays } = params;
  if (!phaseStart) return { start_date: null, due_date: null };
  const anchor = new Date(phaseStart);
  const due_date = durationDays ? addDays(anchor, durationDays) : null;
  const start = startOffsetDays != null ? addDays(anchor, startOffsetDays) : null;
  return { start_date: start && due_date && start > due_date ? null : start, due_date };
}
