import { NextRequest, NextResponse } from 'next/server';
import { recalculateSecurityScore } from '@/lib/actions/guard-actions/scoreActions';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ companyId: string }> }
) {
  try {
    const { companyId } = await params;
    const score = await recalculateSecurityScore(companyId, 'manual');
    return NextResponse.json(score);
  } catch (error) {
    console.error('Error recalculating security score:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to recalculate security score' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}
