import { NextResponse } from 'next/server';
import { getPortfolioSummary } from '@/lib/actions/guard-actions/scoreActions';

export async function GET() {
  try {
    const summary = await getPortfolioSummary();
    return NextResponse.json(summary);
  } catch (error) {
    console.error('Error fetching portfolio summary:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch portfolio summary' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}
