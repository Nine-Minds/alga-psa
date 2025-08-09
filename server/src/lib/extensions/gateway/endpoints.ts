export interface EndpointDef {
  method: string;
  path: string;
  handler: string;
}

export function matchEndpoint(endpoints: EndpointDef[], method: string, path: string): EndpointDef | null {
  // Simple exact match placeholder
  const m = endpoints.find((e) => e.method.toUpperCase() === method.toUpperCase() && e.path === path);
  return m || null;
}

