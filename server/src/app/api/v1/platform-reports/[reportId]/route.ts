/**
 * Platform Reports API - Single Report CE Stub
 *
 * This stub lazy-loads the EE implementation or returns 501 for CE builds.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const isEnterpriseEdition =
  (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
  (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise';

type RouteContext = {
  params: Promise<{ reportId: string }>;
};

type EeRouteModule = {
  GET: (req: Request, context: RouteContext) => Promise<Response>;
  POST: (req: Request, context: RouteContext) => Promise<Response>;
  PUT: (req: Request, context: RouteContext) => Promise<Response>;
  DELETE: (req: Request, context: RouteContext) => Promise<Response>;
  OPTIONS?: (req: Request) => Promise<Response>;
};

let eeRouteModulePromise: Promise<EeRouteModule | null> | null = null;

async function loadEeRoute(): Promise<EeRouteModule | null> {
  if (!isEnterpriseEdition) {
    return null;
  }

  if (!eeRouteModulePromise) {
    eeRouteModulePromise = import('@ee/app/api/v1/platform-reports/[reportId]/route')
      .then((module) => module as unknown as EeRouteModule)
      .catch((error) => {
        console.error('[v1/platform-reports/:id] Failed to load EE route', error);
        return null;
      });
  }

  return eeRouteModulePromise;
}

function eeUnavailable(): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: 'Platform reports are only available in Enterprise Edition.',
    }),
    {
      status: 501,
      headers: { 'content-type': 'application/json' },
    }
  );
}

export async function GET(
  request: Request,
  context: RouteContext
): Promise<Response> {
  const eeRoute = await loadEeRoute();
  if (!eeRoute?.GET) {
    return eeUnavailable();
  }
  return eeRoute.GET(request, context);
}

/**
 * POST handler for __method override (uiProxy only supports GET/POST)
 * Body should contain { __method: 'PUT' | 'DELETE', ...data }
 */
export async function POST(
  request: Request,
  context: RouteContext
): Promise<Response> {
  const eeRoute = await loadEeRoute();
  if (!eeRoute?.POST) {
    return eeUnavailable();
  }
  return eeRoute.POST(request, context);
}

export async function PUT(
  request: Request,
  context: RouteContext
): Promise<Response> {
  const eeRoute = await loadEeRoute();
  if (!eeRoute?.PUT) {
    return eeUnavailable();
  }
  return eeRoute.PUT(request, context);
}

export async function DELETE(
  request: Request,
  context: RouteContext
): Promise<Response> {
  const eeRoute = await loadEeRoute();
  if (!eeRoute?.DELETE) {
    return eeUnavailable();
  }
  return eeRoute.DELETE(request, context);
}

export async function OPTIONS(request: Request): Promise<Response> {
  const eeRoute = await loadEeRoute();
  if (!eeRoute?.OPTIONS) {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }
  return eeRoute.OPTIONS(request);
}
