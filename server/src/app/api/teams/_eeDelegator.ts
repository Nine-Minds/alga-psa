import { isEnterpriseEdition } from './_ceStub';

const eeRouteModulePromises = new Map<string, Promise<unknown | null>>();

export async function loadTeamsEeRoute<T>(
  routeKey: string,
  importer: () => Promise<T>
): Promise<T | null> {
  if (!isEnterpriseEdition) {
    return null;
  }

  if (!eeRouteModulePromises.has(routeKey)) {
    eeRouteModulePromises.set(
      routeKey,
      importer().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[${routeKey}] Failed to load EE route: ${message}`);
        return null;
      })
    );
  }

  return (await eeRouteModulePromises.get(routeKey)) as T | null;
}

export function teamsOptionsResponse(allow: string): Response {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: allow,
    },
  });
}
