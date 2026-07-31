import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string) =>
  fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');

describe('ClientQuickView bundle boundary', () => {
  it('renders the extracted details tab without importing full ClientDetails or heavy tab modules', () => {
    const quickViewSource = read('./ClientQuickView.tsx');

    expect(quickViewSource).toContain("import { ClientDetailsTabContent } from './ClientDetailsTabContent'");
    expect(quickViewSource).not.toContain("from './ClientDetails'");

    for (const forbiddenImport of [
      'BillingConfiguration',
      'InteractionsFeed',
      'ClientContactsList',
      'ClientNotesPanel',
      'HuduClientTab',
      'HuduClientPasswordsTab',
      'HuduClientDocumentsSection',
    ]) {
      expect(quickViewSource).not.toContain(forbiddenImport);
    }
  });

  it('keeps full ClientDetails on the same extracted details-tab component', () => {
    const clientDetailsSource = read('./ClientDetails.tsx');

    expect(clientDetailsSource).toContain("import { ClientDetailsTabContent } from './ClientDetailsTabContent'");
    expect(clientDetailsSource).toContain('<ClientDetailsTabContent');
  });

  it('keeps the previous quick-view details actions on the lightweight drawer', () => {
    const quickViewSource = read('./ClientQuickView.tsx');

    for (const requiredSurface of [
      'open-in-new-tab-button',
      'sync-entra-now-button',
      'print-button',
      'delete-client-button',
      'delete-client-dialog',
      'deactivate-client-dialog',
      'reactivate-client-dialog',
      'handleDirectMarkInactive',
      'handleDirectReactivate',
    ]) {
      expect(quickViewSource).toContain(requiredSurface);
    }
  });
});
