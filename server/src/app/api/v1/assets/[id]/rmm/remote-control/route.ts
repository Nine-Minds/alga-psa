/**
 * Remote Control API Routes
 * Path: /api/v1/assets/[id]/rmm/remote-control
 *
 * GET - Returns remote control URL for the asset
 *
 * Query parameters:
 * - type: 'splashtop' | 'teamviewer' | 'vnc' | 'rdp' | 'shell' (default: 'splashtop')
 */

import { NextResponse } from 'next/server';
import { getAssetRemoteControlUrl } from '@/lib/actions/asset-actions/rmmActions';
import { ASSET_RMM_REMOTE_CONTROL_SOURCE } from '@alga-psa/authorization/recordProjection';
import { readAssetGateForRequest, assetNotFoundResponse } from 'server/src/lib/api/controllers/assetReadGuard';
import { reprojectUnderDecision } from 'server/src/lib/api/controllers/authorizationKernel';
import { runWithApiKeyOrSession } from 'server/src/lib/api/middleware/runWithApiKeyOrSession';
import { rmmErrorResponse, rmmRouteErrorFrom } from '../rmmRouteErrors';

export async function GET(
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

    const url = new URL(request.url);
    const connectionType = (url.searchParams.get('type') || 'splashtop') as
      | 'splashtop'
      | 'teamviewer'
      | 'vnc'
      | 'rdp'
      | 'shell';

    const remoteControlUrl = await runWithApiKeyOrSession(
      request,
      () => getAssetRemoteControlUrl(id, connectionType),
    );

    if (!remoteControlUrl) {
      return NextResponse.json({
        data: null,
        message: 'Remote control not available for this asset',
      });
    }

    const data = reprojectUnderDecision(
      gate.projection,
      { url: remoteControlUrl, type: connectionType },
      ASSET_RMM_REMOTE_CONTROL_SOURCE,
    );
    if (data === null) return assetNotFoundResponse();

    return NextResponse.json({
      data,
      _links: {
        self: { href: `/api/v1/assets/${id}/rmm/remote-control` },
        asset: { href: `/api/v1/assets/${id}` },
        rmmData: { href: `/api/v1/assets/${id}/rmm` },
      },
    });
  } catch (error) {
    console.error('Failed to get remote control URL:', error);
    const expectedError = rmmRouteErrorFrom(error);
    if (expectedError) {
      return rmmErrorResponse(expectedError);
    }
    return NextResponse.json(
      { error: 'Failed to get remote control URL' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
