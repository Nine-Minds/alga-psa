import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(path.resolve(__dirname, 'projectTaskActions.ts'), 'utf8');

function functionSource(name: string): string {
  const marker = `export const ${name} = withAuth(async (`;
  const start = source.indexOf(marker);
  if (start === -1) {
    throw new Error(`Could not find ${name}`);
  }

  const nextExport = source.indexOf('\nexport const ', start + marker.length);
  return nextExport === -1 ? source.slice(start) : source.slice(start, nextExport);
}

describe('PROJECT_TASK_UPDATED action emission contract', () => {
  it('emits from updateTaskWithChecklist only after a non-empty tracked diff', () => {
    const updateTaskWithChecklist = functionSource('updateTaskWithChecklist');

    expect(updateTaskWithChecklist).toContain('const webhookChanges = buildProjectTaskWebhookChanges(');
    expect(updateTaskWithChecklist).toContain('Object.keys(webhookChanges).length > 0');
    expect(updateTaskWithChecklist).toContain("eventType: 'PROJECT_TASK_UPDATED'");
    expect(updateTaskWithChecklist).toContain('taskId,');
    expect(updateTaskWithChecklist).toContain('phaseId: phase.phase_id');
    expect(updateTaskWithChecklist).toContain('changes: webhookChanges');
  });

  // PROJECT_TASK_UPDATED is shared with the search index subscriber, which
  // emits an opaque-`changes` variant from other task paths (e.g. phase move)
  // for reindexing. The webhook-relevant emit is the rich `changes:
  // webhookChanges` diff — that must originate ONLY from updateTaskWithChecklist
  // so webhook deliveries stay scoped to form-field edits (PRD F003/§7).
  it('emits the webhook changes diff only from updateTaskWithChecklist', () => {
    for (const name of [
      'updateTaskStatus',
      'moveTaskToPhase',
      'reorderTask',
      'reorderTasksInStatus',
      'updateTaskDependency',
    ]) {
      expect(functionSource(name)).not.toContain('changes: webhookChanges');
    }
  });
});
