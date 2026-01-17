import { NextRequest, NextResponse } from 'next/server';
import {
  getPiiFindingsTrend,
  getPiiScanActivityTrend,
} from '@/lib/actions/guard-actions/piiDashboardActions';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const days = searchParams.get('days') ? parseInt(searchParams.get('days')!, 10) : 30;
    const type = searchParams.get('type') || 'findings';

    let trend;
    if (type === 'scans') {
      trend = await getPiiScanActivityTrend(days);
    } else {
      trend = await getPiiFindingsTrend(days);
    }

    return NextResponse.json({ trend, type, days });
  } catch (error) {
    console.error('Error fetching PII trends:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch PII trends' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}
