/**
 * Software Search API Routes
 * Path: /api/v1/software/search
 *
 * GET - Search software across all assets (fleet-wide)
 *
 * Query parameters:
 * - search: search term for name/publisher
 * - category: SoftwareCategory filter
 * - software_type: SoftwareType filter
 * - is_managed: boolean filter
 * - is_security_relevant: boolean filter
 * - client_id: filter to specific client
 * - page: number (default 1)
 * - limit: number (default 50)
 */

import { NextResponse } from 'next/server';
import { searchSoftwareFleetWide } from 'server/src/lib/actions/asset-actions/softwareActions';
import { SoftwareCategory, SoftwareType } from 'server/src/interfaces/software.interfaces';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const search = url.searchParams.get('search') || undefined;
    const category = url.searchParams.get('category') as SoftwareCategory | null;
    const software_type = url.searchParams.get('software_type') as SoftwareType | null;
    const is_managed = url.searchParams.has('is_managed')
      ? url.searchParams.get('is_managed') === 'true'
      : undefined;
    const is_security_relevant = url.searchParams.has('is_security_relevant')
      ? url.searchParams.get('is_security_relevant') === 'true'
      : undefined;
    const client_id = url.searchParams.get('client_id') || undefined;

    const result = await searchSoftwareFleetWide({
      search,
      category: category || undefined,
      software_type: software_type || undefined,
      is_managed,
      is_security_relevant,
      client_id,
      page,
      limit,
    });

    return NextResponse.json({
      data: result.results,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / result.limit),
      },
      _links: {
        self: { href: `/api/v1/software/search` },
        assets: { href: `/api/v1/assets` },
      },
    });
  } catch (error) {
    console.error('Failed to search software:', error);
    return NextResponse.json(
      { error: 'Failed to search software' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
