import { NextResponse } from 'next/server';

import { getRunnerBackend, RunnerConfigError, RunnerRequestError, filterHopByHopHeaders } from '../../../lib/extensions/runner/backend.js';

export const dynamic = 'force-dynamic';

function normalizePath(segments: string[] | string | undefined): string {
  if (!segments) return '';
  const list = Array.isArray(segments) ? segments : [segments];
  return list
    .flatMap((segment) => (segment || '').split('/'))
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join('/');
}

const ALLOW_METHODS = new Set(['GET', 'HEAD']);

async function proxy(req: Request, params: { path?: string[] }) {
  if (!ALLOW_METHODS.has(req.method)) {
    return new NextResponse('Method Not Allowed', {
      status: 405,
      headers: { Allow: 'GET, HEAD' },
    });
  }

  const backend = getRunnerBackend();
  const path = normalizePath(params.path);

  if (!path) {
    return new NextResponse('Not Found', { status: 404 });
  }

  try {
    const upstream = await backend.fetchStaticAsset({
      path,
      search: new URL(req.url).search,
      method: req.method,
      headers: req.headers,
    });

    const headersRecord = filterHopByHopHeaders(upstream.headers);
    const headers = new Headers();
    for (const [key, value] of Object.entries(headersRecord)) {
      headers.set(key, value);
    }

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (error: any) {
    if (error instanceof RunnerConfigError) {
      console.error('[runner-proxy] Runner configuration error:', error.message);
      return new NextResponse('Runner not configured', { status: 500 });
    }
    if (error instanceof RunnerRequestError) {
      console.error('[runner-proxy] Runner request error:', error.message, {
        backend: error.backend,
        status: error.status,
      });
      return new NextResponse('Runner error', { status: 502 });
    }
    if (error?.name === 'AbortError') {
      return new NextResponse('Gateway timeout', { status: 504 });
    }
    console.error('[runner-proxy] Unexpected error:', error);
    return new NextResponse('Internal error', { status: 500 });
  }
}

export async function GET(req: Request, segmentData: { params: Promise<{ path?: string[] }> }) {
  const params = await segmentData.params;
  return proxy(req, params);
}

export async function HEAD(req: Request, segmentData: { params: Promise<{ path?: string[] }> }) {
  const params = await segmentData.params;
  return proxy(req, params);
}
