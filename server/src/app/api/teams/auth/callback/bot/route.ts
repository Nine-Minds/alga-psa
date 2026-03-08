import { dynamic, runtime, eeUnavailable } from '../../../_ceStub';
import { loadTeamsEeRoute, teamsOptionsResponse } from '../../../_eeDelegator';

export { dynamic, runtime };

type EeRouteModule = {
  GET?: (req: Request) => Promise<Response>;
};

async function loadEeRoute(): Promise<EeRouteModule | null> {
  return loadTeamsEeRoute(
    'teams/auth/callback/bot',
    async () => import('@enterprise/app/api/teams/auth/callback/bot/route') as Promise<EeRouteModule>
  );
}

export async function GET(request: Request): Promise<Response> {
  const eeRoute = await loadEeRoute();
  if (!eeRoute?.GET) {
    return eeUnavailable();
  }

  return eeRoute.GET(request);
}

export async function OPTIONS(): Promise<Response> {
  return teamsOptionsResponse('GET, OPTIONS');
}
