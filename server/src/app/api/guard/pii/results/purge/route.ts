import { NextRequest, NextResponse } from 'next/server';
import { deletePiiResultsByJob } from '@/lib/actions/guard-actions/piiResultActions';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { job_id } = body;

    if (!job_id) {
      return NextResponse.json(
        { error: 'job_id is required for bulk purge' },
        { status: 400 }
      );
    }

    const deletedCount = await deletePiiResultsByJob(job_id);
    return NextResponse.json({ success: true, deleted_count: deletedCount });
  } catch (error) {
    console.error('Error bulk purging PII results:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to bulk purge PII results' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}
