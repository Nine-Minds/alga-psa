import { NextRequest, NextResponse } from 'next/server';
import { runWhatIfSimulation } from '@/lib/actions/guard-actions/scoreActions';
import { IWhatIfSimulationRequest } from '@/interfaces/guard/score.interfaces';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ companyId: string }> }
) {
  try {
    const { companyId } = await params;
    const body: IWhatIfSimulationRequest = await request.json();
    const result = await runWhatIfSimulation(companyId, body);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error running what-if simulation:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to run what-if simulation' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}
