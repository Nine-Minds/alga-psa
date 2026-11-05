/**
 * GET /api/labels/linked-assets?ticketId=…
 *
 * Read-only lookup for the single-ticket print dialog's linked-asset picker: the assets linked to the
 * ticket that the caller may read: tag, name and the custody facts the tag would print for each. The ticket must itself be readable. Anything
 * else is the uniform 404, so the response reveals nothing. Session-authenticated in-handler.
 */

import { AuthenticationError, withAuth } from '@alga-psa/auth';
import { listTicketLinkedAssetChoices } from '@alga-psa/assets/lib/ticketLinkedAssetLabels';
import { ticketLabelViewModelProvider } from '@alga-psa/tickets/lib/labelViewModelProvider';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const listChoices = withAuth(async (user, { tenant }, ticketId: string) => {
  if (user.user_type !== 'internal') return null;
  const context = { tenant, user, baseUrl: process.env.NEXTAUTH_URL ?? 'http://localhost' };
  const [ticket] = await ticketLabelViewModelProvider.getLabelViewModels(context, [ticketId]);
  if (!ticket) return null;
  return listTicketLinkedAssetChoices(context, ticketId);
});

export async function GET(request: Request) {
  const ticketId = new URL(request.url).searchParams.get('ticketId');
  if (!ticketId || !UUID.test(ticketId)) {
    return json(400, { error: 'ticketId must be a ticket id.' });
  }
  try {
    const assets = await listChoices(ticketId);
    return assets ? json(200, { assets }) : json(404, { error: 'Not found.' });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return json(401, { error: 'Not authenticated.' });
    }
    return json(500, { error: 'Failed to load linked assets.' });
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
