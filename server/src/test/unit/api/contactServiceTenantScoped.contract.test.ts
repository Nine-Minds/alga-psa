// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');

describe('contact API service tenant-scoped query contract', () => {
  it('uses structural tenant scoping for custom contact roots', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, 'server/src/lib/api/services/ContactService.ts'),
      'utf8'
    );

    expect(source).toContain('tenantDb(');
    expect(source).toContain('tenantDb(');
    expect(source).toContain(".table('contacts as c')");
    expect(source).not.toMatch(/knex\('contacts as c'\)[\s\S]*?\.where\('c\.tenant', context\.tenant\)/);
    expect(source).not.toMatch(/trx\('contacts as c'\)[\s\S]*?'c\.tenant': context\.tenant/);
  });

  it('validates dependencies before the shared cascade removes the contact row', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, 'server/src/lib/api/services/ContactService.ts'),
      'utf8'
    );
    const deleteStart = source.indexOf('async delete(id: string, context: ServiceContext)');
    const validation = source.indexOf('deleteEntityWithValidation(', deleteStart);
    const cascade = source.indexOf('deleteContactCascade(trx, tenant, id,', validation);
    const conflict = source.indexOf('throw new ConflictError(', cascade);

    expect(deleteStart).toBeGreaterThan(-1);
    expect(validation).toBeGreaterThan(deleteStart);
    expect(cascade).toBeGreaterThan(validation);
    expect(conflict).toBeGreaterThan(cascade);

    // The row delete and every child cleanup live in the shared cascade, so the
    // API path can never drift from the MSP action and strand a portal user.
    const deleteSection = source.slice(deleteStart, source.indexOf('async search(', deleteStart));
    expect(deleteSection).not.toContain(".table('contacts')");
    expect(deleteSection).not.toContain('clearContactLinksBeforeDelete');
  });
});
