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

  // A phase move is also a task update: moveTaskToPhase emits
  // PROJECT_TASK_UPDATED with a rich {previous,new} diff so the webhook
  // delivers a meaningful changes body (decision 2026-05-15, supersedes the
  // original PRD §7 phase-move exclusion).
  it('emits a {previous,new} diff from moveTaskToPhase', () => {
    const moveTaskToPhase = functionSource('moveTaskToPhase');

    expect(moveTaskToPhase).toContain('const moveChanges = buildProjectTaskWebhookChanges(');
    expect(moveTaskToPhase).toContain('Object.keys(moveChanges).length > 0');
    expect(moveTaskToPhase).toContain("eventType: 'PROJECT_TASK_UPDATED'");
    expect(moveTaskToPhase).toContain('changes: moveChanges');
  });

  // Status change has its own event (PROJECT_TASK_STATUS_CHANGED); reorder and
  // dependency mutations carry no webhook-relevant delta, so none of them emit
  // PROJECT_TASK_UPDATED.
  it('does not emit PROJECT_TASK_UPDATED from status, reorder, or dependency actions', () => {
    for (const name of [
      'updateTaskStatus',
      'reorderTask',
      'reorderTasksInStatus',
      'updateTaskDependency',
    ]) {
      expect(functionSource(name)).not.toContain("eventType: 'PROJECT_TASK_UPDATED'");
    }
  });
});
