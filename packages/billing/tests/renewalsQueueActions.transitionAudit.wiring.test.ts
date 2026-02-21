import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/actions/renewalsQueueActions.ts', import.meta.url),
  'utf8'
);

describe('renewalsQueueActions transition audit wiring', () => {
  it('records transition metadata with actor id for renewal status mutations', () => {
    expect(source).toContain("const withActionLabel = (");
    expect(source).toContain('last_action: actionLabel');
    expect(source).toContain("schema?.hasColumn?.('client_contracts', 'last_action') ?? false");
    expect(source).toContain("withActionLabel({\n                status: 'renewing',");
    expect(source).toContain("}, hasLastActionColumn, 'mark_renewing')");
    expect(source).toContain("}, hasLastActionColumn, 'mark_non_renewing')");
    expect(source).toContain("withActionLabel(sourceWorkItemUpdate, hasLastActionColumn, 'create_renewal_draft')");
    expect(source).toContain("}, hasLastActionColumn, 'snooze')");
    expect(source).toContain("}, hasLastActionColumn, 'assign_owner')");
    expect(source).toContain("}, hasLastActionColumn, 'complete_after_activation')");
    expect(source).toContain("}, hasLastActionColumn, 'complete_after_non_renewal')");
    expect(source).toContain('withActionActor(');
  });
});
