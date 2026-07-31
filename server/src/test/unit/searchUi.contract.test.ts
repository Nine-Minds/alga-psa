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
    const catalogSource = readFileSync(
      resolve(process.cwd(), '../packages/ui/src/keyboard-shortcuts/catalog.ts'),
      'utf8',
    );

    // The Cmd+K / Ctrl+K binding now lives in the shared keyboard-shortcut catalog
    // ('mod' resolves to metaKey on macOS and ctrlKey elsewhere) and SearchPalette
    // subscribes to it via useCatalogShortcut to focus its input.
    expect(catalogSource).toContain("entry('global.search', 'global', 'global', ['mod+k'])");
    expect(source).toContain("useCatalogShortcut('global.search', focusSearchInput)");
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

  it('T142 navigates to the full search page when Enter is pressed with no active sidebar row', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/search/SearchPalette.tsx'), 'utf8');
    const navigateBlock = source.slice(
      source.indexOf('const navigateToActiveOption = () =>'),
      source.indexOf('const handleInputKeyDown ='),
    );
    const enterBlock = source.slice(
      source.indexOf("if (event.key === 'Enter')"),
      source.indexOf('const handleQueryChange ='),
    );

    expect(navigateBlock).toContain('window.location.assign(seeAllUrl)');
    expect(enterBlock).toContain('event.preventDefault()');
    expect(enterBlock).toContain('navigateToActiveOption()');
  });

  it('T143 navigates to the active row URL when Enter is pressed on a sidebar suggestion', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/search/SearchPalette.tsx'), 'utf8');
    const navigateBlock = source.slice(
      source.indexOf('const navigateToActiveOption = () =>'),
      source.indexOf('const handleInputKeyDown ='),
    );

    expect(navigateBlock).toContain('activeIndex >= 0 && activeIndex < visibleResults.length');
    expect(navigateBlock).toContain('window.location.assign(visibleResults[activeIndex].url)');
    expect(navigateBlock).toContain('return;');
  });

  it('T144 exposes stable app-search-input id on the sidebar input', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/search/SearchPalette.tsx'), 'utf8');

    expect(source).toContain('id="app-search-input"');
  });

  it('T145 uses stable kebab-case ids for search result rows', () => {
    const paletteSource = readFileSync(resolve(process.cwd(), 'src/components/search/SearchPalette.tsx'), 'utf8');
    const pageSource = readFileSync(resolve(process.cwd(), 'src/app/msp/search/SearchPageClient.tsx'), 'utf8');

    expect(paletteSource).toContain('function toDomIdPart(value: string): string');
    expect(paletteSource).toContain('data-result-row-id={`app-search-result-row-${toDomIdPart(result.type)}-${toDomIdPart(result.id)}`}');
    expect(pageSource).toContain('function toDomIdPart(value: string): string');
    expect(pageSource).toContain('id={`app-search-result-row-${toDomIdPart(row.type)}-${toDomIdPart(row.id)}`}');
  });

  it('T146 uses stable ids for every search filter chip', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/msp/search/SearchPageClient.tsx'), 'utf8');

    expect(source).toContain('id="app-search-filter-chip-all"');
    expect(source).toContain('id={`app-search-filter-chip-${toDomIdPart(type)}`}');
    expect(source).toContain('typeEntries.map(([type, count]) =>');
  });

  it('T161 sends sidebar Enter submissions to the shareable results URL', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/search/SearchPalette.tsx'), 'utf8');

    expect(source).toContain('const seeAllUrl = `/msp/search?q=${encodeURIComponent(trimmedQuery)}`');
    expect(source).toContain("if (event.key === 'Enter')");
    expect(source).toContain('navigateToActiveOption()');
    expect(source).toContain('window.location.assign(seeAllUrl)');
  });

  it('T162 keeps results-page rows native so new tabs preserve original URL state', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/msp/search/SearchPageClient.tsx'), 'utf8');
    const renderRowBlock = source.slice(
      source.indexOf('const renderResultRow ='),
      source.indexOf('const groupedSections ='),
    );

    expect(renderRowBlock).toContain('href={row.url}');
    expect(renderRowBlock).not.toContain('router.push');
    expect(renderRowBlock).not.toContain('onClick=');
    expect(source).toContain('const stableUrlState = useMemo(() => ({');
    expect(source).toContain('initialCursor');
    expect(source).toContain('initialSort');
  });

  it('T176 supports the complete keyboard-only search flow', () => {
    const paletteSource = readFileSync(resolve(process.cwd(), 'src/components/search/SearchPalette.tsx'), 'utf8');
    const pageSource = readFileSync(resolve(process.cwd(), 'src/app/msp/search/SearchPageClient.tsx'), 'utf8');

    expect(paletteSource).toContain('inputRef.current?.focus()');
    expect(paletteSource).toContain("if (event.key === 'ArrowDown')");
    expect(paletteSource).toContain("if (event.key === 'ArrowUp')");
    expect(paletteSource).toContain("if (event.key === 'Enter')");
    expect(paletteSource).toContain("if (event.key === 'Escape')");
    expect(paletteSource).toContain('window.location.assign(seeAllUrl)');
    expect(paletteSource).toContain('window.location.assign(visibleResults[activeIndex].url)');

    expect(pageSource).toContain('id="app-search-page-input"');
    expect(pageSource).toContain('router.replace(nextUrl, { scroll: false })');
    expect(pageSource).toContain('href={buildFilterUrl(\'all\')}');
    expect(pageSource).toContain('href={buildFilterUrl(type)}');
    expect(pageSource).toContain('href={buildPageUrl(previousCursor, previousCursorStack)}');
    expect(pageSource).toContain('href={buildPageUrl(initialResult.nextCursor, nextCursorStack)}');
    expect(pageSource).toContain('id="app-search-empty-clear-filter"');
  });

  it('T177 cold-opening a deep-linked search URL restores query, type, cursor, and sort', () => {
    const pageSource = readFileSync(resolve(process.cwd(), 'src/app/msp/search/page.tsx'), 'utf8');
    const clientSource = readFileSync(resolve(process.cwd(), 'src/app/msp/search/SearchPageClient.tsx'), 'utf8');

    expect(pageSource).toContain('const query = firstParam(params.q)?.trim() ?? \'\'');
    expect(pageSource).toContain('const type = firstParam(params.type)');
    expect(pageSource).toContain('const cursor = firstParam(params.cursor)');
    expect(pageSource).toContain("const sort = firstParam(params.sort) === 'recent' ? 'recent' : 'relevance'");
    expect(pageSource).toContain('types: activeType ? [activeType] : undefined');
    expect(pageSource).toContain('cursor,');
    expect(pageSource).toContain('sort');
    expect(pageSource).toContain('initialQuery={query}');
    expect(pageSource).toContain('initialCursor={cursor}');
    expect(pageSource).toContain('initialSort={sort}');

    expect(clientSource).toContain('const [query, setQuery] = useState(initialQuery)');
    expect(clientSource).toContain("const activeType = initialType && initialType !== 'all' ? initialType : 'all'");
    expect(clientSource).toContain('initialCursorStack');
    expect(clientSource).toContain('initialSort');
  });

  it('T191 SearchPalette has no obvious serious/critical axe violations by static contract', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/search/SearchPalette.tsx'), 'utf8');

    expect(source).toContain('aria-label={t(\'search.placeholder\')}');
    expect(source).toContain('aria-hidden="true"');
    expect(source).toContain('role="combobox"');
    expect(source).toContain('aria-autocomplete="list"');
    expect(source).toContain('aria-expanded={isOpen}');
    expect(source).toContain('aria-controls="app-search-typeahead-list"');
    expect(source).toContain('aria-activedescendant={activeDescendantId}');
    expect(source).toContain('id="app-search-typeahead-list"');
    expect(source).toContain('href={result.url}');
    expect(source).toContain('href={seeAllUrl}');
    expect(source).not.toContain('tabIndex={-1}');
  });

  it('T192 /msp/search has no obvious serious/critical axe violations by static contract', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/msp/search/SearchPageClient.tsx'), 'utf8');

    expect(source).toContain('role="region"');
    expect(source).toContain("aria-label={t('search.resultsRegionLabel')}");
    expect(source).toContain('aria-hidden="true"');
    expect(source).toContain('id="app-search-page-input"');
    expect(source).toContain("aria-label={t('search.filtersLabel')}");
    expect(source).toContain("aria-label={t('search.sortLabel')}");
    expect(source).toContain("aria-label={t('search.loading')}");
    expect(source).toContain("aria-label={t('search.paginationLabel')}");
    expect(source).toContain('href={row.url}');
    expect(source).toContain('href={buildFilterUrl(type)}');
    expect(source).toContain('<ViewSwitcher<SearchSort>');
    expect(source).toContain('router.push(buildSortUrl(sort))');
    expect(source).not.toContain('role="button"');
  });

  it('T203 renders filter chips from registeredObjectTypes plus All', () => {
    const pageSource = readFileSync(resolve(process.cwd(), 'src/app/msp/search/page.tsx'), 'utf8');
    const clientSource = readFileSync(resolve(process.cwd(), 'src/app/msp/search/SearchPageClient.tsx'), 'utf8');

    expect(pageSource).toContain('const registeredTypes = registeredObjectTypes()');
    expect(pageSource).toContain('registeredTypes={registeredTypes}');
    expect(clientSource).toContain('const typeEntries = registeredTypes.map((type) => [');
    expect(clientSource).toContain('id="app-search-filter-chip-all"');
    expect(clientSource).toContain('typeEntries.map(([type, count]) =>');
    expect(clientSource).toContain('id={`app-search-filter-chip-${toDomIdPart(type)}`}');
  });

  it('T204 falls back to humanized object type labels when i18n keys are missing', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/msp/search/SearchPageClient.tsx'), 'utf8');

    expect(source).toContain('function humanizeObjectType(value: string): string');
    expect(source).toContain("value.replace(/_/g, ' ').trim()");
    expect(source).toContain("t(`search.filters.${type}`, { defaultValue: humanizeObjectType(type) })");
    expect(source).toContain("t(`search.groups.${type}`, { defaultValue: humanizeObjectType(type) })");

    const humanize = (value: string) => {
      const normalized = value.replace(/_/g, ' ').trim();
      return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : value;
    };

    expect(humanize('service_request_submission')).toBe('Service request submission');
  });
});
