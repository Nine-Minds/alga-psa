import { NextRequest, NextResponse } from 'next/server';
import { getSecurityScores } from '@/lib/actions/guard-actions/scoreActions';
import { IGuardScoreListParams, GuardRiskLevel } from '@/interfaces/guard/score.interfaces';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    const params: IGuardScoreListParams = {
      page: searchParams.get('page') ? parseInt(searchParams.get('page')!, 10) : undefined,
      page_size: searchParams.get('page_size') ? parseInt(searchParams.get('page_size')!, 10) : undefined,
      sort_by: (searchParams.get('sort_by') as 'score' | 'company_name' | 'last_calculated_at') || undefined,
      sort_order: (searchParams.get('sort_order') as 'asc' | 'desc') || undefined,
      risk_level: searchParams.get('risk_level') as GuardRiskLevel || undefined,
      min_score: searchParams.get('min_score') ? parseInt(searchParams.get('min_score')!, 10) : undefined,
      max_score: searchParams.get('max_score') ? parseInt(searchParams.get('max_score')!, 10) : undefined,
    };

    const scores = await getSecurityScores(params);
    return NextResponse.json(scores);
  } catch (error) {
    console.error('Error fetching security scores:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch security scores' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}
