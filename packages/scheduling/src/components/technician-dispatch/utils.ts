import { WorkItemType } from '@alga-psa/types';

export const calculateTimeFromPosition = (
  x: number,
  rect: DOMRect,
  selectedDate: Date
): Date => {
  const relativeX = Math.max(0, Math.min(x - rect.left, rect.width));
  const totalMinutesInDay = 24 * 60;
  const minutes = (relativeX / rect.width) * totalMinutesInDay;
  const roundedMinutes = Math.round(minutes / 15) * 15;
  const hour = Math.floor(roundedMinutes / 60);
  const minute = roundedMinutes % 60;

  const time = new Date(selectedDate);
  time.setHours(hour, minute, 0, 0);
  return time;
};

export const isWorkingHour = (hour: number): boolean => {
  return hour >= 8 && hour < 17; // 8 AM to 5 PM
};

// A dispatch chip keeps its base fill and swaps to the hover one on CSS :hover,
// which an inline colour cannot follow, so the two inks the calendar chips use
// live here as classes as well. This file is listed in the Tailwind content
// globs; the literals below are what makes the utilities exist at all.
const INK_CLASS_ON_LIGHT_FILL = 'text-[rgb(3_7_18)]';
const INK_CLASS_ON_DARK_FILL = 'text-[rgb(255_255_255)]';
const HOVER_INK_CLASS_ON_LIGHT_FILL = 'hover:text-[rgb(3_7_18)]';
const HOVER_INK_CLASS_ON_DARK_FILL = 'hover:text-[rgb(255_255_255)]';

export const inkClassForFill = (fillIsLight: boolean): string =>
  fillIsLight ? INK_CLASS_ON_LIGHT_FILL : INK_CLASS_ON_DARK_FILL;

export const hoverInkClassForFill = (fillIsLight: boolean): string =>
  fillIsLight ? HOVER_INK_CLASS_ON_LIGHT_FILL : HOVER_INK_CLASS_ON_DARK_FILL;

/**
 * Chip colours for the dispatch board. `fill`/`hoverFill` name the theme token
 * the chip is painted with so the caller can read its luminance and pick ink
 * that survives every theme pair: `--color-text-900` does not, because a light
 * fill such as ad hoc on high-contrast dark carries a light text token with it.
 * The two palette-based types keep their own `text`, which already has a dark
 * variant.
 */
export const getEventColors = (
  type: WorkItemType,
  isPrimary: boolean,
  isComparison: boolean
) => {
  let bg = 'bg-[rgb(var(--color-primary-200))]';
  let hover = 'hover:bg-[rgb(var(--color-primary-300))]';
  let text = 'text-[rgb(var(--color-text-900))]';
  let fill: string | null = '--color-primary-200';
  let hoverFill: string | null = '--color-primary-300';

  switch (type) {
    case 'ticket':
      bg = 'bg-[rgb(var(--color-primary-200))]';
      hover = 'hover:bg-[rgb(var(--color-primary-300))]';
      fill = '--color-primary-200';
      hoverFill = '--color-primary-300';
      break;
    case 'project_task':
      bg = 'bg-[rgb(var(--color-secondary-100))]';
      hover = 'hover:bg-[rgb(var(--color-secondary-200))]';
      fill = '--color-secondary-100';
      hoverFill = '--color-secondary-200';
      break;
    case 'ad_hoc':
      bg = 'bg-[rgb(var(--color-border-200))]';
      hover = 'hover:bg-[rgb(var(--color-border-300))]';
      fill = '--color-border-200';
      hoverFill = '--color-border-300';
      break;
    case 'non_billable_category':
      bg = 'bg-[rgb(var(--color-accent-100))]';
      hover = 'hover:bg-[rgb(var(--color-accent-200))]';
      fill = '--color-accent-100';
      hoverFill = '--color-accent-200';
      break;
    case 'interaction':
      bg = 'bg-green-100 dark:bg-green-900/30';
      hover = 'hover:bg-green-200 dark:hover:bg-green-900/50';
      text = 'text-green-900 dark:text-green-300';
      fill = null;
      hoverFill = null;
      break;
    case 'appointment_request':
      bg = 'bg-rose-200 dark:bg-rose-900/30';
      hover = 'hover:bg-rose-300 dark:hover:bg-rose-900/50';
      text = 'text-[rgb(var(--color-text-900))]';
      fill = null;
      hoverFill = null;
      break;
    case 'opportunity_step':
      bg = 'bg-[rgb(var(--color-event-opportunity))]';
      hover = 'hover:bg-[rgb(var(--color-event-opportunity-hover))]';
      fill = '--color-event-opportunity';
      hoverFill = '--color-event-opportunity-hover';
      break;
  }

  return { bg, hover, text, fill, hoverFill };
};
