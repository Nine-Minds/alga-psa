import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('authorization bundle simulator self-approval contracts', () => {
  it('keeps time self-approval as bundle-provider policy instead of a built-in simulator guard', () => {
    const src = readRepoFile('ee/server/src/lib/actions/auth/authorizationBundleActions.ts');

    expect(src).toContain("input.action === 'approve' && input.resourceType === 'billing'");
    expect(src).toContain("code: 'billing_not_self_approver_denied'");
    expect(src).not.toContain("code: 'timesheet_not_self_approver_denied'");
    expect(src).not.toContain("code: 'timesheet_not_self_approver_passed'");
  });
});
