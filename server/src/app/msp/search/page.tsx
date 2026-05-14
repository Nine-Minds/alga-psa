import type { Metadata } from 'next';

import {
  searchAppAction,
  type SearchAppResult,
} from '@/lib/actions/searchActions';
import { SEARCH_OBJECT_TYPES, type SearchObjectType } from '@/lib/search/types';
import SearchPageClient from './SearchPageClient';

export const metadata: Metadata = {
  title: 'Search',
};

export const dynamic = 'force-dynamic';

interface SearchPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function parseTypeFilter(value: string | undefined): SearchObjectType[] | undefined {
  if (!value || value === 'all') {
    return undefined;
  }

  return (SEARCH_OBJECT_TYPES as readonly string[]).includes(value)
    ? [value as SearchObjectType]
    : undefined;
}

function parseCursorStack(value: string | undefined): Array<string | null> {
  if (!value) {
    return [];
  }

  return value.split('.').map((entry) => (entry.length > 0 ? entry : null));
}

const emptyResult: SearchAppResult = {
  results: [],
  groups: Object.fromEntries(
    SEARCH_OBJECT_TYPES.map((type) => [type, 0]),
  ) as SearchAppResult['groups'],
  totalCount: 0,
};

export default async function MspSearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const query = firstParam(params.q)?.trim() ?? '';
  const type = firstParam(params.type);
  const cursor = firstParam(params.cursor);
  const cursorStack = parseCursorStack(firstParam(params.cursorStack));
  const sort = firstParam(params.sort) === 'recent' ? 'recent' : 'relevance';
  const result = query.length > 0
    ? await searchAppAction({
      query,
      types: parseTypeFilter(type),
      cursor,
      limit: 25,
      sort,
    })
    : emptyResult;

  return (
    <SearchPageClient
      initialQuery={query}
      initialType={type}
      initialCursor={cursor}
      initialCursorStack={cursorStack}
      initialSort={sort}
      initialResult={result}
    />
  );
}
