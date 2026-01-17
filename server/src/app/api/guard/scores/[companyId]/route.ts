import { NextRequest, NextResponse } from 'next/server';
import { getSecurityScore } from '@/lib/actions/guard-actions/scoreActions';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ companyId: string }> }
) {
  try {
    const { companyId } = await params;
    const score = await getSecurityScore(companyId);

    if (!score) {
      return NextResponse.json(
        { error: 'Security score not found for this company' },
        { status: 404 }
      );
    }

    return NextResponse.json(score);
  } catch (error) {
    console.error('Error fetching security score:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch security score' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}
