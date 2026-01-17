import { NextRequest, NextResponse } from 'next/server';
import { cancelReportJob } from '@/lib/actions/guard-actions/reportActions';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const report = await cancelReportJob(id);
    return NextResponse.json(report);
  } catch (error) {
    console.error('Error cancelling report:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to cancel report' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}
