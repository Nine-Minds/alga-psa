import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/actions/renewalsQueueActions.ts', import.meta.url),
  'utf8'
);

describe('renewalsQueueActions timestamp audit wiring', () => {
  it('persists action timestamps on queue mutations when last_action_at column is available', () => {
    expect(source).toContain('const withActionTimestamp = (');
    expect(source).toContain('last_action_at: actionAt');
    expect(source).toContain("schema?.hasColumn?.('client_contracts', 'last_action_at') ?? false");
    expect(source).toContain('hasLastActionAtColumn');
    expect(source).toContain('withActionTimestamp(');
  });
});
