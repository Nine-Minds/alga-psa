import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

// alga-2026-0002597: the plan named three self-approval enforcement sites; there are four
// (the REST controller has its own guard). All must use the shared decision and thread the
// DB-computed `allowSelfApproval` flag into the kernel input (the kernel/bundle provider
// cannot query the DB itself).

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

const SITES = [
  ['quoteActions (server actions)', 'packages/billing/src/actions/quoteActions.ts'],
  ['ApiQuoteController (REST)', 'server/src/lib/api/controllers/ApiQuoteController.ts'],
  ['EE authorization bundle simulator', 'ee/server/src/lib/actions/auth/authorizationBundleActions.ts'],
] as const;

describe('quote self-approval enforcement sites share one decision', () => {
  it.each(SITES)('%s uses isSelfApprovalBlocked and computes the flag from the shared predicate', (_name, file) => {
    const src = readRepoFile(file);
    expect(src).toContain('isSelfApprovalBlocked(');
    expect(src).toContain('resolveAllowSelfApprovalFlag(');
    expect(src).toContain('allowSelfApproval');
    // No hand-rolled owner === subject comparison left behind.
    expect(src).not.toMatch(/ownerUserId\s*===\s*input\.subject\.userId/);
    expect(src).not.toMatch(/ownerUserId\s*===\s*evaluationInput\.subject\.userId/);
  });

  it('the bundle not_self_approver rule uses the same decision', () => {
    const src = readRepoFile('packages/authorization/src/kernel/providers/bundleProvider.ts');
    expect(src).toContain("rule.constraintKey === 'not_self_approver' && isSelfApprovalBlocked(input)");
  });

  it('the kernel and providers stay free of database access', () => {
    for (const file of [
      'packages/authorization/src/kernel/selfApproval.ts',
      'packages/authorization/src/kernel/providers/bundleProvider.ts',
      'packages/authorization/src/kernel/providers/builtinProvider.ts',
    ]) {
      const src = readRepoFile(file);
      expect(src).not.toMatch(/from ['"]knex['"]|@alga-psa\/db|tenantDb\(/);
    }
  });
});
