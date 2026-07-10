import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const appMspRoot = path.resolve(process.cwd(), 'src/app/msp');

const workLayoutFiles = [
  'assets/layout.tsx',
  'billing/layout.tsx',
  'clients/layout.tsx',
  'contacts/layout.tsx',
  'create-ticket/layout.tsx',
  'create-client/layout.tsx',
  'create-contact/layout.tsx',
  'create-asset/layout.tsx',
  'create-project/layout.tsx',
  'create-service/layout.tsx',
  'create-product/layout.tsx',
  'invoices/layout.tsx',
  'projects/layout.tsx',
  'quote-approvals/layout.tsx',
  'quote-document-templates/layout.tsx',
  'schedule/layout.tsx',
  'technician-dispatch/layout.tsx',
  'tickets/layout.tsx',
  'time-entry/layout.tsx',
  'time-sheet-approvals/layout.tsx',
  'user-activities/layout.tsx',
] as const;

const appWideCreateModalPages = [
  '@modal/(.)create-ticket/page.tsx',
  '@modal/(.)create-client/page.tsx',
  '@modal/(.)create-contact/page.tsx',
  '@modal/(.)create-asset/page.tsx',
  '@modal/(.)create-project/page.tsx',
  '@modal/(.)create-service/page.tsx',
  '@modal/(.)create-product/page.tsx',
] as const;

describe('MSP workspace route layout coverage', () => {
  it('wraps each work route folder with WorkspaceRouteLayout', () => {
    for (const relativePath of workLayoutFiles) {
      const source = fs.readFileSync(path.join(appMspRoot, relativePath), 'utf8');
      expect(source, relativePath).toContain('WorkspaceRouteLayout');
    }
  });

  it('wraps app-wide intercepted create modal pages with WorkspaceRouteLayout', () => {
    for (const relativePath of appWideCreateModalPages) {
      const source = fs.readFileSync(path.join(appMspRoot, relativePath), 'utf8');
      expect(source, relativePath).toContain('WorkspaceRouteLayout');
      expect(source, relativePath).toContain('closeMode="back"');
    }
  });
});
