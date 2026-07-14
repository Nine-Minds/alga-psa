import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/actions/renewalsQueueActions.ts', import.meta.url),
  'utf8'
);

describe('renewalsQueueActions transition audit wiring', () => {
  it('records transition metadata with actor id for renewal status mutations', () => {
    expect(source).toContain("const withActionLabel = (");
    expect(source).toContain('{ ...updateData, last_action: actionLabel }');
    expect(source).toMatch(/withActionLabel\(\{\s*status: 'renewing',/);
    expect(source).toContain("}, 'mark_renewing'), actorUserId");
    expect(source).toContain("}, 'mark_non_renewing'), actorUserId");
    expect(source).toContain("withActionLabel(sourceWorkItemUpdate, 'create_renewal_draft'), actorUserId");
    expect(source).toContain("}, 'snooze'), actorUserId");
    expect(source).toContain("}, 'assign_owner'), actorUserId");
    expect(source).toContain("}, 'complete_after_activation'), actorUserId");
    expect(source).toContain("}, 'complete_after_non_renewal'), actorUserId");
    expect(source).toContain('withActionActor(');
  });
});
