/* @vitest-environment node */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../..');

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

describe('gap hardening source smoke', () => {
  it('keeps migrated app registrations catalog-derived', () => {
    const files = [
      'server/src/components/search/SearchPalette.tsx',
      'server/src/components/layout/DefaultLayout.tsx',
      'server/src/context/DrawerContext.tsx',
      'packages/ui/src/context/DrawerContext.tsx',
      'packages/tickets/src/components/ticket/TicketNavigation.tsx',
      'packages/assets/src/components/AssetDashboardClient.tsx',
      'packages/billing/src/components/invoice-designer/hooks/useDesignerShortcuts.ts',
    ];

    for (const relativePath of files) {
      const source = read(relativePath);
      expect(source, relativePath).toContain('useCatalogShortcut');
      expect(source, relativePath).not.toContain('defaultBindings:');
      expect(source, relativePath).not.toContain('labelKey:');
      expect(source, relativePath).not.toContain('groupKey:');
      expect(source, relativePath).not.toContain('priority: 60');
    }
  });

  it('does not make DefaultLayout an always-active shortcut region', () => {
    const defaultLayout = read('server/src/components/layout/DefaultLayout.tsx');
    expect(defaultLayout).not.toContain('useShortcutActiveRegion(true)');
    expect(defaultLayout).not.toContain('useShortcutActiveRegion');
  });

  it('applies active regions to real list surfaces instead of the whole shell', () => {
    for (const relativePath of [
      'packages/tickets/src/components/TicketingDashboard.tsx',
      'packages/clients/src/components/clients/Clients.tsx',
      'packages/clients/src/components/contacts/Contacts.tsx',
      'packages/clients/src/components/interactions/InteractionsFeed.tsx',
      'packages/projects/src/components/Projects.tsx',
      'packages/assets/src/components/AssetDashboardClient.tsx',
    ]) {
      expect(read(relativePath), relativePath).toContain('ShortcutActiveRegion');
    }
  });
});
