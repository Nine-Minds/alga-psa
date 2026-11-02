/**
 * Device Reboot API Routes
 * Path: /api/v1/assets/[id]/rmm/reboot
 *
 * POST - Triggers a reboot on the RMM-managed device
 */

import { NextResponse } from 'next/server';
import { triggerRmmReboot } from '@/lib/actions/asset-actions/rmmActions';
import { ASSET_RMM_COMMAND_RESPONSE_SOURCE } from '@alga-psa/authorization/recordProjection';
import { readAssetGateForRequest, assetNotFoundResponse } from 'server/src/lib/api/controllers/assetReadGuard';
import { reprojectUnderDecision } from 'server/src/lib/api/controllers/authorizationKernel';
import { runWithApiKeyOrSession } from 'server/src/lib/api/middleware/runWithApiKeyOrSession';
import { rmmErrorResponse, rmmRouteErrorFrom } from '../rmmRouteErrors';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Missing asset ID' }, { status: 400 });
    }

    const gate = await readAssetGateForRequest(request, id);
    if (gate.denied) return gate.denied;

    const result = await runWithApiKeyOrSession(request, () => triggerRmmReboot(id));
    const expectedError = result.success ? null : rmmRouteErrorFrom(result.message);
    const data = reprojectUnderDecision(
      gate.projection,
      result,
      ASSET_RMM_COMMAND_RESPONSE_SOURCE,
    );
    if (data === null) return assetNotFoundResponse();

    if (!data.success) {
      return NextResponse.json(
        {
          success: false,
          message: data.message,
        },
        { status: expectedError?.status ?? 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: data.message,
      _links: {
        self: { href: `/api/v1/assets/${id}/rmm/reboot`, method: 'POST' },
        asset: { href: `/api/v1/assets/${id}` },
        rmmData: { href: `/api/v1/assets/${id}/rmm` },
      },
    });
  } catch (error) {
    console.error('Failed to trigger device reboot:', error);
    const expectedError = rmmRouteErrorFrom(error);
    if (expectedError) {
      return rmmErrorResponse(expectedError);
    }
    return NextResponse.json(
      { error: 'Failed to trigger device reboot' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
