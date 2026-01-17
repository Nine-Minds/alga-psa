import { NextRequest, NextResponse } from 'next/server';
import { getAsmJob, cancelAsmScan } from '@/lib/actions/guard-actions/asmJobActions';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const job = await getAsmJob(id);

    if (!job) {
      return NextResponse.json(
        { error: 'ASM job not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(job);
  } catch (error) {
    console.error('Error fetching ASM job:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch ASM job' },
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
    const job = await cancelAsmScan(id);
    return NextResponse.json(job);
  } catch (error) {
    console.error('Error cancelling ASM scan:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to cancel ASM scan' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}
