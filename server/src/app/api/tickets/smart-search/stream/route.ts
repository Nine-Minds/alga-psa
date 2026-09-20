/**
 * Smart ticket search stream: community-edition delegator.
 *
 * The handler lives in the enterprise tree
 * (ee/server/src/app/api/tickets/smart-search/stream/route.ts) and is reached
 * through the edition-swapped `@enterprise` alias, the same shape as the Hudu
 * integration routes. Community edition resolves the alias to a stub that
 * answers 404, so no smart-search code ships in CE.
 */

import { eeUnavailable, isEnterpriseEdition } from './_ceStub';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type EeRouteModule = {
  POST: (req: Request) => Promise<Response>;
};

let eeRouteModulePromise: Promise<EeRouteModule | null> | null = null;

async function loadEeRoute(): Promise<EeRouteModule | null> {
  if (!isEnterpriseEdition) {
    return null;
  }
  if (!eeRouteModulePromise) {
    eeRouteModulePromise = import('@enterprise/app/api/tickets/smart-search/stream/route')
      .then((module) => module as unknown as EeRouteModule)
      .catch((error) => {
        console.error('[tickets/smart-search] Failed to load EE route', error);
        return null;
      });
  }
  return eeRouteModulePromise;
}

export async function POST(request: Request): Promise<Response> {
  const eeRoute = await loadEeRoute();
  if (!eeRoute?.POST) {
    return eeUnavailable();
  }
  return eeRoute.POST(request);
}
