import { dynamic, runtime, eeUnavailable, isEnterpriseEdition } from '../../../_ceStub';

export { dynamic, runtime };

type EeRouteModule = {
  GET: (req: Request) => Promise<Response>;
};

let eeRouteModulePromise: Promise<EeRouteModule | null> | null = null;

async function loadEeRoute(): Promise<EeRouteModule | null> {
  if (!isEnterpriseEdition) {
    return null;
  }

  if (!eeRouteModulePromise) {
    eeRouteModulePromise = import('@enterprise/app/api/teams/auth/callback/message-extension/route')
      .then((module) => module as unknown as EeRouteModule)
      .catch((error) => {
        console.error('[teams/auth/callback/message-extension] Failed to load EE route', error);
        return null;
      });
  }

  return eeRouteModulePromise;
}

export async function GET(request: Request): Promise<Response> {
  const eeRoute = await loadEeRoute();
  if (!eeRoute?.GET) {
    return eeUnavailable();
  }

  return eeRoute.GET(request);
}
