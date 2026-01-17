import { NextRequest, NextResponse } from 'next/server';
import { getCompanyRiskSummary } from '@/lib/actions/guard-actions/piiDashboardActions';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 10;

    const companies = await getCompanyRiskSummary(limit);
    return NextResponse.json({ companies });
  } catch (error) {
    console.error('Error fetching company risk summary:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch company risk summary' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}
