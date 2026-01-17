import { NextRequest, NextResponse } from 'next/server';
import { getAsmResults } from '@/lib/actions/guard-actions/asmResultActions';
import { IGuardAsmResultListParams, GuardAsmResultType } from '@/interfaces/guard/asm.interfaces';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    const params: IGuardAsmResultListParams = {
      page: searchParams.get('page') ? parseInt(searchParams.get('page')!, 10) : undefined,
      page_size: searchParams.get('page_size') ? parseInt(searchParams.get('page_size')!, 10) : undefined,
      sort_by: searchParams.get('sort_by') || undefined,
      sort_order: (searchParams.get('sort_order') as 'asc' | 'desc') || undefined,
      job_id: searchParams.get('job_id') || undefined,
      domain_id: searchParams.get('domain_id') || undefined,
      result_type: searchParams.get('result_type') as GuardAsmResultType || undefined,
      severity: searchParams.get('severity') || undefined,
    };

    const results = await getAsmResults(params);
    return NextResponse.json(results);
  } catch (error) {
    console.error('Error fetching ASM results:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch ASM results' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}
