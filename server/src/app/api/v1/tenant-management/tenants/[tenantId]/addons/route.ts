/**
 * Tenant Management API - Tenant add-ons - CE Stub
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const isEnterpriseEdition =
  (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
  (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise';

type RouteContext = {
  params: Promise<{ tenantId: string }>;
};

type EeRouteModule = {
  POST: (req: Request, context: RouteContext) => Promise<Response>;
};

let eeRouteModulePromise: Promise<EeRouteModule | null> | null = null;

async function loadEeRoute(): Promise<EeRouteModule | null> {
  if (!isEnterpriseEdition) return null;

  if (!eeRouteModulePromise) {
    eeRouteModulePromise = import('@enterprise/app/api/v1/tenant-management/tenants/[tenantId]/addons/route')
      .then((module) => module as unknown as EeRouteModule)
      .catch((error) => {
        console.error('[v1/tenant-management/tenants/:tenantId/addons] Failed to load EE route', error);
        return null;
      });
  }

  return eeRouteModulePromise;
}

function eeUnavailable(): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: 'Tenant management is only available in Enterprise Edition.',
    }),
    {
      status: 501,
      headers: { 'content-type': 'application/json' },
    }
  );
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const eeRoute = await loadEeRoute();
  if (!eeRoute?.POST) return eeUnavailable();
  return eeRoute.POST(request, context);
}
