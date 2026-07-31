import { NextRequest, NextResponse } from 'next/server';
import { getImportFieldMapping } from '@/lib/imports/importActions';
import { importErrorResponse } from '../importRouteErrors';

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
    return importErrorResponse(error, 'Failed to load field mapping');
  }
}
