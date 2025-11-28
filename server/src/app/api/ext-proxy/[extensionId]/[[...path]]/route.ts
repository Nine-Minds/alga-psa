import type { NextRequest } from 'next/server';

import { appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';

// Force EE handler for extension proxy to fix 404s in dev environment
import * as handler from '@product/ext-proxy/ee/handler';
export { dynamic } from '@product/ext-proxy/ee/handler';

const LOG_PATH = path.resolve('/tmp/ext-proxy.log');

function log(event: string, req: NextRequest) {
  const payload = {
    event,
    method: req.method,
    url: req.url,
    hasCookie: req.headers.has('cookie'),
    timestamp: new Date().toISOString(),
  };
  try {
    appendFileSync(LOG_PATH, JSON.stringify(payload) + '\n', 'utf8');
  } catch {
    // ignore
  }
}

export async function GET(req: NextRequest, ctx: any) {
  log('GET', req);
  return handler.GET(req, ctx);
}
export async function POST(req: NextRequest, ctx: any) {
  log('POST', req);
  return handler.POST(req, ctx);
}
export async function PUT(req: NextRequest, ctx: any) {
  log('PUT', req);
  return handler.PUT(req, ctx);
}
export async function PATCH(req: NextRequest, ctx: any) {
  log('PATCH', req);
  return handler.PATCH(req, ctx);
}
export async function DELETE(req: NextRequest, ctx: any) {
  log('DELETE', req);
  return handler.DELETE(req, ctx);
}
