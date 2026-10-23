/**
 * Route params that describe a one-off drill-down (e.g. "tickets for this
 * client" from the client screen) must not outlive the session that created
 * them: restoring them on the next launch leaves the tickets list silently
 * stuck on that client. They are stripped before the navigation state is saved.
 *
 * A nested navigate (`navigate("Tabs", { screen, params: { screen, params } })`)
 * also copies the drill-down onto every ancestor route's params, and React
 * Navigation replays those into the child when the nested navigator is
 * re-initialised. Those copies are scrubbed too.
 */
const TRANSIENT_ROUTE_PARAMS: Record<string, string[]> = {
  TicketsList: ["clientId", "clientName", "contactId", "contactName"],
};

type Params = Record<string, unknown>;
type RouteLike = { name?: string; params?: Readonly<object> | undefined; state?: StateLike };
type StateLike = { routes?: readonly RouteLike[] };

const omitKeys = (params: Params, keys: readonly string[]): Params | undefined => {
  if (!keys.some((key) => key in params)) return params;
  const next = { ...params };
  for (const key of keys) delete next[key];
  return Object.keys(next).length > 0 ? next : undefined;
};

/** Scrub `{ screen, params: { screen, params: … } }` chains left by nested navigates. */
function stripNestedScreenParams(params: Params | undefined): Params | undefined {
  if (!params || typeof params.screen !== "string") return params;
  const inner = params.params;
  if (!inner || typeof inner !== "object") return params;
  const transient = TRANSIENT_ROUTE_PARAMS[params.screen];
  const scrubbed = transient ? omitKeys(inner as Params, transient) : (inner as Params);
  const deeper = stripNestedScreenParams(scrubbed);
  if (deeper === inner) return params;
  const next = { ...params };
  if (deeper === undefined) delete next.params;
  else next.params = deeper;
  return next;
}

export function stripTransientRouteParams<T extends StateLike | undefined>(state: T): T {
  if (!state || !Array.isArray(state.routes)) return state;
  let changed = false;
  const routes = state.routes.map((route) => {
    let next = route;
    const transient = route.name ? TRANSIENT_ROUTE_PARAMS[route.name] : undefined;
    let params = route.params as Params | undefined;
    if (transient && params) params = omitKeys(params, transient);
    params = stripNestedScreenParams(params);
    if (params !== route.params) {
      next = { ...next, params };
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
