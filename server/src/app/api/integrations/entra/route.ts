import { dynamic, runtime, eeUnavailable, isEnterpriseEdition, optionsResponse } from './_ceStub';

export { dynamic, runtime };

type EeRouteModule = {
  GET: (req: Request) => Promise<Response>;
  OPTIONS?: (req: Request) => Promise<Response>;
};

let eeRouteModulePromise: Promise<EeRouteModule | null> | null = null;

async function loadEeRoute(): Promise<EeRouteModule | null> {
  if (!isEnterpriseEdition) {
    return null;
  }

  if (!eeRouteModulePromise) {
    eeRouteModulePromise = import('@enterprise/app/api/integrations/entra/route')
      .then((module) => module as unknown as EeRouteModule)
      .catch((error) => {
        console.error('[integrations/entra] Failed to load EE route', error);
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

export async function OPTIONS(request: Request): Promise<Response> {
  const eeRoute = await loadEeRoute();
  if (!eeRoute?.OPTIONS) {
    return optionsResponse('GET, OPTIONS');
  }
  return eeRoute.OPTIONS(request);
}
