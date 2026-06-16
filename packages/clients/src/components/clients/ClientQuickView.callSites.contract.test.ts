import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');

const read = (relativePath: string) =>
  fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

describe('ClientQuickView call sites', () => {
  it('uses ClientQuickView for client quick-view drawers instead of ClientDetails quickView', () => {
    const migratedFiles = [
      'packages/msp-composition/src/tickets/MspTicketsPageClient.tsx',
      'packages/msp-composition/src/tickets/MspTicketDetailsContainerClient.tsx',
      'packages/msp-composition/src/clients/MspClientDrawerProvider.tsx',
      'packages/msp-composition/src/billing/MspBillingDashboardClient.tsx',
      'packages/msp-composition/src/projects/MspClientIntegrationProvider.tsx',
      'packages/clients/src/components/clients/Clients.tsx',
      'packages/clients/src/components/interactions/InteractionDetails.tsx',
      'server/src/components/settings/general/UserList.tsx',
      'packages/clients/src/components/contacts/Contacts.tsx',
      'packages/msp-composition/src/clients/MspContactTickets.tsx',
      'packages/clients/src/components/contacts/ContactDetailsView.tsx',
      'packages/clients/src/components/contacts/ContactDetails.tsx',
    ];

    for (const file of migratedFiles) {
      const source = read(file);
      expect(source, file).toContain('ClientQuickView');
      expect(source, file).not.toContain('components/clients/ClientDetails');
      expect(source, file).not.toContain("from './ClientDetails'");
      expect(source, file).not.toContain("from '../clients/ClientDetails'");
    }
  });
});
