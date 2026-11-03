/**
 * RMM Data API Routes
 * Path: /api/v1/assets/[id]/rmm
 *
 * GET - Returns cached RMM data for an asset (populated during sync)
 */

import { NextResponse } from 'next/server';
import { getAssetRmmDataForApi } from '@/lib/actions/asset-actions/rmmActions';
import { assetRmmRecordSource } from '@alga-psa/authorization/recordProjection';
import { readAssetGateForRequest, assetNotFoundResponse } from 'server/src/lib/api/controllers/assetReadGuard';
import { reprojectUnderDecision, type AuthorizedProjection } from 'server/src/lib/api/controllers/authorizationKernel';
import { runWithApiKeyOrSession } from 'server/src/lib/api/middleware/runWithApiKeyOrSession';
import { rmmErrorResponse, rmmRouteErrorFrom } from './rmmRouteErrors';

export async function GET(
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

    const result = await runWithApiKeyOrSession(request, () => getAssetRmmDataForApi(id));

    if (!result?.data) {
      return NextResponse.json({
        data: null,
        message: 'No RMM data available for this asset',
      });
    }

    const rmmData = reprojectUnderDecision(
      gate.projection,
      result.data,
      assetRmmRecordSource(result.assetType),
    );
    if (rmmData === null) return assetNotFoundResponse();

    return NextResponse.json({
      data: rmmData,
      _links: {
        self: { href: `/api/v1/assets/${id}/rmm` },
        refresh: { href: `/api/v1/assets/${id}/rmm/refresh`, method: 'POST' },
        asset: { href: `/api/v1/assets/${id}` },
      },
    });
  } catch (error) {
    console.error('Failed to get asset RMM data:', error);
    const expectedError = rmmRouteErrorFrom(error);
    if (expectedError) {
      return rmmErrorResponse(expectedError, assetProjection);
    }
    return NextResponse.json(
      { error: 'Failed to get RMM data' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
