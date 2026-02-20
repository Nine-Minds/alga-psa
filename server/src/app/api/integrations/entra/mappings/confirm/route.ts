import {
  dynamic,
  runtime,
  eeUnavailable,
  isEnterpriseEdition,
  optionsResponse,
} from '../../_ceStub';

export { dynamic, runtime };

type EeRouteModule = {
  POST: (req: Request) => Promise<Response>;
  OPTIONS?: (req: Request) => Promise<Response>;
};

let eeRouteModulePromise: Promise<EeRouteModule | null> | null = null;

async function loadEeRoute(): Promise<EeRouteModule | null> {
  if (!isEnterpriseEdition) {
    return null;
  }

  if (!eeRouteModulePromise) {
    eeRouteModulePromise = import('@enterprise/app/api/integrations/entra/mappings/confirm/route')
      .then((module) => module as unknown as EeRouteModule)
      .catch((error) => {
        console.error('[integrations/entra/mappings/confirm] Failed to load EE route', error);
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

export async function OPTIONS(request: Request): Promise<Response> {
  const eeRoute = await loadEeRoute();
  if (!eeRoute?.OPTIONS) {
    return optionsResponse('POST, OPTIONS');
  }
  return eeRoute.OPTIONS(request);
}
