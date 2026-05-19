/* @vitest-environment node */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../..');

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

describe('MSP global shortcut migration contract', () => {
  it('mounts KeyboardShortcutsProvider in the MSP layout around both product shells', () => {
    const source = read('server/src/app/msp/MspLayoutClient.tsx');
    expect(source).toContain("import { KeyboardShortcutsProvider } from '@alga-psa/ui/keyboard-shortcuts'");
    expect(source).toContain('<KeyboardShortcutsProvider routeKey={pathname ?? \'/msp\'}>');
    expect(source.indexOf('<KeyboardShortcutsProvider')).toBeLessThan(source.indexOf('<AlgaDeskMspShell'));
    expect(source.indexOf('<KeyboardShortcutsProvider')).toBeLessThan(source.indexOf('<DefaultLayout'));
    expect(source).toContain('isOnboardingPage ? children');
  });

  it('migrates global search to a registered action and removes its window listener', () => {
    const source = read('server/src/components/search/SearchPalette.tsx');
    expect(source).toContain("id: 'global.search'");
    expect(source).toContain("defaultBindings: ['mod+k']");
    expect(source).toContain('useShortcutAction(searchShortcut)');
    expect(source).not.toContain("window.addEventListener('keydown'");
  });

  it('migrates AI, help, and quick-create global actions out of DefaultLayout window keydown handling', () => {
    const source = read('server/src/components/layout/DefaultLayout.tsx');
    expect(source).toContain("id: 'global.toggleChat'");
    expect(source).toContain("defaultBindings: ['mod+l']");
    expect(source).toContain("id: 'ai.quickAsk'");
    expect(source).toContain("defaultBindings: ['mod+ArrowUp']");
    expect(source).toContain("id: 'global.openShortcuts'");
    expect(source).toContain("defaultBindings: ['?']");
    expect(source).toContain("id: 'global.quickCreate'");
    expect(source).toContain("defaultBindings: ['c']");
    expect(source).toContain('<QuickCreateDialog');
    expect(source).not.toContain("window.addEventListener('keydown', handleKeyDown)");
  });

  it('rescopes the asset command palette away from mod+k', () => {
    const source = read('packages/assets/src/components/AssetDashboardClient.tsx');
    expect(source).toContain("id: 'assets.commandPalette'");
    expect(source).toContain("defaultBindings: ['mod+shift+k']");
    expect(source).toContain('useShortcutAction(assetCommandPaletteShortcut)');
    expect(source).not.toContain("event.key.toLowerCase() === 'k'");
    expect(source).not.toContain("window.addEventListener('keydown', handleKeyDown)");
  });

  it('keeps mod+k assigned only to global.search in the shortcut catalog', () => {
    const source = read('packages/ui/src/keyboard-shortcuts/catalog.ts');
    expect(source).toContain("entry('global.search', 'global', 'global', ['mod+k'])");
    expect(source).toContain("entry('assets.commandPalette', 'assets', 'page', ['mod+shift+k'])");
    expect(source).not.toContain("entry('assets.commandPalette', 'assets', 'page', ['mod+k'])");
  });
});
