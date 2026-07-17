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
} from '@alga-psa/assets/actions/softwareActions';
import { assetActionErrorFrom, assetActionErrorMessage } from '@alga-psa/assets/actions/assetActionErrors';
import { runWithApiKeyOrSession } from 'server/src/lib/api/middleware/runWithApiKeyOrSession';
import type { SoftwareCategory, SoftwareType } from '@alga-psa/types';

const SOFTWARE_CATEGORIES = new Set<string>([
  'Browser',
  'Productivity',
  'Development',
  'Security',
  'Communication',
  'Creative',
  'Runtime',
  'Driver',
]);

const SOFTWARE_TYPES = new Set<string>(['application', 'driver', 'update', 'system']);

function parsePositiveIntParam(
  value: string | null,
  name: string,
  defaultValue: number,
  maxValue?: number,
): { value: number } | { error: string } {
  if (value === null || value === '') {
    return { value: defaultValue };
  }
  if (!/^\d+$/.test(value)) {
    return { error: `${name} must be a positive integer` };
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return { error: `${name} must be a positive integer` };
  }
  if (maxValue !== undefined && parsed > maxValue) {
    return { error: `${name} must be between 1 and ${maxValue}` };
  }
  return { value: parsed };
}

function parseBooleanParam(value: string | null, name: string, defaultValue: boolean): { value: boolean } | { error: string } {
  if (value === null || value === '') {
    return { value: defaultValue };
  }
  if (value === 'true') {
    return { value: true };
  }
  if (value === 'false') {
    return { value: false };
  }
  return { error: `${name} must be true or false` };
}

function assetActionErrorResponse(value: unknown): NextResponse | null {
  const expectedError = assetActionErrorFrom(value);
  if (!expectedError) {
    return null;
  }

  const message = assetActionErrorMessage(expectedError);
  const status = 'permissionError' in expectedError
    ? 403
    : message.startsWith('Asset not found')
      ? 404
      : 400;

  return NextResponse.json({ error: message }, { status });
}

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
    const pageParam = parsePositiveIntParam(url.searchParams.get('page'), 'page', 1);
    if ('error' in pageParam) {
      return NextResponse.json({ error: pageParam.error }, { status: 400 });
    }
    const limitParam = parsePositiveIntParam(url.searchParams.get('limit'), 'limit', 50, 100);
    if ('error' in limitParam) {
      return NextResponse.json({ error: limitParam.error }, { status: 400 });
    }

    const categoryParam = url.searchParams.get('category');
    if (categoryParam && !SOFTWARE_CATEGORIES.has(categoryParam)) {
      return NextResponse.json({ error: 'category is not valid' }, { status: 400 });
    }
    const softwareTypeParam = url.searchParams.get('software_type');
    if (softwareTypeParam && !SOFTWARE_TYPES.has(softwareTypeParam)) {
      return NextResponse.json({ error: 'software_type is not valid' }, { status: 400 });
    }

    const includeUninstalledParam = parseBooleanParam(url.searchParams.get('include_uninstalled'), 'include_uninstalled', false);
    if ('error' in includeUninstalledParam) {
      return NextResponse.json({ error: includeUninstalledParam.error }, { status: 400 });
    }

    const page = pageParam.value;
    const limit = limitParam.value;
    const category = categoryParam as SoftwareCategory | null;
    const software_type = softwareTypeParam as SoftwareType | null;
    const search = url.searchParams.get('search') || undefined;
    const include_uninstalled = includeUninstalledParam.value;

    // Fetch software list and summary in parallel (API-key callers resolve the
    // withAuth identity via the key; session callers pass through).
    const [softwareResult, summary] = await runWithApiKeyOrSession(request, () => Promise.all([
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
    ]));

    const softwareError = assetActionErrorResponse(softwareResult);
    if (softwareError) {
      return softwareError;
    }
    const summaryError = assetActionErrorResponse(summary);
    if (summaryError) {
      return summaryError;
    }

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
