import { NextResponse } from 'next/server';
import { getScannerPodIps } from '@/lib/actions/guard-actions/asmDashboardActions';

export async function GET() {
  try {
    const pods = await getScannerPodIps();
    return NextResponse.json({ pods });
  } catch (error) {
    console.error('Error fetching scanner pod IPs:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch scanner pod IPs' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}
