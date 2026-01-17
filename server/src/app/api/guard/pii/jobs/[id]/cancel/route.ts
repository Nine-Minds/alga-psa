import { NextRequest, NextResponse } from 'next/server';
import { cancelPiiScan } from '@/lib/actions/guard-actions/piiJobActions';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const job = await cancelPiiScan(id);
    return NextResponse.json(job);
  } catch (error) {
    console.error('Error cancelling PII scan:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to cancel PII scan' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 :
               error instanceof Error && error.message.includes('not found') ? 404 :
               error instanceof Error && error.message.includes('Cannot cancel') ? 400 : 500 }
    );
  }
}
