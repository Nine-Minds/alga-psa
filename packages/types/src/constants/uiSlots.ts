/**
 * UI slot surfaces. Later cards mount capability-gated UI into these ids
 * (registered server-side, mounted client-side). A new surface is added to
 * this list, with the test in uiSlots.test.ts; it is never an ad-hoc string.
 */
export const UI_SLOT_SURFACES = [
  'ticket.details.sidebar',
  'ticket.details.header',
  'project.details.tab',
  'client.details.tab',
  // MSP sidebar groups (NavigationSection-shaped props). Merged into the base
  // menu before the edition/tier/permission/product filters, so a contribution
  // can never bypass them.
  'msp.navigation.group',
  // Conversation surfaces (L4b). Hosts mount these per comment / per thread; a host that
  // does not render them leaves the base conversation untouched.
  'ticket.conversation.comment-attachments',
  'ticket.conversation.thread-header',
] as const;

export type UiSlotSurface = (typeof UI_SLOT_SURFACES)[number];

export function isUiSlotSurface(value: unknown): value is UiSlotSurface {
  return typeof value === 'string' && (UI_SLOT_SURFACES as readonly string[]).includes(value);
}
