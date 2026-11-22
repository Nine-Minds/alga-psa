import { NextRequest } from 'next/server';
import { authorizeCollabWriter } from '@alga-psa/documents/lib/collabPersistence';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

export async function POST(request: NextRequest) {
  const expectedKey = process.env.COLLAB_PERSIST_API_KEY;
  if (!expectedKey || request.headers.get('x-api-key') !== expectedKey) {
    return json({ error: 'Invalid API key' }, 401);
  }

  let body: { tenantId?: string; documentId?: string; credential?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const { tenantId, documentId, credential } = body;
  if (!tenantId || !documentId || !credential) {
    return json({ error: 'Missing tenantId, documentId, or credential' }, 400);
  }

  try {
    const result = await authorizeCollabWriter(tenantId, documentId, credential);
    return result.allowed ? json({ authorized: true }, 200) : json({ error: result.message ?? 'Forbidden' }, 403);
  } catch (error) {
    console.error('[collab/authorize] Failed to authorize document writer:', error);
    return json({ error: 'Authorization check failed' }, 500);
  }
}
