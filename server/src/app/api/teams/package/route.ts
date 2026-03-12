import { eeUnavailable } from '../_ceStub';
import { loadTeamsEeRoute, teamsOptionsResponse } from '../_eeDelegator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type EeRouteModule = {
  GET?: (req: Request) => Promise<Response>;
  POST?: (req: Request) => Promise<Response>;
};

async function loadEeRoute(): Promise<EeRouteModule | null> {
  return loadTeamsEeRoute(
    'teams/package',
    async () => import('@enterprise/app/api/teams/package/route') as Promise<EeRouteModule>
  );
}

export async function GET(request: Request): Promise<Response> {
  const eeRoute = await loadEeRoute();
  if (!eeRoute?.GET) {
    return eeUnavailable();
  }

  return eeRoute.GET(request);
}

export async function POST(request: Request): Promise<Response> {
  const eeRoute = await loadEeRoute();
  if (!eeRoute?.POST) {
    return eeUnavailable();
  }

  return eeRoute.POST(request);
}

export async function OPTIONS(): Promise<Response> {
  return teamsOptionsResponse('GET, POST, OPTIONS');
}
