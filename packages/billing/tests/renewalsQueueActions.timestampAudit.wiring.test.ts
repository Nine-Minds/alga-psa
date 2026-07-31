import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/actions/renewalsQueueActions.ts', import.meta.url),
  'utf8'
);

describe('renewalsQueueActions timestamp audit wiring', () => {
  it('persists action timestamps on queue mutations', () => {
    expect(source).toContain('const withActionTimestamp = (');
    expect(source).toContain('{ ...updateData, last_action_at: actionAt }');
    expect(source).toContain('actionAt: string');
    expect(source).toContain('withActionTimestamp(');
  });
});
