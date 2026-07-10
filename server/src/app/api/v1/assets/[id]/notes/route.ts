/**
 * Asset Notes API Routes
 * Path: /api/v1/assets/[id]/notes
 *
 * GET - Returns BlockNote content for an asset's notes
 * PUT - Saves BlockNote content for an asset's notes
 * DELETE - Removes asset notes
 */

import { NextResponse } from 'next/server';
import {
  getAssetNoteContent,
  saveAssetNote,
  deleteAssetNote,
} from '@alga-psa/assets/actions/assetNoteActions';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

const isActionError = (value: unknown) =>
  isActionPermissionError(value) || isActionMessageError(value);

function actionErrorResponse(error: unknown) {
  const message = getErrorMessage(error);
  const status = isActionPermissionError(error)
    ? 403
    : message.toLowerCase().includes('not found')
      ? 404
      : 400;

  return NextResponse.json({ error: message }, { status });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Missing asset ID' }, { status: 400 });
    }

    const noteContent = await getAssetNoteContent(id);
    if (isActionError(noteContent)) {
      return actionErrorResponse(noteContent);
    }

    return NextResponse.json({
      data: noteContent,
      _links: {
        self: { href: `/api/v1/assets/${id}/notes` },
        asset: { href: `/api/v1/assets/${id}` },
      },
    });
  } catch (error) {
    console.error('Failed to get asset notes:', error);
    if (error instanceof Error && error.message === 'Asset not found') {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }
    return NextResponse.json(
      { error: 'Failed to get asset notes' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Missing asset ID' }, { status: 400 });
    }

    const body = await request.json();
    const { blockData } = body;

    if (blockData === undefined) {
      return NextResponse.json(
        { error: 'Missing blockData in request body' },
        { status: 400 }
      );
    }

    const result = await saveAssetNote(id, blockData);
    if (isActionError(result)) {
      return actionErrorResponse(result);
    }

    return NextResponse.json({
      data: result,
      message: 'Notes saved successfully',
      _links: {
        self: { href: `/api/v1/assets/${id}/notes` },
        asset: { href: `/api/v1/assets/${id}` },
      },
    });
  } catch (error) {
    console.error('Failed to save asset notes:', error);
    if (error instanceof Error && error.message === 'Asset not found') {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }
    return NextResponse.json(
      { error: 'Failed to save asset notes' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Missing asset ID' }, { status: 400 });
    }

    const url = new URL(request.url);
    const deleteDocument = url.searchParams.get('delete_document') === 'true';

    const result = await deleteAssetNote(id, deleteDocument);
    if (isActionError(result)) {
      return actionErrorResponse(result);
    }

    return NextResponse.json({
      message: 'Notes deleted successfully',
      _links: {
        asset: { href: `/api/v1/assets/${id}` },
      },
    });
  } catch (error) {
    console.error('Failed to delete asset notes:', error);
    return NextResponse.json(
      { error: 'Failed to delete asset notes' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
