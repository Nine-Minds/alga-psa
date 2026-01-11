import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Citus safety: tenant-scoped updates on distributed tables', () => {
  it('scopes email_providers updates by tenant in Microsoft webhook route', () => {
    const filePath = path.resolve(__dirname, '../../app/api/email/webhooks/microsoft/route.ts');
    const source = fs.readFileSync(filePath, 'utf-8');

    expect(source).toContain(".where({ id: row.id, tenant: row.tenant })");
  });

  it('scopes email_providers updates by tenant in Google webhook route', () => {
    const filePath = path.resolve(__dirname, '../../app/api/email/webhooks/google/route.ts');
    const source = fs.readFileSync(filePath, 'utf-8');

    expect(source).toContain(".where({ id: provider.id, tenant: provider.tenant })");
  });
});
