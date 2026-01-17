import { NextRequest, NextResponse } from 'next/server';
import { triggerAsmScan } from '@/lib/actions/guard-actions/asmJobActions';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const job = await triggerAsmScan(id);
    return NextResponse.json(job, { status: 201 });
  } catch (error) {
    console.error('Error triggering ASM scan:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to trigger ASM scan' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}
