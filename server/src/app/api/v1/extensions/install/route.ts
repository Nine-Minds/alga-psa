import { NextResponse, type NextRequest } from 'next/server';
import { assertSessionProductAccess } from '@/lib/api/standaloneProductGuards';
import { withApiKeyAuth } from '@/lib/api/middleware/apiAuthMiddleware';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const isEnterpriseEdition =
  (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
  (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise';

type EeRouteModule = {
  POST: (req: NextRequest) => Promise<NextResponse> | NextResponse;
};

let eeRouteModulePromise: Promise<EeRouteModule | null> | null = null;

async function loadEeRoute(): Promise<EeRouteModule | null> {
  if (!isEnterpriseEdition) {
    return null;
  }

  if (!eeRouteModulePromise) {
    eeRouteModulePromise = import('@enterprise/app/api/v1/extensions/install/route')
      .then((module) => module as EeRouteModule)
      .catch((error) => {
        console.error('[v1/extensions/install] Failed to load EE route', error);
        return null;
      });
  }

  return eeRouteModulePromise;
}

function eeUnavailable(): NextResponse {
  return new NextResponse(
    JSON.stringify({
      error: 'Extension installation API is only available in the Enterprise Edition.'
    }),
    {
      status: 501,
      headers: { 'content-type': 'application/json' }
    }
  );
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!isEnterpriseEdition && request.headers.get('x-api-key')) {
    return (await withApiKeyAuth(async () => eeUnavailable()))(request);
  }
  // The EE handler validates API keys and enforces the tenant product gate.
  // Requiring a browser session first prevents authenticated API clients from
  // reaching that handler. CE and session requests retain their existing gate.
  const deniedResponse = isEnterpriseEdition && request.headers.get('x-api-key')
    ? null : await assertSessionProductAccess({
    capability: 'extensions',
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
