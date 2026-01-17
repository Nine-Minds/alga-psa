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

    return NextResponse.json({
      company_id: score.company_id,
      company_name: score.company_name,
      score: score.score,
      risk_level: score.risk_level,
      breakdown: score.breakdown,
      pii_penalty: score.pii_penalty,
      asm_penalty: score.asm_penalty,
    });
  } catch (error) {
    console.error('Error fetching score breakdown:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch score breakdown' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}
