export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest } from 'next/server';

const isEnterpriseEdition =
  (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
  (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise';

type EeRouteModule = {
  POST: (req: NextRequest, ctx: { params: { installId: string } }) => Promise<Response> | Response;
};

let eeRouteModulePromise: Promise<EeRouteModule | null> | null = null;

async function loadEeRoute(): Promise<EeRouteModule | null> {
  if (!isEnterpriseEdition) {
    return null;
  }

  if (!eeRouteModulePromise) {
    eeRouteModulePromise = import('@enterprise/app/api/internal/ext-invoicing/install/[installId]/route')
      .then((module) => module as EeRouteModule)
      .catch((error) => {
        console.error('[internal/ext-invoicing] Failed to load EE route', error);
        return null;
      });
  }

  return eeRouteModulePromise;
}

function eeUnavailable(): Response {
  return new Response(
    JSON.stringify({
      error: 'Extension invoicing is only available in the Enterprise Edition.',
      code: 'EE_REQUIRED',
    }),
    { status: 501, headers: { 'content-type': 'application/json' } }
  );
}

export async function POST(
  request: NextRequest,
  ctx: { params: { installId: string } }
): Promise<Response> {
  const eeRoute = await loadEeRoute();
  if (!eeRoute?.POST) {
    return eeUnavailable();
  }
  return eeRoute.POST(request, ctx);
}
