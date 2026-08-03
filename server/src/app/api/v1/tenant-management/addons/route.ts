/**
 * Tenant Management API - Supported add-ons - CE Stub
 */

import { editionGateResponse } from '@/lib/editionGating/response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const isEnterpriseEdition =
  (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
  (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise';

type EeRouteModule = {
  GET: (req: Request) => Promise<Response>;
};

let eeRouteModulePromise: Promise<EeRouteModule | null> | null = null;

async function loadEeRoute(): Promise<EeRouteModule | null> {
  if (!isEnterpriseEdition) return null;

  if (!eeRouteModulePromise) {
    eeRouteModulePromise = import('@enterprise/app/api/v1/tenant-management/addons/route')
      .then((module) => module as unknown as EeRouteModule)
      .catch((error) => {
        console.error('[v1/tenant-management/addons] Failed to load EE route', error);
        return null;
      });
  }

  return eeRouteModulePromise;
}

function eeUnavailable(): Response {
  if (isEnterpriseEdition) {
    throw new Error('The Enterprise route failed to load.');
  }
  return editionGateResponse('tenant-management');
}

export async function GET(request: Request): Promise<Response> {
  const eeRoute = await loadEeRoute();
  if (!eeRoute?.GET) return eeUnavailable();
  return eeRoute.GET(request);
}
