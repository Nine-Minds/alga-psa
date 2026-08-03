/**
 * Platform Reports Access API - CE Stub
 *
 * This stub lazy-loads the EE implementation or returns an informative 403 for CE builds.
 */

import { NextRequest, NextResponse } from 'next/server';
import { editionGateResponse } from '@/lib/editionGating/response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const isEnterpriseEdition =
  (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
  (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise';

type EeRouteModule = {
  POST: (req: NextRequest) => Promise<NextResponse>;
  OPTIONS?: (req: NextRequest) => Promise<NextResponse>;
};

let eeRouteModulePromise: Promise<EeRouteModule | null> | null = null;

async function loadEeRoute(): Promise<EeRouteModule | null> {
  if (!isEnterpriseEdition) {
    return null;
  }

  if (!eeRouteModulePromise) {
    eeRouteModulePromise = import('@enterprise/app/api/v1/platform-reports/access/route')
      .then((module) => module as unknown as EeRouteModule)
      .catch((error) => {
        console.error('[v1/platform-reports/access] Failed to load EE route', error);
        return null;
      });
  }

  return eeRouteModulePromise;
}

function eeUnavailable(): NextResponse {
  if (isEnterpriseEdition) {
    throw new Error('The Enterprise route failed to load.');
  }
  return editionGateResponse('platform-reports');
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const eeRoute = await loadEeRoute();
  if (!eeRoute?.POST) {
    return eeUnavailable();
  }
  return eeRoute.POST(request);
}

export async function OPTIONS(request: NextRequest): Promise<NextResponse> {
  const eeRoute = await loadEeRoute();
  if (!eeRoute?.OPTIONS) {
    return new NextResponse(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }
  return eeRoute.OPTIONS(request);
}
