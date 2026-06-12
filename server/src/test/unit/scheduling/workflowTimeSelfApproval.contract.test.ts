import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('workflow time self-approval behavior (static)', () => {
  it('allows self-approval by default and checks configured ABAC not-self-approver rules', () => {
    const src = readRepoFile('shared/workflow/runtime/actions/businessOperations/timeDomain.ts');

    expect(src).toContain('async function hasAssignedNotSelfApproverBundleRuleForWorkflowTime(');
    expect(src).toContain(".andWhere('r.resource_type', 'time_entry')");
    expect(src).toContain(".andWhere('r.action', 'approve')");
    expect(src).toContain(".andWhere('r.constraint_key', 'not_self_approver')");
    expect(src).toContain('await hasAssignedNotSelfApproverBundleRuleForWorkflowTime(trx, tenantId, actorUserId)');
    expect(src).not.toContain('if (actorUserId === subjectUserId) {\n    throw new WorkflowTimeDomainError');
  });
});
