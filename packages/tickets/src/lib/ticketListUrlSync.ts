/**
 * When the ticket list is still allowed to write its own state into the URL.
 *
 * The list mirrors its filter state into the address bar with
 * `history.replaceState`, which is correct while the list is the page you are
 * on — and a bug the moment it is not. `router.push('/msp/tickets/<id>')` is
 * asynchronous: the dashboard stays mounted while the detail route resolves, so
 * a debounced search, a page-size preference landing late, or any other
 * deferred writer can still fire inside that window and overwrite the history
 * entry the router just pushed. The router then reconciles to the URL it finds
 * and the ticket that was open for a beat snaps back to the list — on whatever
 * board the late writer happened to be describing.
 *
 * Two independent signals, because neither alone closes the window. The
 * pathname catches a write that lands after the route has already committed;
 * the navigation flag catches the much likelier case of a write that lands
 * while `router.push` is still in flight and `window.location` has not moved
 * yet.
 *
 * Pure, so the rule is testable without mounting the dashboard — same shape as
 * boardTabs.ts and ticketViewSettings.ts.
 */

/** The one route whose state the ticket-list URL sync may describe. */
export const TICKET_LIST_PATHNAME = '/msp/tickets';

export function shouldWriteTicketListUrl(params: {
  /** `window.location.pathname` at write time; null when there is no window. */
  pathname: string | null | undefined;
  /** True once a route change away from the list has been requested. */
  hasNavigatedAway: boolean;
}): boolean {
  if (params.hasNavigatedAway) {
    return false;
  }
  const pathname = (params.pathname ?? '').trim();
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return normalized === TICKET_LIST_PATHNAME;
}
