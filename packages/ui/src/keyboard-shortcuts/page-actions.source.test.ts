/* @vitest-environment node */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../..');

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

describe('page action shortcut wiring', () => {
  it('registers page.create on list create surfaces', () => {
    const createSurfaces = [
      'packages/tickets/src/components/TicketingDashboard.tsx',
      'packages/clients/src/components/clients/Clients.tsx',
      'packages/clients/src/components/contacts/Contacts.tsx',
      'packages/clients/src/components/interactions/InteractionsFeed.tsx',
      'packages/projects/src/components/Projects.tsx',
      'packages/assets/src/components/AssetDashboardClient.tsx',
    ];

    for (const path of createSurfaces) {
      expect(read(path), path).toContain('usePageCreateShortcut');
    }
  });

  it('registers comment shortcuts on both ticket comment surfaces', () => {
    const commentSurfaces = [
      'packages/tickets/src/components/ticket/TicketConversation.tsx',
      'packages/tickets/src/components/ticket/bento/BentoTimelineTile.tsx',
    ];

    for (const path of commentSurfaces) {
      const source = read(path);
      expect(source, path).toContain('usePageCreateShortcut');
      expect(source, path).toContain('useDialogSubmitShortcut');
    }
  });

  it('registers page.save on editable detail surfaces with primary Save controls', () => {
    expect(read('packages/clients/src/components/clients/ClientDetails.tsx')).toContain('usePageSaveShortcut(handleSave');
    expect(read('packages/tickets/src/components/ticket/TicketInfo.tsx')).toContain('usePageSaveShortcut(handleSaveChanges');
  });
});
