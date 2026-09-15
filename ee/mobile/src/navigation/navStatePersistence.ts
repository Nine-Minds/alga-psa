/**
 * Route params that describe a one-off drill-down (e.g. "tickets for this
 * client" from the client screen) must not outlive the session that created
 * them: restoring them on the next launch leaves the tickets list silently
 * stuck on that client. They are stripped before the navigation state is saved.
 */
const TRANSIENT_ROUTE_PARAMS: Record<string, string[]> = {
  TicketsList: ["clientId", "clientName", "contactId", "contactName"],
};

type RouteLike = { name?: string; params?: Readonly<object> | undefined; state?: StateLike };
type StateLike = { routes?: readonly RouteLike[] };

export function stripTransientRouteParams<T extends StateLike | undefined>(state: T): T {
  if (!state || !Array.isArray(state.routes)) return state;
  let changed = false;
  const routes = state.routes.map((route) => {
    let next = route;
    const transient = route.name ? TRANSIENT_ROUTE_PARAMS[route.name] : undefined;
    if (transient && route.params && transient.some((key) => key in (route.params as object))) {
      const params: Record<string, unknown> = { ...(route.params as Record<string, unknown>) };
      for (const key of transient) delete params[key];
      next = { ...next, params: Object.keys(params).length > 0 ? params : undefined };
      changed = true;
    }
    if (route.state) {
      const nested = stripTransientRouteParams(route.state);
      if (nested !== route.state) {
        next = { ...next, state: nested };
        changed = true;
      }
    }
    return next;
  });
  return changed ? ({ ...state, routes } as T) : state;
}
