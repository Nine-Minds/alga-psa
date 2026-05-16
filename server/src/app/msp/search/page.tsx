import {
  searchAppAction,
  type SearchAppResult,
} from '@/lib/actions/searchActions';
import { registeredObjectTypes } from '@/lib/search';
import { SEARCH_OBJECT_TYPES, type SearchObjectType } from '@alga-psa/types';
import SearchPageClient from './SearchPageClient';

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

function parseTypeFilter(
  value: string | undefined,
  registeredTypes: SearchObjectType[],
): SearchObjectType[] | undefined {
  if (!value || value === 'all') {
    return undefined;
  }

  return registeredTypes.includes(value as SearchObjectType)
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
  const registeredTypes = registeredObjectTypes()
    .filter((objectType): objectType is SearchObjectType =>
      (SEARCH_OBJECT_TYPES as readonly string[]).includes(objectType),
    );
  const activeType = parseTypeFilter(type, registeredTypes)?.[0];
  const result = query.length > 0
    ? await searchAppAction({
      query,
      types: activeType ? [activeType] : undefined,
      cursor,
      limit: 25,
      sort,
    })
    : emptyResult;

  return (
    <SearchPageClient
      initialQuery={query}
      initialType={activeType ?? (type === 'all' ? 'all' : undefined)}
      initialCursor={cursor}
      initialCursorStack={cursorStack}
      initialSort={sort}
      initialResult={result}
      registeredTypes={registeredTypes}
    />
  );
}
