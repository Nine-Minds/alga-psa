import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(path.resolve(__dirname, 'tagActions.ts'), 'utf8');

function functionSource(name: string): string {
  const marker = name === 'createTagsForEntity'
    ? `export async function ${name}(`
    : `function ${name}(`;
  const start = source.indexOf(marker);
  if (start === -1) {
    throw new Error(`Could not find ${name}`);
  }

  const nextFunction = source.indexOf('\nfunction ', start + marker.length);
  const nextExportConst = source.indexOf('\nexport const ', start + marker.length);
  const nextExportAsync = source.indexOf('\nexport async function ', start + marker.length);
  const candidates = [nextFunction, nextExportConst, nextExportAsync].filter((index) => index !== -1);
  const end = candidates.length > 0 ? Math.min(...candidates) : source.length;
  return source.slice(start, end);
}

function actionSource(name: string): string {
  const marker = `export const ${name} = withAuth(async (`;
  const start = source.indexOf(marker);
  if (start === -1) {
    throw new Error(`Could not find ${name}`);
  }

  const nextExport = source.indexOf('\nexport const ', start + marker.length);
  const nextExportAsync = source.indexOf('\nexport async function ', start + marker.length);
  const candidates = [nextExport, nextExportAsync].filter((index) => index !== -1);
  const end = candidates.length > 0 ? Math.min(...candidates) : source.length;
  return source.slice(start, end);
}

describe('tag webhook entity-update emission contract', () => {
  it('routes changed project_task tag sets to PROJECT_TASK_UPDATED with task context', () => {
    const publisher = functionSource('publishEntityTagUpdateEvent');

    expect(publisher).toContain("params.taggedType === 'project_task'");
    expect(publisher).toContain('resolveProjectTaskTagContext(params.trx, params.tenant, params.taggedId)');
    expect(publisher).toContain("eventType: 'PROJECT_TASK_UPDATED'");
    expect(publisher).toContain('taskId: params.taggedId');
    expect(publisher).toContain('phaseId: context.phaseId');
    expect(publisher).toContain('timestamp: params.occurredAt');
    expect(publisher).toContain('changes');
  });

  it('routes changed ticket tag sets to TICKET_UPDATED with changes.tags', () => {
    const publisher = functionSource('publishEntityTagUpdateEvent');

    expect(publisher).toContain("params.taggedType === 'ticket'");
    expect(publisher).toContain("eventType: 'TICKET_UPDATED'");
    expect(publisher).toContain('ticketId: params.taggedId');
    expect(publisher).toContain('changes');
  });

  it('guards no-op tag-set writes before publishing entity update events', () => {
    const publisher = functionSource('publishEntityTagUpdateEvent');

    expect(publisher).toContain('if (tagTextSnapshotsEqual(params.previousTags, params.newTags))');
    expect(publisher).toContain('return;');
  });

  it('emits from interactive create/delete paths and suppresses bulk creation paths', () => {
    expect(actionSource('createTag')).toContain('await publishEntityTagUpdateEvent({');
    expect(actionSource('deleteTag')).toContain('await publishEntityTagUpdateEvent({');

    expect(functionSource('createTagsForEntity')).toContain('suppressEntityUpdateEvent: true');
    expect(actionSource('createTagsForEntityWithTransaction')).not.toContain('publishEntityTagUpdateEvent');
  });
});
