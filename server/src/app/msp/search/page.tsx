import type { Metadata } from 'next';

import {
  searchAppAction,
  type SearchAppResult,
} from '@/lib/actions/searchActions';
import { SEARCH_OBJECT_TYPES, type SearchObjectType } from '@/lib/search/types';

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
  const sort = firstParam(params.sort) === 'recent' ? 'recent' : 'relevance';
  const result = query.length > 0
    ? await searchAppAction({
      query,
      types: parseTypeFilter(type),
      cursor,
      limit: 25,
    })
    : emptyResult;

  return (
    <main
      id="app-search-page"
      className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-6"
      data-search-sort={sort}
    >
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">Search</h1>
        <p className="mt-1 text-sm text-gray-600">
          {query ? `${result.totalCount} results for "${query}"` : 'Search across the workspace.'}
        </p>
      </header>

      <section className="space-y-2">
        {result.results.map((row) => (
          <a
            key={`${row.type}-${row.id}`}
            id={`app-search-result-row-${row.type}-${row.id}`}
            href={row.url}
            className="block rounded-md border border-gray-200 bg-white px-4 py-3 text-gray-900 hover:border-purple-300 hover:bg-purple-50"
          >
            <span className="block text-sm font-medium">{row.title}</span>
            {row.subtitle ? (
              <span className="mt-1 block text-xs text-gray-600">{row.subtitle}</span>
            ) : null}
          </a>
        ))}
      </section>
    </main>
  );
}
