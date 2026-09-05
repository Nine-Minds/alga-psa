import type { TicketScreenBootstrap } from '../../../lib/ticketScreenBootstrap';

/**
 * Pins TicketDetails to the Entry layout for specs that assert against the
 * Entry rendering (they read the props TicketDetails hands to <TicketInfo>,
 * which the Grid/bento layout does not render).
 *
 * Grid is the default for a user with no stored `ticket_detail_layout`
 * preference, so without this the specs would silently exercise the bento
 * layout instead. Every other bootstrap field stays null so the component's
 * fetch-on-mount effects behave exactly as they do without a bootstrap.
 */
export const entryLayoutBootstrap: TicketScreenBootstrap = {
  layoutPreference: { layout: 'entry', timelineOrder: 'asc' },
  checklistItems: null,
  autoCloseState: null,
  canViewCommentMetadataDebug: null,
  teams: null,
  displaySettings: null,
  tags: null,
  streams: null,
};
