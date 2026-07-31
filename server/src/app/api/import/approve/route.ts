import { NextRequest, NextResponse } from 'next/server';
import { approveImport } from '@/lib/imports/importActions';
import { importErrorResponse } from '../importRouteErrors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    let body: { importJobId?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
    }
    const importJobId = typeof body?.importJobId === 'string' ? body.importJobId : null;

    if (!importJobId) {
      return NextResponse.json({ error: 'importJobId is required' }, { status: 400 });
    }

    const result = await approveImport(importJobId);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[API] /import/approve', error);
    return importErrorResponse(error, 'Failed to approve import job');
  }
}
