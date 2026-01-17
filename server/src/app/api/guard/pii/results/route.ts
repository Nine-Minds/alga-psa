import { NextRequest, NextResponse } from 'next/server';
import { getPiiResults, deleteAllPiiResults } from '@/lib/actions/guard-actions/piiResultActions';
import { IGuardPiiResultListParams, GuardPiiType } from '@/interfaces/guard/pii.interfaces';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    const params: IGuardPiiResultListParams = {
      page: searchParams.get('page') ? parseInt(searchParams.get('page')!, 10) : undefined,
      page_size: searchParams.get('page_size') ? parseInt(searchParams.get('page_size')!, 10) : undefined,
      sort_by: searchParams.get('sort_by') || undefined,
      sort_order: (searchParams.get('sort_order') as 'asc' | 'desc') || undefined,
      job_id: searchParams.get('job_id') || undefined,
      profile_id: searchParams.get('profile_id') || undefined,
      company_id: searchParams.get('company_id') || undefined,
      pii_type: (searchParams.get('pii_type') as GuardPiiType) || undefined,
      date_from: searchParams.get('date_from') ? new Date(searchParams.get('date_from')!) : undefined,
      date_to: searchParams.get('date_to') ? new Date(searchParams.get('date_to')!) : undefined,
    };

    const results = await getPiiResults(params);
    return NextResponse.json(results);
  } catch (error) {
    console.error('Error fetching PII results:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch PII results' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const deletedCount = await deleteAllPiiResults();
    return NextResponse.json({ success: true, deleted_count: deletedCount });
  } catch (error) {
    console.error('Error purging all PII results:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to purge all PII results' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}
