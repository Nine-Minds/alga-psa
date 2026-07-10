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

  it('registers page.save on editable detail surfaces with primary Save controls', () => {
    expect(read('packages/clients/src/components/clients/ClientDetails.tsx')).toContain('usePageSaveShortcut(handleSave');
    expect(read('packages/tickets/src/components/ticket/TicketInfo.tsx')).toContain('usePageSaveShortcut(handleSaveChanges');
  });

  it('registers page.create on inventory manager surfaces', () => {
    const inventoryCreateSurfaces = [
      'packages/inventory/src/components/PurchaseOrdersManager.tsx',
      'packages/inventory/src/components/SalesOrdersManager.tsx',
      'packages/inventory/src/components/RmaManager.tsx',
      'packages/inventory/src/components/KitManager.tsx',
      'packages/inventory/src/components/CycleCountsManager.tsx',
      'packages/inventory/src/components/StockLocationsManager.tsx',
      'packages/inventory/src/components/LoanersManager.tsx',
      'packages/inventory/src/components/StockOverview.tsx',
      'packages/inventory/src/components/TransfersManager.tsx',
      'packages/inventory/src/components/VendorsManager.tsx',
      'packages/inventory/src/components/VendorBillsManager.tsx',
    ];

    for (const path of inventoryCreateSurfaces) {
      expect(read(path), path).toContain('usePageCreateShortcut');
    }
  });

  it('registers dialog.submit on inventory create/edit dialogs', () => {
    const inventoryDialogSurfaces = [
      'packages/inventory/src/components/PurchaseOrdersManager.tsx',
      'packages/inventory/src/components/SalesOrdersManager.tsx',
      'packages/inventory/src/components/RmaManager.tsx',
      'packages/inventory/src/components/CycleCountsManager.tsx',
      'packages/inventory/src/components/StockLocationsManager.tsx',
      'packages/inventory/src/components/LoanersManager.tsx',
      'packages/inventory/src/components/PoLandedCostDialog.tsx',
      'packages/inventory/src/components/StockOverview.tsx',
      'packages/inventory/src/components/TransfersManager.tsx',
      'packages/inventory/src/components/VendorsManager.tsx',
      'packages/inventory/src/components/VendorBillsManager.tsx',
    ];

    for (const path of inventoryDialogSurfaces) {
      expect(read(path), path).toContain('useDialogSubmitShortcut');
    }
  });

  it('registers panel.submit on drawer-hosted save surfaces (page.save is suppressed in panels)', () => {
    const drawerSaveSurfaces = [
      'packages/tickets/src/components/ticket/TicketInfo.tsx',
      'packages/clients/src/components/clients/ClientQuickView.tsx',
      'packages/clients/src/components/contacts/ContactDetailsEdit.tsx',
    ];

    for (const path of drawerSaveSurfaces) {
      expect(read(path), path).toContain('usePanelSubmitShortcut');
    }
  });

  it('registers page.create on the contact bento layout', () => {
    expect(read('packages/clients/src/components/contacts/bento/ContactBentoLayout.tsx')).toContain('usePageCreateShortcut(openEditDrawer');
  });

  it('mounts the shared global shortcut layer in both MSP shells', () => {
    expect(read('server/src/components/layout/DefaultLayout.tsx')).toContain('<GlobalShortcutLayer />');
    expect(read('server/src/components/layout/AlgaDeskMspShell.tsx')).toContain('<GlobalShortcutLayer />');
  });
});
