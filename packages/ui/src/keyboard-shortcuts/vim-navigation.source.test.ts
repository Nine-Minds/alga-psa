/* @vitest-environment node */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../..');

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

describe('vim navigation shortcut wiring', () => {
  it('mounts the shared navigation layer in both MSP shells via the global shortcut layer', () => {
    const layer = read('server/src/components/layout/GlobalShortcutLayer.tsx');

    expect(layer).toContain("import VimNavigationLayer from './VimNavigationLayer'");
    expect(layer).toContain('<VimNavigationLayer onOpenHelp={openHelp} />');
    expect(read('server/src/components/layout/DefaultLayout.tsx')).toContain('<GlobalShortcutLayer />');
    expect(read('server/src/components/layout/AlgaDeskMspShell.tsx')).toContain('<GlobalShortcutLayer navAssetsEnabled={false} />');
  });

  it('registers vim-style scroll, table, hint, macro, and navigation actions', () => {
    const source = read('server/src/components/layout/VimNavigationLayer.tsx');

    expect(source).toContain('useCatalogShortcut("scroll.halfDown"');
    expect(source).toContain('useCatalogShortcut("scroll.fullUp"');
    expect(source).toContain('useCatalogShortcut("table.nextRow"');
    expect(source).toContain('useCatalogShortcut("table.toggleRow"');
    expect(source).toContain('useCatalogShortcut("linkhints.show"');
    expect(source).toContain('useCatalogShortcut("macro.record"');
    expect(source).toContain('useCatalogShortcut("repeat.lastAction"');
    expect(source).toContain('useCatalogShortcut("navigation.goDashboard"');
    expect(source).toContain('useCatalogShortcut("navigation.goSearch"');
    expect(source).toContain('useCatalogShortcut("navigation.backToParent"');
  });

  it('uses datatable checkboxes and row links instead of storing a parallel selection model', () => {
    const source = read('server/src/components/layout/VimNavigationLayer.tsx');

    expect(source).toContain("input[type='checkbox']:not([disabled])");
    expect(source).toContain("row.querySelectorAll<HTMLElement>(\"a[href], button:not([disabled])");
    expect(source).toContain('clickCheckbox(checkbox)');
    expect(source).toContain('data-vim-active-row');
  });

  it('activates the shared back navigation button when present', () => {
    const source = read('server/src/components/layout/VimNavigationLayer.tsx');

    expect(source).toContain('back-navigation-button');
    expect(source).toContain('clickBackNavigation');
  });
});
