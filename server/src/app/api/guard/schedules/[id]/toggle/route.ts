import { NextRequest, NextResponse } from 'next/server';
import { toggleScheduleEnabled } from '@/lib/actions/guard-actions/scheduleActions';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const schedule = await toggleScheduleEnabled(id);
    return NextResponse.json(schedule);
  } catch (error) {
    console.error('Error toggling schedule:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to toggle schedule' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}
