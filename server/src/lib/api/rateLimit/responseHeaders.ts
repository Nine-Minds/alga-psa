import type { NextResponse } from 'next/server';

import type { ApiRequest } from '../middleware/apiMiddleware';

export function appendRateLimitHeaders(response: NextResponse, request: ApiRequest): NextResponse {
  const rateLimit = request.context?.rateLimit;
  if (!rateLimit) {
    return response;
  }

  response.headers.set('X-RateLimit-Limit', String(rateLimit.limit));
  response.headers.set('X-RateLimit-Remaining', String(rateLimit.remaining));
  return response;
}
