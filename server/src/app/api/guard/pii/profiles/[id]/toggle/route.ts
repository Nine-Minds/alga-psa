import { NextRequest, NextResponse } from 'next/server';
import { togglePiiProfileEnabled } from '@/lib/actions/guard-actions/piiProfileActions';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const profile = await togglePiiProfileEnabled(id);
    return NextResponse.json(profile);
  } catch (error) {
    console.error('Error toggling PII profile:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to toggle PII profile' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 :
               error instanceof Error && error.message.includes('not found') ? 404 : 500 }
    );
  }
}
