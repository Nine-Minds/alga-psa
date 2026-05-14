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
});
