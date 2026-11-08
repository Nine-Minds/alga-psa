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
import { getAssetSoftwareForApi } from '@alga-psa/assets/actions/softwareActions';
import { assetActionErrorFrom, assetActionErrorMessage } from '@alga-psa/assets/actions/assetActionErrors';
import { readAssetGateForRequest } from 'server/src/lib/api/controllers/assetReadGuard';
import {
  isAuthorizedProjectionFieldReadable,
  reprojectUnderDecision,
} from 'server/src/lib/api/controllers/authorizationKernel';
import {
  ASSET_SOFTWARE_SOURCE,
  ASSET_SOFTWARE_SUMMARY_SOURCE,
} from '@alga-psa/co-managed/recordProjection';
import { runWithApiKeyOrSession } from 'server/src/lib/api/middleware/runWithApiKeyOrSession';
import type {
  AssetSoftwareDisplayItem,
  AssetSoftwareSummary,
  SoftwareCategory,
  SoftwareType,
} from '@alga-psa/types';

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

function countBy<T>(rows: readonly AssetSoftwareDisplayItem[], key: (row: AssetSoftwareDisplayItem) => T): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const value = key(row);
    const name = value == null || value === '' ? 'Uncategorized' : String(value);
    counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
}

function summarizeVisibleSoftware(
  rows: readonly AssetSoftwareDisplayItem[],
  readable: (field: string) => boolean,
): Record<string, any> {
  const hasVisibleRows = rows.length > 0;
  const currentReadable = !hasVisibleRows || readable('is_current');
  const currentRows = currentReadable ? rows.filter((row) => row.is_current === true) : [];
  const categoryReadable = currentReadable && (!hasVisibleRows || readable('category'));
  const typeReadable = currentReadable && (!hasVisibleRows || readable('software_type'));
  const securityReadable = currentReadable && (!hasVisibleRows || readable('is_security_relevant'));
  const managedReadable = currentReadable && (!hasVisibleRows || readable('is_managed'));
  const firstSeenReadable = currentReadable && (!hasVisibleRows || readable('first_seen_at'));
  const byType: Record<SoftwareType, number> = {
    application: 0,
    driver: 0,
    update: 0,
    system: 0,
  };
  if (typeReadable) {
    for (const row of currentRows) {
      if (row.software_type in byType) byType[row.software_type] += 1;
    }
  }

  const recentSince = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recentlyInstalled = firstSeenReadable
    ? currentRows.filter((row) => {
      const firstSeen = new Date(row.first_seen_at).getTime();
      return Number.isFinite(firstSeen) && firstSeen >= recentSince;
    }).length
    : null;

  return {
    total_installed: currentReadable ? currentRows.length : null,
    by_category: categoryReadable ? countBy(currentRows, (row) => row.category) : null,
    by_type: typeReadable ? byType : null,
    security_software_count: securityReadable
      ? currentRows.filter((row) => row.is_security_relevant).length
      : null,
    managed_software_count: managedReadable
      ? currentRows.filter((row) => row.is_managed).length
      : null,
    recently_installed_count: recentlyInstalled,
  };
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

    const { projection: assetGate, denied } = await readAssetGateForRequest(request, id);
    if (denied) return denied;

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

    // Authorization precedes data loading; project the complete candidate set
    // before any predicate, pagination, or summary can observe hidden rows.
    const rawRows = await runWithApiKeyOrSession(request, () => getAssetSoftwareForApi(id));
    const softwareError = assetActionErrorResponse(rawRows);
    if (softwareError) return softwareError;
    const projectedRows = reprojectUnderDecision(
      assetGate,
      rawRows as AssetSoftwareDisplayItem[],
      ASSET_SOFTWARE_SOURCE,
    ) as Array<Partial<AssetSoftwareDisplayItem> & { software_id: string }>;
    const fieldReadable = (field: string) => isAuthorizedProjectionFieldReadable(
      assetGate, field, ASSET_SOFTWARE_SOURCE,
    );

    const term = search?.trim().toLocaleLowerCase();
    const searchableFields = (['name', 'publisher'] as const).filter(fieldReadable);
    let visibleRows = projectedRows.filter((row) => {
      if (!include_uninstalled && (!fieldReadable('is_current') || row.is_current !== true)) return false;
      if (category && (!fieldReadable('category') || row.category !== category)) return false;
      if (software_type && (!fieldReadable('software_type') || row.software_type !== software_type)) return false;
      if (term) {
        const matches = searchableFields.some((field) =>
          typeof row[field] === 'string' && row[field]!.toLocaleLowerCase().includes(term),
        );
        if (!matches) return false;
      }
      return true;
    });

    visibleRows = visibleRows.sort((left, right) => {
      const leftName = fieldReadable('name') && typeof left.name === 'string' ? left.name.toLocaleLowerCase() : left.software_id;
      const rightName = fieldReadable('name') && typeof right.name === 'string' ? right.name.toLocaleLowerCase() : right.software_id;
      return leftName.localeCompare(rightName);
    });

    const total = visibleRows.length;
    const data = visibleRows.slice((page - 1) * limit, page * limit);
    const rawSummary = summarizeVisibleSoftware(projectedRows as AssetSoftwareDisplayItem[], fieldReadable);
    const summary = reprojectUnderDecision(assetGate, rawSummary, ASSET_SOFTWARE_SUMMARY_SOURCE);

    return NextResponse.json({
      data,
      summary,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
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
