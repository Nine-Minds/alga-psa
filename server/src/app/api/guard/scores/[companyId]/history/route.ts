import { NextRequest, NextResponse } from 'next/server';
import { getScoreHistory } from '@/lib/actions/guard-actions/scoreActions';
import { IGuardScoreHistoryListParams } from '@/interfaces/guard/score.interfaces';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ companyId: string }> }
) {
  try {
    const { companyId } = await params;
    const searchParams = request.nextUrl.searchParams;

    const historyParams: IGuardScoreHistoryListParams = {
      page: searchParams.get('page') ? parseInt(searchParams.get('page')!, 10) : undefined,
      page_size: searchParams.get('page_size') ? parseInt(searchParams.get('page_size')!, 10) : undefined,
      date_from: searchParams.get('date_from') ? new Date(searchParams.get('date_from')!) : undefined,
      date_to: searchParams.get('date_to') ? new Date(searchParams.get('date_to')!) : undefined,
    };

    const history = await getScoreHistory(companyId, historyParams);
    return NextResponse.json(history);
  } catch (error) {
    console.error('Error fetching score history:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch score history' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}
