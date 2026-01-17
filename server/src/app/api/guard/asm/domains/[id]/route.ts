import { NextRequest, NextResponse } from 'next/server';
import {
  getAsmDomain,
  updateAsmDomain,
  deleteAsmDomain,
} from '@/lib/actions/guard-actions/asmDomainActions';
import { IUpdateAsmDomainRequest } from '@/interfaces/guard/asm.interfaces';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const domain = await getAsmDomain(id);

    if (!domain) {
      return NextResponse.json(
        { error: 'ASM domain not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(domain);
  } catch (error) {
    console.error('Error fetching ASM domain:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch ASM domain' },
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
    const body: IUpdateAsmDomainRequest = await request.json();
    const domain = await updateAsmDomain(id, body);
    return NextResponse.json(domain);
  } catch (error) {
    console.error('Error updating ASM domain:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update ASM domain' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await deleteAsmDomain(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting ASM domain:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete ASM domain' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}
