import {
  eeUnavailable,
  isEnterpriseEdition,
  optionsResponse,
} from '../_ceStub';
import { assertSessionProductAccess } from '@/lib/api/standaloneProductGuards';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
    eeRouteModulePromise = import('@enterprise/app/api/integrations/entra/validate-cipp/route')
      .then((module) => module as unknown as EeRouteModule)
      .catch((error) => {
        console.error('[integrations/entra/validate-cipp] Failed to load EE route', error);
        return null;
      });
  }

  return eeRouteModulePromise;
}

export async function POST(request: Request): Promise<Response> {
  const deniedResponse = await assertSessionProductAccess({
    capability: 'integrations',
    allowedProducts: ['psa'],
  });
  if (deniedResponse) {
    return deniedResponse;
  }

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
