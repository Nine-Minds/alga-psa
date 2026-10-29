/**
 * UI slot surfaces. Later cards mount capability-gated UI into these ids
 * (registered server-side, mounted client-side); they do not invent surfaces.
 */
export const UI_SLOT_SURFACES = [
  'ticket.details.sidebar',
  'ticket.details.header',
  'project.details.tab',
  'client.details.tab',
] as const;

export type UiSlotSurface = (typeof UI_SLOT_SURFACES)[number];

export function isUiSlotSurface(value: unknown): value is UiSlotSurface {
  return typeof value === 'string' && (UI_SLOT_SURFACES as readonly string[]).includes(value);
}
