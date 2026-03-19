import { NextRequest } from 'next/server';
import { dynamic, eeUnavailable } from '../../../calendar/_ceStub';
import { loadCalendarEeRoute } from '../../../calendar/_eeDelegator';

type EeRouteModule = {
  GET: (request: NextRequest) => Promise<Response>;
};

export { dynamic };

export async function GET(request: NextRequest): Promise<Response> {
  const eeRoute = await loadCalendarEeRoute<EeRouteModule>(
    'auth/microsoft/calendar/callback',
    async () =>
      import('@alga-psa/ee-calendar/routes').then((mod) => ({
        GET: mod.handleMicrosoftCalendarOAuthCallbackGet,
      })) as Promise<EeRouteModule>
  );

  if (!eeRoute?.GET) {
    return eeUnavailable();
  }

  return eeRoute.GET(request);
}
