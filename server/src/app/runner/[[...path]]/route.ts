import { NextRequest, NextResponse } from 'next/server';

import {
  getRunnerBackend,
  RunnerConfigError,
  RunnerRequestError,
  filterHopByHopHeaders,
} from '@product/ext-proxy/ee/runner-backend';

export const dynamic = 'force-dynamic';

type RouteParams = { path?: string[] };

async function proxyRequest(
  req: NextRequest,
  ctx: { params: RouteParams | Promise<RouteParams> },
) {
  const backend = getRunnerBackend();
  const routeParams = await ctx.params;
  const pathParts = Array.isArray(routeParams?.path) ? routeParams!.path : [];
  const upstreamPath = pathParts.join('/');
  const url = new URL(req.url);

  try {
    const upstreamResp = await backend.fetchStaticAsset({
      path: upstreamPath,
      search: url.search,
      method: req.method,
      headers: req.headers,
    });

    const headers = new Headers(filterHopByHopHeaders(upstreamResp.headers));
    return new NextResponse(req.method === 'HEAD' ? null : upstreamResp.body, {
      status: upstreamResp.status,
      headers,
    });
  } catch (error: any) {
    if (error instanceof RunnerConfigError) {
      console.error('[runner-proxy] Runner configuration error:', error.message);
      return NextResponse.json({ error: 'runner_not_configured' }, { status: 500 });
    }
    if (error instanceof RunnerRequestError) {
      console.error('[runner-proxy] Runner request error:', error.message, { backend: error.backend });
      return NextResponse.json({ error: 'runner_unreachable' }, { status: 502 });
    }
    if (error?.name === 'AbortError') {
      return NextResponse.json({ error: 'runner_timeout' }, { status: 504 });
    }
    console.error('[runner-proxy] Unexpected error:', error);
    return NextResponse.json({ error: 'runner_proxy_error' }, { status: 502 });
  }
}

export async function GET(
  req: NextRequest,
  ctx: { params: RouteParams | Promise<RouteParams> },
) {
  return proxyRequest(req, ctx);
}

export async function HEAD(
  req: NextRequest,
  ctx: { params: RouteParams | Promise<RouteParams> },
) {
  return proxyRequest(req, ctx);
}
