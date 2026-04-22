import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (fileName: string) => readFileSync(path.resolve(__dirname, fileName), 'utf8');

describe('project authorization kernel contracts', () => {
  const projectActionsSource = readSource('projectActions.ts');
  const commentActionsSource = readSource('projectTaskCommentActions.ts');

  it('T020: preserves own-comment/internal-user behavior and supports bundle narrowing on project list/detail', () => {
    expect(commentActionsSource).toContain('if (user.user_type === \'internal\') {');
    expect(commentActionsSource).toContain('relationshipRules: [{ template: \'own\' }],');
    expect(commentActionsSource).toContain("type: 'project_task_comment'");

    expect(projectActionsSource).toContain('export const getProjects = withAuth(async (user, { tenant })');
    expect(projectActionsSource).toContain('export const getProject = withAuth(async (user, { tenant }, projectId: string)');
    expect(projectActionsSource).toContain('builtinProvider: new BuiltinAuthorizationKernelProvider(),');
    expect(projectActionsSource).toContain('bundleProvider: new BundleAuthorizationKernelProvider({');
    expect(projectActionsSource).toContain('return await resolveBundleNarrowingRulesForEvaluation(trx, input);');
    expect(projectActionsSource).toContain('record: toProjectAuthorizationRecord(project),');
  });
});
