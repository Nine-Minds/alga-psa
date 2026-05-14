import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('app-wide search UI contracts', () => {
  it('T122 renders SearchPalette at the top of the MSP sidebar', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/layout/Sidebar.tsx'), 'utf8');
    const searchIndex = source.indexOf('<SearchPalette');
    const navIndex = source.indexOf('<nav className=');

    expect(source).toContain("import SearchPalette from '@/components/search/SearchPalette'");
    expect(searchIndex).toBeGreaterThan(0);
    expect(navIndex).toBeGreaterThan(searchIndex);
  });

  it('T123 binds Cmd+K and Ctrl+K to focus the SearchPalette input', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/search/SearchPalette.tsx'), 'utf8');

    expect(source).toContain("event.key.toLowerCase() !== 'k'");
    expect(source).toContain('!event.metaKey && !event.ctrlKey');
    expect(source).toContain('inputRef.current?.focus()');
  });

  it('T124 renders up to five typeahead results as native anchors', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/search/SearchPalette.tsx'), 'utf8');

    expect(source).toContain('const visibleResults = results.slice(0, 5)');
    expect(source).toContain('asChild');
    expect(source).toContain('href={result.url}');
  });

  it('T125 preserves browser new-tab behavior for typeahead rows', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/search/SearchPalette.tsx'), 'utf8');
    const resultAnchorBlock = source.slice(
      source.indexOf('href={result.url}'),
      source.indexOf('<span className="block truncate">{result.title}</span>'),
    );

    expect(resultAnchorBlock).not.toContain('onClick=');
    expect(resultAnchorBlock).not.toContain('preventDefault');
  });

  it('T126 renders the i18n see-all typeahead row with the encoded results URL', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/search/SearchPalette.tsx'), 'utf8');

    expect(source).toContain('const seeAllUrl = `/msp/search?q=${encodeURIComponent(trimmedQuery)}`');
    expect(source).toContain('id="app-search-option-see-all-results"');
    expect(source).toContain('href={seeAllUrl}');
    expect(source).toContain("t('search.seeAllResults'");
    expect(source).toContain('count: totalCount');
  });

  it('T127 keeps typeahead closed until the query has at least two characters', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/search/SearchPalette.tsx'), 'utf8');

    expect(source).toContain('const isOpen = !collapsed && trimmedQuery.length >= 2 && !isDismissed');
    expect(source).toContain('if (trimmedQuery.length < 2)');
    expect(source).toContain('setResults([])');
    expect(source).toContain('setTotalCount(0)');
  });

  it('T128 resolves /msp/search results in the server page before rendering the client shell', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/msp/search/page.tsx'), 'utf8');

    expect(source).toContain("export const dynamic = 'force-dynamic'");
    expect(source).toContain("const query = firstParam(params.q)?.trim() ?? ''");
    expect(source).toContain('query.length > 0');
    expect(source).toContain('await searchAppAction({');
    expect(source).toContain('initialResult={result}');
  });

  it('T129 debounces results-page input changes into router.replace URL updates', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/msp/search/SearchPageClient.tsx'), 'utf8');

    expect(source).toContain('const timer = window.setTimeout(() => {');
    expect(source).toContain('}, 200)');
    expect(source).toContain('nextParams.set(\'q\', normalizedQuery)');
    expect(source).toContain('router.replace(nextUrl, { scroll: false })');
    expect(source).toContain('return () => window.clearTimeout(timer)');
  });

  it('T130 restores deep-linked search page URL state on cold render', () => {
    const pageSource = readFileSync(resolve(process.cwd(), 'src/app/msp/search/page.tsx'), 'utf8');
    const clientSource = readFileSync(resolve(process.cwd(), 'src/app/msp/search/SearchPageClient.tsx'), 'utf8');

    expect(pageSource).toContain('const type = firstParam(params.type)');
    expect(pageSource).toContain('const cursor = firstParam(params.cursor)');
    expect(pageSource).toContain("const sort = firstParam(params.sort) === 'recent' ? 'recent' : 'relevance'");
    expect(pageSource).toContain('initialQuery={query}');
    expect(pageSource).toContain('initialType={activeType ?? (type === \'all\' ? \'all\' : undefined)}');
    expect(pageSource).toContain('initialCursor={cursor}');
    expect(pageSource).toContain('initialSort={sort}');
    expect(clientSource).toContain('const [query, setQuery] = useState(initialQuery)');
    expect(clientSource).toContain("const activeType = initialType && initialType !== 'all' ? initialType : 'all'");
  });

  it('T131 renders filter chip counts from SearchAppResult groups', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/msp/search/SearchPageClient.tsx'), 'utf8');

    expect(source).toContain('initialResult.groups[type] ?? 0');
    expect(source).toContain('id="app-search-filter-chip-all"');
    expect(source).toContain('{initialResult.totalCount}');
    expect(source).toContain('id={`app-search-filter-chip-${toDomIdPart(type)}`}');
    expect(source).toContain('{count}');
  });

  it('T132 renders All results as grouped sections capped at ten rows per type', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/msp/search/SearchPageClient.tsx'), 'utf8');

    expect(source).toContain('initialResult.results.filter((row) => row.type === type).slice(0, 10)');
    expect(source).toContain("activeType === 'all' ? (");
    expect(source).toContain('groupedSections.map((section) =>');
    expect(source).toContain('{section.rows.map(renderResultRow)}');
  });

  it('T133 requests and renders a flat list for a single type filter', () => {
    const pageSource = readFileSync(resolve(process.cwd(), 'src/app/msp/search/page.tsx'), 'utf8');
    const clientSource = readFileSync(resolve(process.cwd(), 'src/app/msp/search/SearchPageClient.tsx'), 'utf8');

    expect(pageSource).toContain('const activeType = parseTypeFilter(type, registeredTypes)?.[0]');
    expect(pageSource).toContain('types: activeType ? [activeType] : undefined');
    expect(clientSource).toContain('{initialResult.results.map(renderResultRow)}');
    expect(clientSource).toContain("activeType !== 'all'");
  });

  it('T134 wires next and previous cursor pagination without reusing the current page boundary', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/msp/search/SearchPageClient.tsx'), 'utf8');

    expect(source).toContain('const previousCursor = initialCursorStack[initialCursorStack.length - 1]');
    expect(source).toContain('const previousCursorStack = initialCursorStack.slice(0, -1)');
    expect(source).toContain('const nextCursorStack = [...initialCursorStack, initialCursor ?? null]');
    expect(source).toContain('href={buildPageUrl(previousCursor, previousCursorStack)}');
    expect(source).toContain('href={buildPageUrl(initialResult.nextCursor, nextCursorStack)}');
  });

  it('T135 renders an empty state that echoes the query and can clear a type filter', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/msp/search/SearchPageClient.tsx'), 'utf8');

    expect(source).toContain('const showEmptyState = !isUpdatingQuery && initialQuery.length > 0 && initialResult.results.length === 0');
    expect(source).toContain("t('search.noResults'");
    expect(source).toContain('query: initialQuery');
    expect(source).toContain("activeType === 'all'");
    expect(source).toContain("t('search.emptyRemoveFilter')");
    expect(source).toContain('id="app-search-empty-clear-filter"');
  });

  it('T136 renders skeleton rows while a results-page query update is pending', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/msp/search/SearchPageClient.tsx'), 'utf8');

    expect(source).toContain('const isUpdatingQuery = query.trim() !== initialQuery');
    expect(source).toContain('const skeletonRows = Array.from({ length: 5 }');
    expect(source).toContain('isUpdatingQuery ? (');
    expect(source).toContain('animate-pulse');
    expect(source).toContain("aria-label={t('search.loading')}");
  });

  it('T137 renders every results-page row as a native anchor with no click interception', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/msp/search/SearchPageClient.tsx'), 'utf8');
    const renderRowBlock = source.slice(
      source.indexOf('const renderResultRow ='),
      source.indexOf('const groupedSections ='),
    );

    expect(renderRowBlock).toContain('<a');
    expect(renderRowBlock).toContain('href={row.url}');
    expect(renderRowBlock).toContain('id={`app-search-result-row-${toDomIdPart(row.type)}-${toDomIdPart(row.id)}`}');
    expect(renderRowBlock).not.toContain('onClick=');
    expect(renderRowBlock).not.toContain('preventDefault');
  });

  it('T139 exposes ARIA combobox state on the sidebar search input', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/search/SearchPalette.tsx'), 'utf8');

    expect(source).toContain('role="combobox"');
    expect(source).toContain('aria-autocomplete="list"');
    expect(source).toContain('aria-expanded={isOpen}');
    expect(source).toContain('aria-controls="app-search-typeahead-list"');
    expect(source).toContain('aria-activedescendant={activeDescendantId}');
  });

  it('T140 moves the sidebar active option with arrows and returns Up from the first option to the input', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/search/SearchPalette.tsx'), 'utf8');

    expect(source).toContain("if (event.key === 'ArrowDown')");
    expect(source).toContain('setActiveIndex((current) => (current >= optionCount - 1 ? -1 : current + 1))');
    expect(source).toContain("if (event.key === 'ArrowUp')");
    expect(source).toContain('if (current === 0)');
    expect(source).toContain('return -1');
  });

  it('T141 closes the sidebar typeahead on Escape without blurring the input', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/search/SearchPalette.tsx'), 'utf8');
    const escapeBlock = source.slice(
      source.indexOf("if (event.key === 'Escape')"),
      source.indexOf("if (event.key === 'Enter')"),
    );

    expect(escapeBlock).toContain('event.preventDefault()');
    expect(escapeBlock).toContain('setResults([])');
    expect(escapeBlock).toContain('setTotalCount(0)');
    expect(escapeBlock).toContain('setActiveIndex(-1)');
    expect(escapeBlock).toContain('setIsDismissed(true)');
    expect(escapeBlock).not.toContain('blur()');
  });
});
