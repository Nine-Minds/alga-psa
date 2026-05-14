'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

import type { SearchAppResult } from '@/lib/actions/searchActions';

interface SearchPageClientProps {
  initialQuery: string;
  initialType?: string;
  initialCursor?: string;
  initialSort: 'relevance' | 'recent';
  initialResult: SearchAppResult;
}

export default function SearchPageClient({
  initialQuery,
  initialType,
  initialCursor,
  initialSort,
  initialResult,
}: SearchPageClientProps): React.JSX.Element {
  const { t } = useTranslation('msp/core');
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState(initialQuery);

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  const stableUrlState = useMemo(() => ({
    query: initialQuery,
    type: initialType,
    cursor: initialCursor,
    sort: initialSort,
  }), [initialQuery, initialType, initialCursor, initialSort]);

  useEffect(() => {
    const normalizedQuery = query.trim();
    if (normalizedQuery === stableUrlState.query) {
      return;
    }

    const timer = window.setTimeout(() => {
      const nextParams = new URLSearchParams();
      if (normalizedQuery) {
        nextParams.set('q', normalizedQuery);
      }
      if (stableUrlState.type && stableUrlState.type !== 'all') {
        nextParams.set('type', stableUrlState.type);
      }
      if (stableUrlState.sort !== 'relevance') {
        nextParams.set('sort', stableUrlState.sort);
      }

      const nextUrl = nextParams.toString()
        ? `${pathname}?${nextParams.toString()}`
        : pathname;
      router.replace(nextUrl, { scroll: false });
    }, 200);

    return () => window.clearTimeout(timer);
  }, [pathname, query, router, stableUrlState]);

  return (
    <main
      id="app-search-page"
      role="region"
      aria-label={t('search.resultsRegionLabel', { defaultValue: 'Search results' })}
      className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-6"
      data-search-sort={initialSort}
      data-search-cursor={initialCursor}
    >
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">
          {t('search.pageTitle', { defaultValue: 'Search' })}
        </h1>
        <div className="relative mt-4 max-w-2xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" aria-hidden="true" />
          <input
            id="app-search-page-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('search.placeholder', { defaultValue: 'Search' })}
            className="h-11 w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20"
          />
        </div>
        <p className="mt-3 text-sm text-gray-600">
          {initialQuery
            ? t('search.resultSummary', {
              count: initialResult.totalCount,
              query: initialQuery,
              defaultValue: `${initialResult.totalCount} results for "${initialQuery}"`,
            })
            : t('search.helperText', { defaultValue: 'Search across the workspace.' })}
        </p>
      </header>

      <section className="space-y-2">
        {initialResult.results.map((row) => (
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
