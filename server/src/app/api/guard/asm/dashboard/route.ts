import { NextResponse } from 'next/server';
import { getAsmDashboardStats } from '@/lib/actions/guard-actions/asmDashboardActions';

export async function GET() {
  try {
    const stats = await getAsmDashboardStats();
    return NextResponse.json(stats);
  } catch (error) {
    console.error('Error fetching ASM dashboard stats:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch ASM dashboard stats' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}
