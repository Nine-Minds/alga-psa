import { NextRequest, NextResponse } from 'next/server';
import {
  getSchedule,
  updateSchedule,
  deleteSchedule,
} from '@/lib/actions/guard-actions/scheduleActions';
import { IUpdateScheduleRequest } from '@/interfaces/guard/schedule.interfaces';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const schedule = await getSchedule(id);

    if (!schedule) {
      return NextResponse.json(
        { error: 'Schedule not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(schedule);
  } catch (error) {
    console.error('Error fetching schedule:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch schedule' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body: IUpdateScheduleRequest = await request.json();
    const schedule = await updateSchedule(id, body);
    return NextResponse.json(schedule);
  } catch (error) {
    console.error('Error updating schedule:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update schedule' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await deleteSchedule(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting schedule:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete schedule' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}
