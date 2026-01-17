import { NextRequest, NextResponse } from 'next/server';
import {
  getSchedules,
  createSchedule,
} from '@/lib/actions/guard-actions/scheduleActions';
import { IGuardScheduleListParams, ICreateScheduleRequest, GuardScheduleType } from '@/interfaces/guard/schedule.interfaces';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    const params: IGuardScheduleListParams = {
      page: searchParams.get('page') ? parseInt(searchParams.get('page')!, 10) : undefined,
      page_size: searchParams.get('page_size') ? parseInt(searchParams.get('page_size')!, 10) : undefined,
      sort_by: (searchParams.get('sort_by') as 'name' | 'next_run_at' | 'created_at') || undefined,
      sort_order: (searchParams.get('sort_order') as 'asc' | 'desc') || undefined,
      schedule_type: searchParams.get('schedule_type') as GuardScheduleType || undefined,
      enabled: searchParams.get('enabled') !== null ? searchParams.get('enabled') === 'true' : undefined,
    };

    const schedules = await getSchedules(params);
    return NextResponse.json(schedules);
  } catch (error) {
    console.error('Error fetching schedules:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch schedules' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: ICreateScheduleRequest = await request.json();
    const schedule = await createSchedule(body);
    return NextResponse.json(schedule, { status: 201 });
  } catch (error) {
    console.error('Error creating schedule:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create schedule' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}
