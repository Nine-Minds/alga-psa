/**
 * Asset Software API Routes
 * Path: /api/v1/assets/[id]/software
 *
 * GET - Returns paginated software inventory for an asset
 *
 * Query parameters:
 * - page: number (default 1)
 * - limit: number (default 50)
 * - category: SoftwareCategory filter
 * - software_type: SoftwareType filter
 * - search: search term for name/publisher
 * - include_uninstalled: boolean (default false)
 */

import { NextResponse } from 'next/server';
import {
  getAssetSoftware,
  getAssetSoftwareSummary,
} from 'server/src/lib/actions/asset-actions/softwareActions';
import { SoftwareCategory, SoftwareType } from 'server/src/interfaces/software.interfaces';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Missing asset ID' }, { status: 400 });
    }

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const category = url.searchParams.get('category') as SoftwareCategory | null;
    const software_type = url.searchParams.get('software_type') as SoftwareType | null;
    const search = url.searchParams.get('search') || undefined;
    const include_uninstalled = url.searchParams.get('include_uninstalled') === 'true';

    // Fetch software list and summary in parallel
    const [softwareResult, summary] = await Promise.all([
      getAssetSoftware({
        asset_id: id,
        page,
        limit,
        category: category || undefined,
        software_type: software_type || undefined,
        search,
        include_uninstalled,
      }),
      getAssetSoftwareSummary(id),
    ]);

    return NextResponse.json({
      data: softwareResult.software,
      summary,
      pagination: {
        page: softwareResult.page,
        limit: softwareResult.limit,
        total: softwareResult.total,
        totalPages: Math.ceil(softwareResult.total / softwareResult.limit),
      },
      _links: {
        self: { href: `/api/v1/assets/${id}/software` },
        asset: { href: `/api/v1/assets/${id}` },
        fleetSearch: { href: `/api/v1/software/search` },
      },
    });
  } catch (error) {
    console.error('Failed to get asset software:', error);
    return NextResponse.json(
      { error: 'Failed to get software inventory' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
