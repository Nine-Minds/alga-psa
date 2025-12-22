/**
 * Tenant Management API - Resend Welcome Email - CE Stub
 *
 * This stub lazy-loads the EE implementation or returns 501 for CE builds.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const isEnterpriseEdition =
  (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
  (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise';

type EeRouteModule = {
  POST: (req: Request) => Promise<Response>;
};

let eeRouteModulePromise: Promise<EeRouteModule | null> | null = null;

async function loadEeRoute(): Promise<EeRouteModule | null> {
  if (!isEnterpriseEdition) {
    return null;
  }

  if (!eeRouteModulePromise) {
    eeRouteModulePromise = import('@ee/app/api/v1/tenant-management/resend-welcome-email/route')
      .then((module) => module as EeRouteModule)
      .catch((error) => {
        console.error('[v1/tenant-management/resend-welcome-email] Failed to load EE route', error);
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

export async function POST(request: Request): Promise<Response> {
  const eeRoute = await loadEeRoute();
  if (!eeRoute?.POST) {
    return eeUnavailable();
  }
  return eeRoute.POST(request);
}
