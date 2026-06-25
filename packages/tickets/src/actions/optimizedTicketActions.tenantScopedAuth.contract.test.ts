// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('optimized ticket action tenant-scoped authorization SQL contract', () => {
  it('uses tenant-scoped query wrappers for ticket read authorization SQL', () => {
    const source = fs.readFileSync(path.resolve(__dirname, './optimizedTicketActions.ts'), 'utf8');

    expect(source).toContain('createTenantScopedQuery');
    expect(source).toContain('cloneTenantScopedQuery');
    expect(source).toContain('compileTenantScopedResourceReadAuthorizationSql');
    expect(source).not.toContain('compileResourceReadAuthorizationSql,');
  });
});
