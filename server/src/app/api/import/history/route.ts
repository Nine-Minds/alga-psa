import { NextRequest, NextResponse } from 'next/server';
import { listImportJobs } from '@/lib/actions/import-actions/importActions';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const sourceType = url.searchParams.get('sourceType');

    const history = await listImportJobs({
      status: status ? (status.split(',') as any) : undefined,
      sourceType: sourceType ?? undefined,
    });

    return NextResponse.json(history);
  } catch (error) {
    console.error('[API] /import/history', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load import history' },
      { status: 500 }
    );
  }
}
