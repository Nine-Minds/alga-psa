import { NextRequest } from 'next/server';
import * as Y from 'yjs';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import { persistCollabSnapshot } from '@alga-psa/documents/lib/collabPersistence';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * Internal service-to-service endpoint. The Hocuspocus collaboration server
 * calls this (debounced + on room unload) to durably persist live Y.js edits.
 * Authenticated by a shared key, mirroring the AI document-assist route.
 */
export async function POST(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key');
  const expectedKey = process.env.COLLAB_PERSIST_API_KEY;
  if (!expectedKey || apiKey !== expectedKey) {
    return json({ error: 'Invalid API key' }, 401);
  }

  let body: { tenantId?: string; documentId?: string; update?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { tenantId, documentId, update } = body;
  if (!tenantId || !documentId || !update) {
    return json({ error: 'Missing required fields: tenantId, documentId, update' }, 400);
  }

  const ydoc = new Y.Doc();
  try {
    Y.applyUpdate(ydoc, new Uint8Array(Buffer.from(update, 'base64')));
    const fragment = ydoc.getXmlFragment('prosemirror');

    // Never overwrite stored content with an empty room (e.g. a freshly
    // opened room before the client has seeded it from the database).
    if (fragment.length === 0) {
      return json({ success: true, skipped: 'empty' }, 200);
    }

    const prosemirrorJson = yXmlFragmentToProsemirrorJSON(fragment);
    const result = await persistCollabSnapshot(tenantId, documentId, prosemirrorJson);

    if (!result.success) {
      // Document not found is expected/benign (e.g. deleted while editing).
      return json(result, result.message === 'Document not found.' ? 404 : 500);
    }
    return json({ success: true }, 200);
  } catch (error) {
    console.error('[collab/persist] Failed to persist snapshot:', error);
    return json({ error: 'Failed to persist snapshot' }, 500);
  } finally {
    ydoc.destroy();
  }
}
