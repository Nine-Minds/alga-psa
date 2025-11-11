import { NextRequest, NextResponse } from 'next/server';

type Params = { extensionId: string; path?: string[] };
type EeRouteModule = {
  handle: (req: NextRequest, ctx: { params: Params }) => Promise<NextResponse>;
};

const isEnterpriseEdition =
  (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
  (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise';

let eeRouteModulePromise: Promise<EeRouteModule | null> | null = null;

async function loadEeRoute(): Promise<EeRouteModule | null> {
  if (!isEnterpriseEdition) {
    return null;
  }

  if (!eeRouteModulePromise) {
    eeRouteModulePromise = import('@ee/app/api/ext/[extensionId]/[...path]/route')
      .then((module) => module as EeRouteModule)
      .catch((error) => {
        console.error('[api/ext] Failed to load EE route module', error);
        return null;
      });
  }

  return eeRouteModulePromise;
}

function eeUnavailable(): NextResponse {
  return NextResponse.json(
    { error: 'Extension gateway is only available in the Enterprise Edition.' },
    { status: 501 }
  );
}

async function run(req: NextRequest, ctx: { params: Params }): Promise<NextResponse> {
  const eeRoute = await loadEeRoute();
  if (!eeRoute?.handle) {
    return eeUnavailable();
  }
  return eeRoute.handle(req, ctx);
}

export const GET = run;
export const POST = run;
export const PUT = run;
export const PATCH = run;
export const DELETE = run;
export const OPTIONS = run;
