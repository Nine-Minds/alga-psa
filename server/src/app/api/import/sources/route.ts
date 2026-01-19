import { NextResponse } from 'next/server';
import { getImportSources } from '@alga-psa/reference-data/actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const sources = await getImportSources();
    return NextResponse.json(sources);
  } catch (error) {
    console.error('[API] /import/sources', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load import sources' },
      { status: 500 }
    );
  }
}
