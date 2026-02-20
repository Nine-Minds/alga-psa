import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const isEnterpriseEdition =
  (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
  (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise';

type EeRouteModule = {
  GET: (request: NextRequest) => Promise<Response>;
};

let eeRouteModulePromise: Promise<EeRouteModule | null> | null = null;

async function loadEeRoute(): Promise<EeRouteModule | null> {
  if (!isEnterpriseEdition) {
    return null;
  }

  if (!eeRouteModulePromise) {
    eeRouteModulePromise = import('@enterprise/app/api/auth/microsoft/entra/callback/route')
      .then((module) => module as unknown as EeRouteModule)
      .catch((error) => {
        console.error('[auth/microsoft/entra/callback] Failed to load EE route', error);
        return null;
      });
  }

  return eeRouteModulePromise;
}

export async function GET(request: NextRequest): Promise<Response> {
  const eeRoute = await loadEeRoute();
  if (!eeRoute?.GET) {
    return NextResponse.json(
      {
        success: false,
        error: 'Microsoft Entra callback is only available in Enterprise Edition.',
      },
      { status: 501 }
    );
  }

  return eeRoute.GET(request);
}
