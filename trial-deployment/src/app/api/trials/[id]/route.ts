import { NextRequest, NextResponse } from 'next/server';
import { trialStore } from '@/lib/trial-store';
import { destroyTrial } from '@/lib/trial-manager';

/**
 * GET /api/trials/:id — Get trial status and credentials.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const trial = trialStore.get(id);

  if (!trial) {
    return NextResponse.json({ error: 'Trial not found' }, { status: 404 });
  }

  return NextResponse.json(trial);
}

/**
 * DELETE /api/trials/:id — Manually destroy a trial instance.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const trial = trialStore.get(id);

  if (!trial) {
    return NextResponse.json({ error: 'Trial not found' }, { status: 404 });
  }

  try {
    await destroyTrial(id);
    return NextResponse.json({ message: 'Trial destroyed' });
  } catch (err) {
    console.error(`DELETE /api/trials/${id} error:`, err);
    return NextResponse.json(
      { error: 'Failed to destroy trial' },
      { status: 500 }
    );
  }
}
