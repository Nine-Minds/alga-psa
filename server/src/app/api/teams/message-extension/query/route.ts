import { eeUnavailable } from '../../_ceStub';
import { loadTeamsEeRoute, teamsOptionsResponse } from '../../_eeDelegator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type EeRouteModule = {
  POST?: (req: Request) => Promise<Response>;
};

async function loadEeRoute(): Promise<EeRouteModule | null> {
  return loadTeamsEeRoute(
    'teams/message-extension/query',
    async () => import('@enterprise/app/api/teams/message-extension/query/route') as Promise<EeRouteModule>
  );
}

export async function POST(request: Request): Promise<Response> {
  const eeRoute = await loadEeRoute();
  if (!eeRoute?.POST) {
    return eeUnavailable();
  }

  return eeRoute.POST(request);
}

export async function OPTIONS(): Promise<Response> {
  return teamsOptionsResponse('POST, OPTIONS');
}
