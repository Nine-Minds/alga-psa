/**
 * Asset Summary API Routes
 * Path: /api/v1/assets/[id]/summary
 *
 * GET - Returns summary metrics (health, security, warranty, open tickets)
 */

import { NextResponse } from 'next/server';
import { getAssetSummaryMetrics } from '@alga-psa/assets/actions/assetActions';
import { assetActionErrorFrom, assetActionErrorMessage } from '@alga-psa/assets/actions/assetActionErrors';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Missing asset ID' }, { status: 400 });
    }

    const summary = await getAssetSummaryMetrics(id);
    const expectedError = assetActionErrorFrom(summary);
    if (expectedError) {
      const message = assetActionErrorMessage(expectedError);
      const status = 'permissionError' in expectedError
        ? 403
        : message.startsWith('Asset not found')
          ? 404
          : 400;

      return NextResponse.json({ error: message }, { status });
    }

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
    console.error('Failed to get asset summary:', error);
    return NextResponse.json(
      { error: 'Failed to get asset summary' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
