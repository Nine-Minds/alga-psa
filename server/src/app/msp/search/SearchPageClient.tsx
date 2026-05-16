'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Clock, Search } from 'lucide-react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Input } from '@alga-psa/ui/components/Input';
import ViewSwitcher, { type ViewSwitcherOption } from '@alga-psa/ui/components/ViewSwitcher';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

import type { SearchAppResult } from '@/lib/actions/searchActions';
import type { SearchObjectType } from '@alga-psa/types';

function toDomIdPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function humanizeObjectType(value: string): string {
  const normalized = value.replace(/_/g, ' ').trim();
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : value;
}

interface SearchPageClientProps {
  initialQuery: string;
  initialType?: string;
  initialCursor?: string;
  initialCursorStack: Array<string | null>;
  initialSort: 'relevance' | 'recent';
  initialResult: SearchAppResult;
  registeredTypes: SearchObjectType[];
}

type SearchSort = 'relevance' | 'recent';

export default function SearchPageClient({
  initialQuery,
  initialType,
  initialCursor,
  initialCursorStack,
  initialSort,
  initialResult,
  registeredTypes,
}: SearchPageClientProps): React.JSX.Element {
  const { t } = useTranslation('msp/core');
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState(initialQuery);
  const activeType = initialType && initialType !== 'all' ? initialType : 'all';
  const isUpdatingQuery = query.trim() !== initialQuery;
  const previousInitialQueryRef = useRef(initialQuery);

  useEffect(() => {
    const previous = previousInitialQueryRef.current;
    if (previous === initialQuery) {
      return;
    }
    previousInitialQueryRef.current = initialQuery;
    setQuery((current) => (current === previous ? initialQuery : current));
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

  const buildFilterUrl = (type: string) => {
    const params = new URLSearchParams();
    if (initialQuery) {
      params.set('q', initialQuery);
    }
    if (type !== 'all') {
      params.set('type', type);
    }
    if (initialSort !== 'relevance') {
      params.set('sort', initialSort);
    }

    return params.toString() ? `${pathname}?${params.toString()}` : pathname;
  };

  const appendCursorState = (
    params: URLSearchParams,
    cursor: string | null | undefined,
    cursorStack: Array<string | null>,
  ) => {
    if (cursor) {
      params.set('cursor', cursor);
    }
    if (cursorStack.length > 0) {
      params.set('cursorStack', cursorStack.map((value) => value ?? '').join('.'));
    }
  };

  const buildPageUrl = (cursor: string | null | undefined, cursorStack: Array<string | null>) => {
    const params = new URLSearchParams();
    if (initialQuery) {
      params.set('q', initialQuery);
    }
    if (activeType !== 'all') {
      params.set('type', activeType);
    }
    if (initialSort !== 'relevance') {
      params.set('sort', initialSort);
    }
    appendCursorState(params, cursor, cursorStack);

    return params.toString() ? `${pathname}?${params.toString()}` : pathname;
  };

  const buildSortUrl = (sort: 'relevance' | 'recent') => {
    const params = new URLSearchParams();
    if (initialQuery) {
      params.set('q', initialQuery);
    }
    if (activeType !== 'all') {
      params.set('type', activeType);
    }
    if (sort !== 'relevance') {
      params.set('sort', sort);
    }

    return params.toString() ? `${pathname}?${params.toString()}` : pathname;
  };

  const sortOptions: ViewSwitcherOption<SearchSort>[] = [
    {
      value: 'relevance',
      label: t('search.sort.relevance'),
      icon: Search,
      id: 'app-search-sort-relevance',
    },
    {
      value: 'recent',
      label: t('search.sort.recent'),
      icon: Clock,
      id: 'app-search-sort-recent',
    },
  ];

  const handleSortChange = (sort: SearchSort) => {
    router.push(buildSortUrl(sort));
  };

  const submitQuery = () => {
    const normalizedQuery = query.trim();
    const params = new URLSearchParams();
    if (normalizedQuery) {
      params.set('q', normalizedQuery);
    }
    if (activeType !== 'all') {
      params.set('type', activeType);
    }
    if (initialSort !== 'relevance') {
      params.set('sort', initialSort);
    }

    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
  };

  const handleSearchInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitQuery();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setQuery(initialQuery);
      event.currentTarget.blur();
    }
  };

  const typeEntries = registeredTypes.map((type) => [
    type,
    initialResult.groups[type] ?? 0,
  ] as const);

  const filterLabel = (type: SearchObjectType) =>
    t(`search.filters.${type}`, { defaultValue: humanizeObjectType(type) });

  const groupLabel = (type: SearchObjectType) =>
    t(`search.groups.${type}`, { defaultValue: humanizeObjectType(type) });

  const renderResultRow = (row: SearchAppResult['results'][number]) => (
    <a
      key={`${row.type}-${row.id}`}
      id={`app-search-result-row-${toDomIdPart(row.type)}-${toDomIdPart(row.id)}`}
      href={row.url}
      className="block rounded-md border border-gray-200 bg-white px-4 py-3 text-gray-900 hover:border-primary-300 hover:bg-primary-50"
    >
      <span className="flex items-start justify-between gap-3">
        <span className="min-w-0 text-sm font-medium">{row.title}</span>
        <Badge variant="default-muted" size="sm" className="shrink-0">
          {groupLabel(row.type)}
        </Badge>
      </span>
      {row.subtitle ? (
        <span className="mt-1 block text-xs text-gray-600">{row.subtitle}</span>
      ) : null}
    </a>
  );

  const groupedSections = typeEntries
    .map(([type, count]) => ({
      type,
      count,
      rows: initialResult.results.filter((row) => row.type === type).slice(0, 10),
    }))
    .filter((section) => section.rows.length > 0);
  const previousCursor = initialCursorStack[initialCursorStack.length - 1];
  const previousCursorStack = initialCursorStack.slice(0, -1);
  const nextCursorStack = [...initialCursorStack, initialCursor ?? null];
  const showEmptyState = !isUpdatingQuery && initialQuery.length > 0 && initialResult.results.length === 0;
  const skeletonRows = Array.from({ length: 5 }, (_, index) => index);

  return (
    <main
      id="app-search-page"
      role="region"
      aria-label={t('search.resultsRegionLabel')}
      className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-6"
      data-search-sort={initialSort}
      data-search-cursor={initialCursor}
    >
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">
          {t('search.pageTitle')}
        </h1>
        <div className="relative mt-4 max-w-2xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" aria-hidden="true" />
          <Input
            id="app-search-page-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleSearchInputKeyDown}
            placeholder={t('search.placeholder')}
            containerClassName="mb-0"
            className="pl-9"
            size="lg"
          />
        </div>
        <p className="mt-3 text-sm text-gray-600">
          {initialQuery
            ? t('search.resultSummary', {
              count: initialResult.totalCount,
              query: initialQuery,
            })
            : t('search.helperText')}
        </p>
      </header>

      <div className="flex flex-col gap-3">
        <nav className="flex flex-wrap gap-2" aria-label={t('search.filtersLabel')}>
          <a
            id="app-search-filter-chip-all"
            href={buildFilterUrl('all')}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
              activeType === 'all'
                ? 'border-primary-500 bg-primary-50 text-primary-800'
                : 'border-gray-300 bg-white text-gray-700 hover:border-primary-300'
            }`}
          >
            <span>{t('search.filters.all')}</span>
            <Badge variant={activeType === 'all' ? 'primary' : 'default-muted'} size="sm">
              {initialResult.totalCount}
            </Badge>
          </a>
          {typeEntries.map(([type, count]) => (
            <a
              key={type}
              id={`app-search-filter-chip-${toDomIdPart(type)}`}
              href={buildFilterUrl(type)}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
                activeType === type
                  ? 'border-primary-500 bg-primary-50 text-primary-800'
                  : 'border-gray-300 bg-white text-gray-700 hover:border-primary-300'
              }`}
            >
              <span>
                {filterLabel(type)}
              </span>
              <Badge variant={activeType === type ? 'primary' : 'default-muted'} size="sm">
                {count}
              </Badge>
            </a>
          ))}
        </nav>

        <ViewSwitcher<SearchSort>
          currentView={initialSort}
          onChange={handleSortChange}
          options={sortOptions}
          className="w-fit bg-white"
          aria-label={t('search.sortLabel')}
        />
      </div>

      {isUpdatingQuery ? (
        <section className="space-y-2" aria-label={t('search.loading')}>
          {skeletonRows.map((index) => (
            <div key={index} className="animate-pulse rounded-md border border-gray-200 bg-white px-4 py-3">
              <div className="h-4 w-2/3 rounded bg-gray-200" />
              <div className="mt-2 h-3 w-1/3 rounded bg-gray-100" />
            </div>
          ))}
        </section>
      ) : showEmptyState ? (
        <section className="rounded-md border border-dashed border-gray-300 bg-white px-6 py-8 text-center">
          <h2 className="text-base font-semibold text-gray-900">
            {t('search.noResults', {
              query: initialQuery,
            })}
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            {activeType === 'all'
              ? t('search.emptyBroadenQuery')
              : t('search.emptyRemoveFilter')}
          </p>
          {activeType !== 'all' ? (
            <a
              id="app-search-empty-clear-filter"
              href={buildFilterUrl('all')}
              className="mt-4 inline-flex rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:border-primary-300 hover:text-primary-700"
            >
              {t('search.filters.all')}
            </a>
          ) : null}
        </section>
      ) : activeType === 'all' ? (
        <section className="space-y-6">
          {groupedSections.map((section) => (
            <div key={section.type} className="space-y-2">
              <h2 className="text-sm font-semibold text-gray-700">
                {groupLabel(section.type)}
                <Badge variant="default-muted" size="sm" className="ml-2 align-middle">
                  {section.count}
                </Badge>
              </h2>
              <div className="space-y-2">
                {section.rows.map(renderResultRow)}
              </div>
            </div>
          ))}
        </section>
      ) : (
        <section className="space-y-2">
          {initialResult.results.map(renderResultRow)}
        </section>
      )}

      {!isUpdatingQuery && !showEmptyState && (initialCursor || initialResult.nextCursor) && (
        <nav className="flex items-center justify-between border-t border-gray-200 pt-4" aria-label={t('search.paginationLabel')}>
          {initialCursor ? (
            <a
              id="app-search-pagination-prev"
              href={buildPageUrl(previousCursor, previousCursorStack)}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:border-primary-300 hover:text-primary-700"
            >
              {t('search.pagination.previous')}
            </a>
          ) : (
            <span />
          )}
          {initialResult.nextCursor ? (
            <a
              id="app-search-pagination-next"
              href={buildPageUrl(initialResult.nextCursor, nextCursorStack)}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:border-primary-300 hover:text-primary-700"
            >
              {t('search.pagination.next')}
            </a>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
