import { NextRequest, NextResponse } from 'next/server';
import { getImportFieldMapping } from '@alga-psa/reference-data/actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const importSourceId = url.searchParams.get('importSourceId');

    if (!importSourceId) {
      return NextResponse.json({ error: 'importSourceId is required' }, { status: 400 });
    }

    const template = await getImportFieldMapping(importSourceId);
    return NextResponse.json(template ?? {});
  } catch (error) {
    console.error('[API] /import/mapping', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load field mapping' },
      { status: 500 }
    );
  }
}
