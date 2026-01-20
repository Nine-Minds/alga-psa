import { NextRequest, NextResponse } from 'next/server';
import { getImportJobDetails } from '@/lib/imports/importActions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const importJobId = url.searchParams.get('importJobId');

    if (!importJobId || importJobId.trim().length === 0) {
      return NextResponse.json({ error: 'importJobId is required' }, { status: 400 });
    }

    const details = await getImportJobDetails(importJobId);
    return NextResponse.json(details);
  } catch (error) {
    console.error('[API] /import/details', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load import job details' },
      { status: 500 }
    );
  }
}
