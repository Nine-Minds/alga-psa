/**
 * Client Notes API Routes
 * Path: /api/v1/clients/[id]/notes
 *
 * GET - Returns BlockNote content for a client's notes document
 * PUT - Saves BlockNote content for a client's notes document
 * DELETE - Unlinks (and optionally deletes) the client's notes document
 *
 * Mirrors /api/v1/assets/[id]/notes so the mobile app can show client notes
 * on dispatched tickets.
 */

import { NextResponse } from 'next/server';
import { runWithApiKeyOrSession } from 'server/src/lib/api/middleware/runWithApiKeyOrSession';
import {
  getClientNoteContent,
  saveClientNote,
  deleteClientNote,
} from '@alga-psa/clients/actions/clientNoteActions';
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

function links(id: string) {
  return {
    self: { href: `/api/v1/clients/${id}/notes` },
    client: { href: `/api/v1/clients/${id}` },
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Missing client ID' }, { status: 400 });
    }

    const noteContent = await runWithApiKeyOrSession(request, () => getClientNoteContent(id));
    if (isActionError(noteContent)) {
      return actionErrorResponse(noteContent);
    }

    return NextResponse.json({ data: noteContent, _links: links(id) });
  } catch (error) {
    console.error('Failed to get client notes:', error);
    return NextResponse.json({ error: 'Failed to get client notes' }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Missing client ID' }, { status: 400 });
    }

    const body = await request.json();
    const { blockData } = body;

    if (blockData === undefined) {
      return NextResponse.json({ error: 'Missing blockData in request body' }, { status: 400 });
    }

    const payload = typeof blockData === 'string' ? blockData : JSON.stringify(blockData);
    const result = await runWithApiKeyOrSession(request, () => saveClientNote(id, payload));
    if (isActionError(result)) {
      return actionErrorResponse(result);
    }

    return NextResponse.json({ data: result, message: 'Notes saved successfully', _links: links(id) });
  } catch (error) {
    console.error('Failed to save client notes:', error);
    return NextResponse.json({ error: 'Failed to save client notes' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Missing client ID' }, { status: 400 });
    }

    const url = new URL(request.url);
    const deleteDocument = url.searchParams.get('delete_document') === 'true';

    const result = await runWithApiKeyOrSession(request, () => deleteClientNote(id, deleteDocument));
    if (isActionError(result)) {
      return actionErrorResponse(result);
    }

    return NextResponse.json({ message: 'Notes deleted successfully', _links: { client: links(id).client } });
  } catch (error) {
    console.error('Failed to delete client notes:', error);
    return NextResponse.json({ error: 'Failed to delete client notes' }, { status: 500 });
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
