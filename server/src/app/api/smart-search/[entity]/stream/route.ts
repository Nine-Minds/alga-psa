/**
 * Smart search stream: community-edition delegator.
 *
 * The handler lives in the enterprise tree
 * (ee/server/src/app/api/smart-search/[entity]/stream/route.ts) and is reached
 * through the edition-swapped `@enterprise` alias, the same shape as the Hudu
 * integration routes. Community edition resolves the alias to a stub that
 * answers 404, so no smart-search code ships in CE.
 */

import { eeUnavailable, isEnterpriseEdition } from './_ceStub';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ entity: string }> | { entity: string } };

type EeRouteModule = {
  POST: (req: Request, context: RouteContext) => Promise<Response>;
};

let eeRouteModulePromise: Promise<EeRouteModule | null> | null = null;

async function loadEeRoute(): Promise<EeRouteModule | null> {
  if (!isEnterpriseEdition) {
    return null;
  }
  if (!eeRouteModulePromise) {
    eeRouteModulePromise = import('@enterprise/app/api/smart-search/[entity]/stream/route')
      .then((module) => module as unknown as EeRouteModule)
      .catch((error) => {
        console.error('[smart-search] Failed to load EE route', error);
        return null;
      });
  }
  return eeRouteModulePromise;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const eeRoute = await loadEeRoute();
  if (!eeRoute?.POST) {
    return eeUnavailable();
  }
  return eeRoute.POST(request, context);
}
