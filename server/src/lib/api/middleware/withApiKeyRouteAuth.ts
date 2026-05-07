import type { NextRequest, NextResponse } from 'next/server';

import type { ApiRequest } from './apiMiddleware';
import { withApiKeyAuth } from './apiAuthMiddleware';
import { appendRateLimitHeaders } from '../rateLimit/responseHeaders';

type RouteContext<TParams> = {
  params: Promise<TParams>;
};

export function withApiKeyRouteAuth<TParams extends Record<string, string> = Record<string, string>>(
  handler: (req: ApiRequest, context: RouteContext<TParams>) => Promise<NextResponse>,
) {
  return async (
    request: NextRequest,
    context: RouteContext<TParams>,
  ): Promise<NextResponse> => {
    const authedHandler = await withApiKeyAuth(async (req) => {
      const response = await handler(req, context);
      return appendRateLimitHeaders(response, req);
    });

    return authedHandler(request);
  };
}
