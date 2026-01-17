import { NextRequest, NextResponse } from 'next/server';
import {
  getPiiJobs,
  triggerPiiScan,
} from '@/lib/actions/guard-actions/piiJobActions';
import { IGuardPiiJobListParams, GuardJobStatus } from '@/interfaces/guard/pii.interfaces';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    const params: IGuardPiiJobListParams = {
      page: searchParams.get('page') ? parseInt(searchParams.get('page')!, 10) : undefined,
      page_size: searchParams.get('page_size') ? parseInt(searchParams.get('page_size')!, 10) : undefined,
      sort_by: searchParams.get('sort_by') || undefined,
      sort_order: (searchParams.get('sort_order') as 'asc' | 'desc') || undefined,
      profile_id: searchParams.get('profile_id') || undefined,
      status: (searchParams.get('status') as GuardJobStatus) || undefined,
      date_from: searchParams.get('date_from') ? new Date(searchParams.get('date_from')!) : undefined,
      date_to: searchParams.get('date_to') ? new Date(searchParams.get('date_to')!) : undefined,
    };

    const jobs = await getPiiJobs(params);
    return NextResponse.json(jobs);
  } catch (error) {
    console.error('Error fetching PII jobs:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch PII jobs' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { profile_id, target_agents } = body;

    if (!profile_id) {
      return NextResponse.json(
        { error: 'profile_id is required' },
        { status: 400 }
      );
    }

    const job = await triggerPiiScan(profile_id, target_agents);
    return NextResponse.json(job, { status: 201 });
  } catch (error) {
    console.error('Error triggering PII scan:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to trigger PII scan' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 :
               error instanceof Error && error.message.includes('not found') ? 404 :
               error instanceof Error && error.message.includes('disabled') ? 400 : 500 }
    );
  }
}
