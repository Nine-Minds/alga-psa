import { NextRequest, NextResponse } from 'next/server';
import { getPiiDashboardStats } from '@/lib/actions/guard-actions/piiDashboardActions';

export async function GET(request: NextRequest) {
  try {
    const stats = await getPiiDashboardStats();
    return NextResponse.json(stats);
  } catch (error) {
    console.error('Error fetching PII dashboard stats:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch PII dashboard stats' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}
