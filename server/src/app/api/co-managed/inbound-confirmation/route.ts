import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { getAdminConnection, tenantDb } from '@alga-psa/db';
import '@alga-psa/co-managed/deliveryRegistration';
import {
  approveInboundSenderConfirmation,
  approveInboundContactSenderConfirmation,
  loadInboundContactConfirmation,
  isInboundSenderConfirmationRedeemable,
  parseInboundSenderConfirmationToken,
} from '@alga-psa/co-managed/inboundSenderConfirmation';

const headers = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'origin',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};
function trustedPublicOrigin(): string | null {
  // NEXTAUTH_URL is the application's canonical public URL. APP_BASE_URL is
  // retained as the same fallback used by confirmation-link generation.
  const configuredUrl = process.env.NEXTAUTH_URL || process.env.APP_BASE_URL;
  if (!configuredUrl) return null;
  try {
    const url = new URL(configuredUrl);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function isTrustedPublicOrigin(value: string | null, trustedOrigin: string | null): boolean {
  if (!value || value === 'null' || !trustedOrigin) return false;
  try {
    const parsed = new URL(value);
    // Origin headers are serialized origins, never arbitrary URLs. Requiring
    // exact serialization also rejects credentials, paths, and malformed input.
    return parsed.origin === value && parsed.origin === trustedOrigin
      && (parsed.protocol === 'http:' || parsed.protocol === 'https:');
  } catch {
    return false;
  }
}
const denied = () => new NextResponse('This confirmation is invalid, expired, or no longer available.', { status: 403, headers });
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const page = (token: string, message = 'Confirm this reply to add it to the co-managed ticket conversation.', replyText = '') =>
  new NextResponse(`<!doctype html><html lang="en"><meta name="referrer" content="origin"><title>Confirm ticket reply</title><main><h1>Confirm ticket reply</h1><p>${escapeHtml(message)}</p><p>Only confirm if you wrote this reply.</p><pre>${escapeHtml(replyText)}</pre><form method="post"><input type="hidden" name="token" value="${escapeHtml(token)}"><button type="submit">Confirm reply</button></form></main></html>`, {
    headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
  });

async function loadConfirmation(token: string) {
  const claims = parseInboundSenderConfirmationToken(token);
  if (!claims) return null;
  const contact = await loadInboundContactConfirmation(claims);
  if (contact) return { tenant: claims.tenant, row: contact.row, payload: contact.payload, contact: true };
  const db = await getAdminConnection();
  const row = await tenantDb(db, claims.tenant).table('co_management_deliveries')
    .where({ tenant: claims.tenant, delivery_kind: 'sender_confirmation', source_id: claims.sourceId })
    .first('recipient', 'payload', 'updated_at');
  if (!row?.payload) return null;
  const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  if (payload.expiresAt !== claims.expiresAt
    || !isInboundSenderConfirmationRedeemable(payload.state, row.updated_at)
    || Date.parse(payload.expiresAt) <= Date.now()) return null;
  return { tenant: claims.tenant, row, payload, contact: false };
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
  if (pending.contact) return page(token, `Confirm reply for ticket ${String(pending.payload.ticketId)}.`, String(pending.payload.emailData?.body?.text || ''));
  const user = await getCurrentUser();
  if (!user) {
    const publicOrigin = trustedPublicOrigin();
    if (!publicOrigin) return denied();
    const signIn = new URL('/auth/msp/signin', publicOrigin);
    const callback = new URL(publicOrigin);
    callback.pathname = request.nextUrl.pathname;
    callback.search = request.nextUrl.search;
    signIn.searchParams.set('callbackUrl', callback.toString());
    return new NextResponse(`<!doctype html><html lang="en"><title>Confirm ticket reply</title><main><h1>Confirm ticket reply</h1><p>Sign in as the intended internal user to confirm this reply.</p><a href="${signIn.toString()}">Sign in</a></main></html>`, { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
  }
  return userMatches(user, pending)
    ? page(token, `Confirm reply for ticket ${String(pending.payload.ticketId)}.`, String(pending.payload.text || ''))
    : denied();
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (!isTrustedPublicOrigin(origin, trustedPublicOrigin())) return denied();
  const form = await request.formData();
  const token = String(form.get('token') || '');
  const pending = await loadConfirmation(token);
  if (!pending) return denied();
  if (pending.contact) {
    const result = await approveInboundContactSenderConfirmation(token);
    return result ? NextResponse.json({ confirmed: true, result }, { headers }) : denied();
  }
  const user = await getCurrentUser();
  if (!user || !userMatches(user, pending)) return denied();

  // The approval service re-resolves the cm2 token, relationship, audience, and current actor permissions.
  const result = await approveInboundSenderConfirmation(token, user);
  return result
    ? NextResponse.json({ confirmed: true, ...result }, { headers })
    : denied();
}
