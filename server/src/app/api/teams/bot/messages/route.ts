import { dynamic, runtime, eeUnavailable, isEnterpriseEdition } from '../../_ceStub';

export { dynamic, runtime };

type EeRouteModule = {
  POST: (req: Request) => Promise<Response>;
};

let eeRouteModulePromise: Promise<EeRouteModule | null> | null = null;

async function loadEeRoute(): Promise<EeRouteModule | null> {
  if (!isEnterpriseEdition) {
    return null;
  }

  if (!eeRouteModulePromise) {
    eeRouteModulePromise = import('@enterprise/app/api/teams/bot/messages/route')
      .then((module) => module as unknown as EeRouteModule)
      .catch((error) => {
        console.error('[teams/bot/messages] Failed to load EE route', error);
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
