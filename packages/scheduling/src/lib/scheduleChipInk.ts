import type { WorkItemType } from '@alga-psa/types';

/** The fill each work item type paints its calendar chip with, base and hover. */
export const workItemFills: Record<WorkItemType, string> = {
  ticket: '--color-primary-200',
  project_task: '--color-secondary-100',
  non_billable_category: '--color-event-non-billable',
  ad_hoc: '--color-border-200',
  interaction: '--color-event-interaction',
  appointment_request: '--color-event-appointment',
  opportunity_step: '--color-event-opportunity',
};

export const workItemHoverFills: Record<WorkItemType, string> = {
  ticket: '--color-primary-300',
  project_task: '--color-secondary-200',
  non_billable_category: '--color-event-non-billable-hover',
  ad_hoc: '--color-border-300',
  interaction: '--color-event-interaction-hover',
  appointment_request: '--color-event-appointment-hover',
  opportunity_step: '--color-event-opportunity-hover',
};

export const DEFAULT_FILL = '--color-border-200';
export const DEFAULT_HOVER_FILL = '--color-border-300';

// The fills above are theme tokens, and across the nine pairs they land
// anywhere from near-black (ad hoc on the dark pairs) to near-white (ad hoc on
// high-contrast dark), so neither the mode nor a single text token decides what
// is readable on them — the fill itself does.
export const INK_ON_LIGHT_FILL = 'rgb(3 7 18)';
export const INK_ON_DARK_FILL = 'rgb(255 255 255)';

/** Near-black ink on a light fill, white on a dark one. */
export const inkForFill = (fillIsLight: boolean): string =>
  fillIsLight ? INK_ON_LIGHT_FILL : INK_ON_DARK_FILL;

export const fillTokenFor = (type: WorkItemType | undefined, isHovered: boolean): string => {
  const fills = isHovered ? workItemHoverFills : workItemFills;
  const fallback = isHovered ? DEFAULT_HOVER_FILL : DEFAULT_FILL;
  return (type && fills[type]) || fallback;
};
