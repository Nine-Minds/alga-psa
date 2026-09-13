import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestOrigin } from '@/lib/deployment/requestHost';
import { resolveDeploymentCapabilities } from '@/lib/deployment/deploymentProfile';
import { prepareNamedConversationSynthesisAction } from '@alga-psa/tickets/actions/conversationAiActions';

export const runtime = 'nodejs';

// LEVERAGE: friction queued-generation-action — inference must not occupy the
// browser's serialized server-action queue and prevent cancellation/status reads.
// Reuse the authenticated command; this route grants no additional authority.
export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  const requestOrigin = resolveRequestOrigin(request, resolveDeploymentCapabilities(), {
    fallbackProto: request.nextUrl.protocol.slice(0, -1), fallbackHost: request.nextUrl.host,
  }).origin;
  if (!origin || origin !== requestOrigin || !request.headers.get('content-type')?.startsWith('application/json'))
    return NextResponse.json({ ok: false, code: 'unavailable' }, { status: 403 });
  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, code: 'invalid' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['ticket', 'destination', 'request'].includes(key)))
    return NextResponse.json({ ok: false, code: 'invalid' }, { status: 400 });
  try {
    return NextResponse.json(await prepareNamedConversationSynthesisAction(body.ticket, body.destination, body.request),
      { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false, code: 'unavailable' }, { status: 403 });
  }
}
