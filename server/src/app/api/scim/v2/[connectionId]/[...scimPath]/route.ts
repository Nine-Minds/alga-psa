export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = {
  params: Promise<{
    connectionId: string;
    scimPath: string[];
  }>;
};

type EeRoute = {
  GET: (request: Request, context: Context) => Promise<Response>;
  POST: (request: Request, context: Context) => Promise<Response>;
  PUT: (request: Request, context: Context) => Promise<Response>;
  PATCH: (request: Request, context: Context) => Promise<Response>;
  DELETE: (request: Request, context: Context) => Promise<Response>;
  OPTIONS: (request: Request, context: Context) => Response | Promise<Response>;
};

const isEnterpriseEdition =
  process.env.EDITION === 'ee'
  || process.env.EDITION === 'enterprise'
  || process.env.NEXT_PUBLIC_EDITION === 'enterprise';

let eeRoutePromise: Promise<EeRoute | null> | null = null;

async function loadEeRoute(): Promise<EeRoute | null> {
  if (!isEnterpriseEdition) return null;
  if (!eeRoutePromise) {
    eeRoutePromise = import('@enterprise/app/api/scim/v2/[connectionId]/[...scimPath]/route')
      .then((module) => module as unknown as EeRoute)
      .catch((error) => {
        console.error('[scim] Failed to load EE SCIM provider', {
          message: error instanceof Error ? error.message : 'Unknown error',
        });
        return null;
      });
  }
  return eeRoutePromise;
}

function unavailable(): Response {
  return new Response(null, { status: 404 });
}

async function delegate(
  method: keyof EeRoute,
  request: Request,
  context: Context
): Promise<Response> {
  const route = await loadEeRoute();
  if (!route) return unavailable();
  return route[method](request, context);
}

export const GET = (request: Request, context: Context) => delegate('GET', request, context);
export const POST = (request: Request, context: Context) => delegate('POST', request, context);
export const PUT = (request: Request, context: Context) => delegate('PUT', request, context);
export const PATCH = (request: Request, context: Context) => delegate('PATCH', request, context);
export const DELETE = (request: Request, context: Context) => delegate('DELETE', request, context);
export const OPTIONS = (request: Request, context: Context) => delegate('OPTIONS', request, context);
