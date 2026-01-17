import { NextRequest, NextResponse } from 'next/server';
import { getAsmJobs } from '@/lib/actions/guard-actions/asmJobActions';
import { IGuardAsmJobListParams } from '@/interfaces/guard/asm.interfaces';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    const params: IGuardAsmJobListParams = {
      page: searchParams.get('page') ? parseInt(searchParams.get('page')!, 10) : undefined,
      page_size: searchParams.get('page_size') ? parseInt(searchParams.get('page_size')!, 10) : undefined,
      sort_by: searchParams.get('sort_by') || undefined,
      sort_order: (searchParams.get('sort_order') as 'asc' | 'desc') || undefined,
      domain_id: searchParams.get('domain_id') || undefined,
      status: searchParams.get('status') as any || undefined,
      date_from: searchParams.get('date_from') ? new Date(searchParams.get('date_from')!) : undefined,
      date_to: searchParams.get('date_to') ? new Date(searchParams.get('date_to')!) : undefined,
    };

    const jobs = await getAsmJobs(params);
    return NextResponse.json(jobs);
  } catch (error) {
    console.error('Error fetching ASM jobs:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch ASM jobs' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}
