import { NextRequest, NextResponse } from 'next/server';
import {
  getPiiProfile,
  updatePiiProfile,
  deletePiiProfile,
} from '@/lib/actions/guard-actions/piiProfileActions';
import { IUpdatePiiProfileRequest } from '@/interfaces/guard/pii.interfaces';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const profile = await getPiiProfile(id);

    if (!profile) {
      return NextResponse.json(
        { error: 'PII profile not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(profile);
  } catch (error) {
    console.error('Error fetching PII profile:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch PII profile' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body: IUpdatePiiProfileRequest = await request.json();
    const profile = await updatePiiProfile(id, body);
    return NextResponse.json(profile);
  } catch (error) {
    console.error('Error updating PII profile:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update PII profile' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 :
               error instanceof Error && error.message.includes('not found') ? 404 : 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await deletePiiProfile(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting PII profile:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete PII profile' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 :
               error instanceof Error && error.message.includes('not found') ? 404 :
               error instanceof Error && error.message.includes('Cannot delete') ? 400 : 500 }
    );
  }
}
