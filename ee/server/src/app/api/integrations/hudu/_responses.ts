import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function ok(data: unknown, status = 200): NextResponse {
  return NextResponse.json(
    {
      success: true,
      data,
    },
    { status }
  );
}

export function badRequest(error: string): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error,
    },
    { status: 400 }
  );
}

export async function parseJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
