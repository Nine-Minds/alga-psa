export function getActiveRouteName(state: any): string | null {
  let current: any = state;
  while (current && Array.isArray(current.routes) && typeof current.index === "number") {
    const route = current.routes[current.index];
    if (!route) return null;
    if (route.state) current = route.state;
    else return typeof route.name === "string" ? route.name : null;
  }
  return null;
}

