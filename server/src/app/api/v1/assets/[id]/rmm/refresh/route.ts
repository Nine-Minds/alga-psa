/**
 * RMM Refresh API Routes
 * Path: /api/v1/assets/[id]/rmm/refresh
 *
 * POST - Triggers a single-device sync and returns fresh RMM data
 */

import { NextResponse } from 'next/server';
import { refreshAssetRmmDataForApi } from '@/lib/actions/asset-actions/rmmActions';
import { assetRmmRecordSource } from '@alga-psa/authorization/recordProjection';
import { readAssetGateForRequest, assetNotFoundResponse } from 'server/src/lib/api/controllers/assetReadGuard';
import { reprojectUnderDecision, type AuthorizedProjection } from 'server/src/lib/api/controllers/authorizationKernel';
import { runWithApiKeyOrSession } from 'server/src/lib/api/middleware/runWithApiKeyOrSession';
import { rmmErrorResponse, rmmRouteErrorFrom } from '../rmmRouteErrors';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let assetProjection: AuthorizedProjection<Record<string, any>> | undefined;
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Missing asset ID' }, { status: 400 });
    }

    const gate = await readAssetGateForRequest(request, id);
    if (gate.denied) return gate.denied;
    assetProjection = gate.projection;

    const result = await runWithApiKeyOrSession(request, () => refreshAssetRmmDataForApi(id));

    if (!result?.data) {
      return NextResponse.json(
        {
          data: null,
          message: 'Asset is not managed by an RMM provider',
        },
        { status: 404 }
      );
    }

    const rmmData = reprojectUnderDecision(
      gate.projection,
      result.data,
      assetRmmRecordSource(result.assetType),
    );
    if (rmmData === null) return assetNotFoundResponse();

    return NextResponse.json({
      data: rmmData,
      message: 'RMM data refreshed successfully',
      _links: {
        self: { href: `/api/v1/assets/${id}/rmm/refresh`, method: 'POST' },
        rmmData: { href: `/api/v1/assets/${id}/rmm` },
        asset: { href: `/api/v1/assets/${id}` },
      },
    });
  } catch (error) {
    console.error('Failed to refresh asset RMM data:', error);
    const expectedError = rmmRouteErrorFrom(error);
    if (expectedError) {
      return rmmErrorResponse(expectedError, assetProjection);
    }
    return NextResponse.json(
      { error: 'Failed to refresh RMM data' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
