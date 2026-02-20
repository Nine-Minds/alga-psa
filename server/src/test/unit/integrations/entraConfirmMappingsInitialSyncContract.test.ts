import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('Entra confirm mappings initial-sync trigger contract', () => {
  it('T083: confirm mappings optionally starts initial sync and returns workflow/run identifiers', () => {
    const actionsSource = readRepoFile('packages/integrations/src/actions/integrations/entraActions.ts');

    expect(actionsSource).toContain('export const confirmEntraMappings = withAuth(async');
    expect(actionsSource).toContain(
      'if (!input.startInitialSync || (confirmResult.data?.confirmedMappings || 0) === 0) {'
    );
    expect(actionsSource).toContain(
      "const workflowClient = await import('@enterprise/lib/integrations/entra/entraWorkflowClient');"
    );
    expect(actionsSource).toContain('startEntraInitialSyncWorkflow({');
    expect(actionsSource).toContain('initialSync: {');
    expect(actionsSource).toContain('started: workflowStart.available');
    expect(actionsSource).toContain('workflowId: workflowStart.workflowId || null');
    expect(actionsSource).toContain('runId: workflowStart.runId || null');
  });
});
