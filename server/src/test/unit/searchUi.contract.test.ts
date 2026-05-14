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
});
