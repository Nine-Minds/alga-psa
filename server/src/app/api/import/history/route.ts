import { NextRequest, NextResponse } from 'next/server';
import { listImportJobs } from '@/lib/imports/importActions';
import { importErrorResponse } from '../importRouteErrors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
    return importErrorResponse(error, 'Failed to load import history');
  }
}
