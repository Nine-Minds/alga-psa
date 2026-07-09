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
import { searchSoftwareFleetWide } from '@alga-psa/assets/actions/softwareActions';
import { assetActionErrorFrom, assetActionErrorMessage } from '@alga-psa/assets/actions/assetActionErrors';
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

function parseOptionalBooleanParam(value: string | null, name: string): { value: boolean | undefined } | { error: string } {
  if (value === null || value === '') {
    return { value: undefined };
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
  const status = 'permissionError' in expectedError ? 403 : 400;
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const pageParam = parsePositiveIntParam(url.searchParams.get('page'), 'page', 1);
    if ('error' in pageParam) {
      return NextResponse.json({ error: pageParam.error }, { status: 400 });
    }
    const limitParam = parsePositiveIntParam(url.searchParams.get('limit'), 'limit', 50, 100);
    if ('error' in limitParam) {
      return NextResponse.json({ error: limitParam.error }, { status: 400 });
    }

    const search = url.searchParams.get('search') || undefined;
    const categoryParam = url.searchParams.get('category');
    if (categoryParam && !SOFTWARE_CATEGORIES.has(categoryParam)) {
      return NextResponse.json({ error: 'category is not valid' }, { status: 400 });
    }
    const softwareTypeParam = url.searchParams.get('software_type');
    if (softwareTypeParam && !SOFTWARE_TYPES.has(softwareTypeParam)) {
      return NextResponse.json({ error: 'software_type is not valid' }, { status: 400 });
    }

    const isManagedParam = parseOptionalBooleanParam(url.searchParams.get('is_managed'), 'is_managed');
    if ('error' in isManagedParam) {
      return NextResponse.json({ error: isManagedParam.error }, { status: 400 });
    }
    const isSecurityRelevantParam = parseOptionalBooleanParam(url.searchParams.get('is_security_relevant'), 'is_security_relevant');
    if ('error' in isSecurityRelevantParam) {
      return NextResponse.json({ error: isSecurityRelevantParam.error }, { status: 400 });
    }

    const page = pageParam.value;
    const limit = limitParam.value;
    const category = categoryParam as SoftwareCategory | null;
    const software_type = softwareTypeParam as SoftwareType | null;
    const is_managed = isManagedParam.value;
    const is_security_relevant = isSecurityRelevantParam.value;
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

    const actionError = assetActionErrorResponse(result);
    if (actionError) {
      return actionError;
    }

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
