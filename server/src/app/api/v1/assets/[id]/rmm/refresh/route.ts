/**
 * RMM Refresh API Routes
 * Path: /api/v1/assets/[id]/rmm/refresh
 *
 * POST - Triggers a single-device sync and returns fresh RMM data
 */

import { NextResponse } from 'next/server';
import { refreshAssetRmmData } from '@/lib/actions/asset-actions/rmmActions';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Missing asset ID' }, { status: 400 });
    }

    const rmmData = await refreshAssetRmmData(id);

    if (!rmmData) {
      return NextResponse.json(
        {
          data: null,
          message: 'Asset is not managed by an RMM provider',
        },
        { status: 404 }
      );
    }

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
    return NextResponse.json(
      { error: 'Failed to refresh RMM data' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
