/**
 * RMM Data API Routes
 * Path: /api/v1/assets/[id]/rmm
 *
 * GET - Returns cached RMM data for an asset (populated during sync)
 */

import { NextResponse } from 'next/server';
import { getAssetRmmData } from '@ee/lib/actions/asset-actions/rmmActions';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Missing asset ID' }, { status: 400 });
    }

    const rmmData = await getAssetRmmData(id);

    if (!rmmData) {
      return NextResponse.json({
        data: null,
        message: 'No RMM data available for this asset',
      });
    }

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
    return NextResponse.json(
      { error: 'Failed to get RMM data' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
