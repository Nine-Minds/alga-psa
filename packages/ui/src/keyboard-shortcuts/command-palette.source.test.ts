/* @vitest-environment node */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../..');

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

describe('command palette application wiring', () => {
  it('keeps mod+k on sidebar search and opens the command palette from its own shortcut', () => {
    const source = read('server/src/components/search/SearchPalette.tsx');

    expect(source).toContain("useCatalogShortcut('global.search'");
    expect(source).toContain('focusSearchInput');
    expect(source).toContain("useCatalogShortcut('global.commandPalette'");
    expect(source).toContain('setIsCommandPaletteOpen(true)');
    expect(source).toContain('<CommandPalette open={isCommandPaletteOpen}');
  });

  it('merges navigation and registered action providers and gates record search behind fulltext mode', () => {
    const source = read('server/src/components/search/CommandPalette.tsx');

    expect(source).toContain('navigationSections');
    expect(source).toContain('bottomMenuItems');
    expect(source).toContain('SHORTCUT_ACTION_CATALOG');
    // Record search now lives in the palette's dedicated fulltext mode rather
    // than being duplicated into the default command list.
    expect(source).toContain('searchAppTypeaheadAction');
    expect(source).toContain("mode !== 'fulltext'");
    expect(source).toContain('localStorage');
  });

  it('exposes the accessible combobox/listbox interaction model and syntax help', () => {
    const source = read('server/src/components/search/CommandPalette.tsx');
    expect(source).toContain('role="combobox"');
    expect(source).toContain('role="listbox"');
    expect(source).toContain('aria-activedescendant');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('commandPalette.syntax.inlineHelp');
  });
});
