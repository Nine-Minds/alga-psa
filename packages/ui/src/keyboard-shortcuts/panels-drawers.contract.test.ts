/* @vitest-environment node */
/* @behavioralCoverage packages/ui/src/keyboard-shortcuts/gap-hardening.behavior.test.tsx */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OPTIONAL_ALTERNATE_BINDINGS, getShortcutCatalogEntry } from './catalog';

const repoRoot = resolve(__dirname, '../../../..');

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

describe('panel, drawer, and record shortcut migration contract', () => {
  it.each([
    'server/src/context/DrawerContext.tsx',
    'packages/ui/src/context/DrawerContext.tsx',
  ])('migrates %s drawer key handling to registered panel actions', (relativePath) => {
    const source = read(relativePath);
    expect(source).toContain("useShortcutScope('panel', state.isOpen)");
    expect(source).toContain("useCatalogShortcut('panel.close'");
    expect(source).toContain("useCatalogShortcut('drawer.historyBack'");
    expect(source).toContain("useCatalogShortcut('drawer.historyForward'");
    expect(source).not.toContain("window.addEventListener('keydown', handleKeyDown)");
  });

  it('defines record navigation defaults as brackets with Alt+Arrow only as optional alternates', () => {
    expect(getShortcutCatalogEntry('record.previous')?.defaultBindings).toEqual(['[']);
    expect(getShortcutCatalogEntry('record.next')?.defaultBindings).toEqual([']']);
    expect(OPTIONAL_ALTERNATE_BINDINGS['record.previous']).toEqual(['alt+ArrowLeft']);
    expect(OPTIONAL_ALTERNATE_BINDINGS['record.next']).toEqual(['alt+ArrowRight']);
  });

  it('migrates TicketNavigation adjacent-record shortcuts to record.previous/record.next', () => {
    const source = read('packages/tickets/src/components/ticket/TicketNavigation.tsx');
    expect(source).toContain("useCatalogShortcut('record.previous'");
    expect(source).toContain("useCatalogShortcut('record.next'");
    expect(source).not.toContain("window.addEventListener('keydown'");
    expect(source).not.toContain('e.altKey && e.key ===');
  });
});
