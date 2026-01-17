import { NextRequest, NextResponse } from 'next/server';
import { toggleAsmDomainEnabled } from '@/lib/actions/guard-actions/asmDomainActions';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const domain = await toggleAsmDomainEnabled(id);
    return NextResponse.json(domain);
  } catch (error) {
    console.error('Error toggling ASM domain:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to toggle ASM domain' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}
