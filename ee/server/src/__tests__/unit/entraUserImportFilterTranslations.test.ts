import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../../../../');
const componentPaths = [
  'ee/server/src/components/settings/integrations/entra/ManagedTenantUserFilterPanel.tsx',
  'ee/server/src/components/settings/integrations/entra/FieldSyncRules.tsx',
  'ee/server/src/components/settings/integrations/entra/ContactPreflightReport.tsx',
];
const locales = ['en', 'de', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'xx', 'yy'];

describe('Entra user import filter translations', () => {
  it('defines every referenced userImportFilter key in every locale', () => {
    const keys = new Set<string>();
    for (const relativePath of componentPaths) {
      const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
      for (const match of source.matchAll(/t\(['"`]integrations\.entra\.userImportFilter\.([A-Za-z0-9_$]+)['"`]/g)) keys.add(match[1]);
    }
    // These computed keys are rendered from the toggle list and the marker helper.
    for (const key of ['memberUsersOnly', 'licensedUsersOnly', 'deactivateExcludedContacts', 'importSharedMailboxes', 'sharedMailboxReason', 'include', 'exclude', 'inherited', 'overridden']) keys.add(key);
    expect(keys.size).toBeGreaterThan(0);
    for (const locale of locales) {
      const file = path.join(root, `server/public/locales/${locale}/msp/integrations.json`);
      const localeJson = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const key of keys) expect(localeJson.integrations.entra.userImportFilter[key], `${locale}: ${key}`).toBeTruthy();
      expect(localeJson.integrations.entra.userImportFilter.deactivate).toBeUndefined();
      expect(localeJson.integrations.entra.userImportFilter.effectivePatterns).toContain('{{patterns}}');
    }
  });
});
