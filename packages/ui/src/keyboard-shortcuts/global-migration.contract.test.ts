/* @vitest-environment node */
/* @behavioralCoverage packages/ui/src/keyboard-shortcuts/gap-hardening.behavior.test.tsx */

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
    expect(source).toContain('<KeyboardShortcutsProvider');
    expect(source).toContain('routeKey={pathname ?? \'/msp\'}');
    expect(source).toContain('storage={shortcutPreference.storage}');
    expect(source).toContain('onConflict={');
    expect(source.indexOf('<KeyboardShortcutsProvider')).toBeLessThan(source.indexOf('<AlgaDeskMspShell'));
    expect(source.indexOf('<KeyboardShortcutsProvider')).toBeLessThan(source.indexOf('<DefaultLayout'));
    expect(source).toContain('isOnboardingPage ? children');
  });

  it('migrates global search to a registered action and removes its window listener', () => {
    const source = read('server/src/components/search/SearchPalette.tsx');
    expect(source).toContain("useCatalogShortcut('global.search'");
    expect(source).not.toContain("window.addEventListener('keydown'");
  });

  it('migrates AI, help, and quick-create global actions out of DefaultLayout window keydown handling', () => {
    const source = read('server/src/components/layout/DefaultLayout.tsx');
    const layer = read('server/src/components/layout/GlobalShortcutLayer.tsx');
    expect(source).toContain("useCatalogShortcut('global.toggleChat'");
    expect(source).toContain("useCatalogShortcut('ai.quickAsk'");
    expect(layer).toContain("useCatalogShortcut('global.openShortcuts'");
    expect(layer).toContain("useCatalogShortcut('global.quickCreate'");
    expect(layer).toContain("'global-quick-create-trigger'");
    expect(source).not.toContain("window.addEventListener('keydown', handleKeyDown)");
  });

  it('hosts the QuickCreateDialog through the Header picker', () => {
    const source = read('server/src/components/layout/Header.tsx');
    expect(source).toContain('id="global-quick-create-trigger"');
    expect(source).toContain('<QuickCreateDialog');
  });

  it('rescopes the asset command palette away from mod+k', () => {
    const source = read('packages/assets/src/components/AssetDashboardClient.tsx');
    expect(source).toContain("useCatalogShortcut('assets.commandPalette'");
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
