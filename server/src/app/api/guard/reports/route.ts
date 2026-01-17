import { NextRequest, NextResponse } from 'next/server';
import {
  getReportJobs,
  createReportJob,
} from '@/lib/actions/guard-actions/reportActions';
import { IGuardReportListParams, ICreateReportRequest, GuardReportType } from '@/interfaces/guard/report.interfaces';
import { GuardJobStatus } from '@/interfaces/guard/pii.interfaces';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    const params: IGuardReportListParams = {
      page: searchParams.get('page') ? parseInt(searchParams.get('page')!, 10) : undefined,
      page_size: searchParams.get('page_size') ? parseInt(searchParams.get('page_size')!, 10) : undefined,
      sort_by: (searchParams.get('sort_by') as 'created_at' | 'name' | 'status') || undefined,
      sort_order: (searchParams.get('sort_order') as 'asc' | 'desc') || undefined,
      report_type: searchParams.get('report_type') as GuardReportType || undefined,
      status: searchParams.get('status') as GuardJobStatus || undefined,
    };

    const reports = await getReportJobs(params);
    return NextResponse.json(reports);
  } catch (error) {
    console.error('Error fetching report jobs:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch report jobs' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: ICreateReportRequest = await request.json();
    const report = await createReportJob(body);
    return NextResponse.json(report, { status: 201 });
  } catch (error) {
    console.error('Error creating report job:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create report job' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}
