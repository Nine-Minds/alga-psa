import { NextRequest, NextResponse } from 'next/server';
import { approveImport } from '@alga-psa/reference-data/actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const importJobId = typeof body?.importJobId === 'string' ? body.importJobId : null;

    if (!importJobId) {
      return NextResponse.json({ error: 'importJobId is required' }, { status: 400 });
    }

    const result = await approveImport(importJobId);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[API] /import/approve', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to approve import job' },
      { status: 500 }
    );
  }
}
