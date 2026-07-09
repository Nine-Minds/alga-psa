import { NextResponse } from 'next/server';
import { getImportSources } from '@/lib/imports/importActions';
import { importErrorResponse } from '../importRouteErrors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const sources = await getImportSources();
    return NextResponse.json(sources);
  } catch (error) {
    console.error('[API] /import/sources', error);
    return importErrorResponse(error, 'Failed to load import sources');
  }
}
