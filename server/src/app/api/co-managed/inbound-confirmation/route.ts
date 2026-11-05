import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { getAdminConnection, tenantDb } from '@alga-psa/db';
import '@alga-psa/co-managed/deliveryRegistration';
import { approveInboundSenderConfirmation, parseInboundSenderConfirmationToken } from '@alga-psa/co-managed/inboundSenderConfirmation';

const headers = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};
const denied = () => new NextResponse('This confirmation is invalid, expired, or no longer available.', { status: 403, headers });
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const page = (token: string, message = 'Confirm this reply to add it to the co-managed ticket conversation.', replyText = '') =>
  new NextResponse(`<!doctype html><html lang="en"><meta name="referrer" content="no-referrer"><title>Confirm ticket reply</title><main><h1>Confirm ticket reply</h1><p>${escapeHtml(message)}</p><p>Only confirm if you wrote this reply.</p><pre>${escapeHtml(replyText)}</pre><form method="post"><input type="hidden" name="token" value="${escapeHtml(token)}"><button type="submit">Confirm reply</button></form></main></html>`, {
    headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
  });

async function loadConfirmation(token: string) {
  const claims = parseInboundSenderConfirmationToken(token);
  if (!claims) return null;
  const db = await getAdminConnection();
  const row = await tenantDb(db, claims.tenant).table('co_management_deliveries')
    .where({ tenant: claims.tenant, delivery_kind: 'sender_confirmation', source_id: claims.sourceId })
    .first('recipient', 'payload');
  if (!row?.payload) return null;
  const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  if (payload.expiresAt !== claims.expiresAt || payload.state !== 'pending' || Date.parse(payload.expiresAt) <= Date.now()) return null;
  return { tenant: claims.tenant, row, payload };
}

function userMatches(user: any, pending: { tenant: string; row: any; payload: any }): boolean {
  return Boolean(user && user.user_type === 'internal'
    && user.tenant === pending.payload.actor?.tenant
    && user.user_id === pending.payload.actor?.userId
    && user.email?.trim().toLowerCase() === String(pending.row.recipient).trim().toLowerCase());
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') || '';
  const pending = await loadConfirmation(token);
  if (!pending) return denied();
  const user = await getCurrentUser();
  if (!user) {
    const signIn = new URL('/msp/signin', request.nextUrl.origin);
    signIn.searchParams.set('callbackUrl', request.nextUrl.toString());
    return new NextResponse(`<!doctype html><html lang="en"><title>Confirm ticket reply</title><main><h1>Confirm ticket reply</h1><p>Sign in as the intended internal user to confirm this reply.</p><a href="${signIn.toString()}">Sign in</a></main></html>`, { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
  }
  return userMatches(user, pending)
    ? page(token, `Confirm reply for ticket ${String(pending.payload.ticketId)}.`, String(pending.payload.text || ''))
    : denied();
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (origin !== request.nextUrl.origin) return denied();
  const form = await request.formData();
  const token = String(form.get('token') || '');
  const pending = await loadConfirmation(token);
  if (!pending) return denied();
  const user = await getCurrentUser();
  if (!userMatches(user, pending)) return denied();

  // The approval service re-resolves the cm2 token, relationship, audience, and current actor permissions.
  const result = await approveInboundSenderConfirmation(token, user);
  return result
    ? NextResponse.json({ confirmed: true, ...result }, { headers })
    : denied();
}
