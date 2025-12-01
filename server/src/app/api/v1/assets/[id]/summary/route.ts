/**
 * Asset Summary API Routes
 * Path: /api/v1/assets/[id]/summary
 *
 * GET - Returns summary metrics (health, security, warranty, open tickets)
 */

import { NextResponse } from 'next/server';
import { getAssetSummaryMetrics } from 'server/src/lib/actions/asset-actions/assetSummaryActions';

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
    if (error instanceof Error && error.message === 'Asset not found') {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }
    return NextResponse.json(
      { error: 'Failed to get asset summary' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
