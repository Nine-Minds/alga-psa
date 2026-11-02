/**
 * Asset Summary API Routes
 * Path: /api/v1/assets/[id]/summary
 *
 * GET - Returns summary metrics (health, security, warranty, open tickets)
 */

import { NextResponse } from 'next/server';
import { withTransaction } from '@alga-psa/db';
import { calculateAssetSummaryMetrics, loadAssetSummaryFacts, loadAssetSummaryTickets } from '@alga-psa/assets/lib/assetSummary';
import { assetSummaryRecordSource } from '@alga-psa/authorization/recordProjection';
import { ASSET_SUMMARY_TICKET_SOURCE } from '@alga-psa/co-managed/recordProjection';
import { readAssetGateForRequest, assetNotFoundResponse } from 'server/src/lib/api/controllers/assetReadGuard';
import {
  isAuthorizedProjectionFieldReadable,
  projectApiResourceReads,
  reprojectUnderDecision,
  reprojectUnderDecisions,
} from 'server/src/lib/api/controllers/authorizationKernel';
import { getConnection } from 'server/src/lib/db/db';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { ForbiddenError, NotFoundError, UnauthorizedError } from 'server/src/lib/api/middleware/apiErrors';
import { createErrorResponse } from 'server/src/lib/api/utils/response';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: 'Missing asset ID' }, { status: 400 });

    const gate = await readAssetGateForRequest(request, id);
    if (gate.denied) return gate.denied;
    const { projection: assetGate, context } = gate;
    const knex = await getConnection(context.tenant);
    const summary = await withTransaction(knex, async (trx) => {
      const facts = await loadAssetSummaryFacts(trx, context.tenant, id);
      let openTicketsCount = 0;
      if (await hasPermission(context.user!, 'ticket', 'read', trx)) {
        const tickets = await loadAssetSummaryTickets(trx, context.tenant, id);
        const ticketProjections = await projectApiResourceReads({
          knex: trx,
          tenant: context.tenant,
          user: context.user,
          apiKeyId: context.apiKeyId,
          kind: 'ticket',
          records: tickets,
          source: ASSET_SUMMARY_TICKET_SOURCE,
        });
        // Both the owning asset and each linked ticket govern association membership and its status predicate.
        for (const ticket of ticketProjections) {
          const projected = reprojectUnderDecisions([assetGate, ticket], ticket, ASSET_SUMMARY_TICKET_SOURCE);
          if (projected && isAuthorizedProjectionFieldReadable(projected, 'status_is_closed', ASSET_SUMMARY_TICKET_SOURCE)
            && projected.status_is_closed === false) openTicketsCount += 1;
        }
      }
      return reprojectUnderDecision(
        assetGate,
        calculateAssetSummaryMetrics(facts, openTicketsCount),
        assetSummaryRecordSource(facts.asset.asset_type),
      );
    });
    if (summary === null) return assetNotFoundResponse();

    return NextResponse.json({
      data: summary,
      _links: {
        self: { href: `/api/v1/assets/${id}/summary` },
        asset: { href: `/api/v1/assets/${id}` },
        rmmData: { href: `/api/v1/assets/${id}/rmm` },
        software: { href: `/api/v1/assets/${id}/software` },
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Asset not found') return assetNotFoundResponse();
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError || error instanceof NotFoundError) {
      return createErrorResponse(error.message, error.statusCode, error.code);
    }
    console.error('Failed to get asset summary:', error);
    return NextResponse.json({ error: 'Failed to get asset summary' }, { status: 500 });
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
