import { NextRequest, NextResponse } from 'next/server';
import {
  getPiiJob,
} from '@/lib/actions/guard-actions/piiJobActions';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const job = await getPiiJob(id);

    if (!job) {
      return NextResponse.json(
        { error: 'PII job not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(job);
  } catch (error) {
    console.error('Error fetching PII job:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch PII job' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}
