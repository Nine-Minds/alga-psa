import { NextRequest, NextResponse } from 'next/server';

const MESSAGE = 'Extension proxy is available in Enterprise Edition only.';

async function handle(_req: NextRequest): Promise<NextResponse> {
  return NextResponse.json({ error: 'not_found', message: MESSAGE }, { status: 404 });
}

export const dynamic = 'force-dynamic';

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;

export type RouteHandler = typeof handle;
