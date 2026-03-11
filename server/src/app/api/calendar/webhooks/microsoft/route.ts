import { NextRequest } from 'next/server';
import { dynamic, eeUnavailable } from '../../_ceStub';
import { loadCalendarEeRoute } from '../../_eeDelegator';

type EeRouteModule = {
  GET?: (request: NextRequest) => Promise<Response>;
  POST?: (request: NextRequest) => Promise<Response>;
  OPTIONS?: (request: NextRequest) => Promise<Response>;
};

export { dynamic };

async function loadRoute(): Promise<EeRouteModule | null> {
  return loadCalendarEeRoute<EeRouteModule>(
    'calendar/webhooks/microsoft',
    async () =>
      import('@alga-psa/ee-calendar/routes').then((mod) => ({
        GET: mod.handleMicrosoftCalendarWebhookGet,
        POST: mod.handleMicrosoftCalendarWebhookPost,
        OPTIONS: mod.handleMicrosoftCalendarWebhookOptions,
      })) as Promise<EeRouteModule>
  );
}

export async function GET(request: NextRequest): Promise<Response> {
  const eeRoute = await loadRoute();
  if (!eeRoute?.GET) {
    return eeUnavailable();
  }

  return eeRoute.GET(request);
}

export async function POST(request: NextRequest): Promise<Response> {
  const eeRoute = await loadRoute();
  if (!eeRoute?.POST) {
    return eeUnavailable();
  }

  return eeRoute.POST(request);
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  const eeRoute = await loadRoute();
  if (!eeRoute?.OPTIONS) {
    return eeUnavailable();
  }

  return eeRoute.OPTIONS(request);
}
