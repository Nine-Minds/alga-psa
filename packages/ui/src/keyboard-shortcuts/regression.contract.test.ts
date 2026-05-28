/* @vitest-environment node */
/* @behavioralCoverage packages/ui/src/keyboard-shortcuts/gap-hardening.behavior.test.tsx */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../..');

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

describe('keyboard shortcuts final regression contract', () => {
  it('keeps migrated legacy window/document shortcut listeners removed after replacement actions exist', () => {
    const migratedFiles = [
      'server/src/components/search/SearchPalette.tsx',
      'server/src/components/layout/DefaultLayout.tsx',
      'packages/assets/src/components/AssetDashboardClient.tsx',
      'server/src/context/DrawerContext.tsx',
      'packages/ui/src/context/DrawerContext.tsx',
      'packages/tickets/src/components/ticket/TicketNavigation.tsx',
      'packages/billing/src/components/invoice-designer/hooks/useDesignerShortcuts.ts',
    ];

    for (const relativePath of migratedFiles) {
      const source = read(relativePath);
      expect(source, relativePath).toMatch(/use(?:Catalog)?Shortcut/);
      expect(source, relativePath).not.toContain("window.addEventListener('keydown'");
      expect(source, relativePath).not.toContain('window.addEventListener("keydown"');
      expect(source, relativePath).not.toContain("document.addEventListener('keydown'");
      expect(source, relativePath).not.toContain('document.addEventListener("keydown"');
    }
  });

  it('leaves component-local widget key handling in the owning widgets', () => {
    const widgets = [
      'packages/ui/src/components/DatePicker.tsx',
      'packages/ui/src/components/SearchableSelect.tsx',
      'packages/ui/src/components/AsyncSearchableSelect.tsx',
      'packages/ui/src/components/tags/TagInput.tsx',
      'packages/ui/src/components/tags/TagInputInline.tsx',
    ];

    for (const relativePath of widgets) {
      const source = read(relativePath);
      expect(source, relativePath).toContain('onKeyDown');
      expect(source, relativePath).not.toContain('useShortcutAction');
      expect(source, relativePath).not.toContain('useShortcutScope');
    }

    expect(read('packages/ui/src/components/SearchableSelect.tsx')).toContain('role="combobox"');
    expect(read('packages/ui/src/components/AsyncSearchableSelect.tsx')).toContain('role="combobox"');
  });

  it('keeps platform-sensitive shortcut rendering client-only and SSR-safe', () => {
    for (const relativePath of [
      'packages/ui/src/keyboard-shortcuts/provider.tsx',
      'packages/ui/src/keyboard-shortcuts/display.tsx',
      'packages/ui/src/keyboard-shortcuts/ShortcutHelpDialog.tsx',
      'packages/ui/src/keyboard-shortcuts/escape.tsx',
      'packages/ui/src/keyboard-shortcuts/platform.ts',
    ]) {
      expect(read(relativePath).trimStart(), relativePath).toMatch(/^'use client';/);
    }

    const platformSource = read('packages/ui/src/keyboard-shortcuts/platform.ts');
    expect(platformSource).toContain("if (typeof window === 'undefined' || typeof navigator === 'undefined')");
    expect(platformSource).toContain('return null;');
    expect(platformSource.indexOf('navigator as Navigator')).toBeGreaterThan(platformSource.indexOf("typeof navigator === 'undefined'"));
  });
});
