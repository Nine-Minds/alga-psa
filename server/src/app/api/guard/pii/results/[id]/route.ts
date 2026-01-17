import { NextRequest, NextResponse } from 'next/server';
import {
  getPiiResult,
  deletePiiResult,
} from '@/lib/actions/guard-actions/piiResultActions';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await getPiiResult(id);

    if (!result) {
      return NextResponse.json(
        { error: 'PII result not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching PII result:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch PII result' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await deletePiiResult(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting PII result:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete PII result' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 :
               error instanceof Error && error.message.includes('not found') ? 404 : 500 }
    );
  }
}
