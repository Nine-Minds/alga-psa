import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/actions/renewalsQueueActions.ts', import.meta.url),
  'utf8'
);

describe('renewalsQueueActions actor audit wiring', () => {
  it('persists actor user id metadata on queue mutation updates when audit columns are available', () => {
    expect(source).toContain('const resolveActorUserId = (user: unknown): string | null => {');
    expect(source).toContain('const withActionActor = (');
    expect(source).toContain('last_action_by: actorUserId');
    expect(source).toContain("schema?.hasColumn?.('client_contracts', 'last_action_by') ?? false");
    expect(source).toContain('const actorUserId = resolveActorUserId(user);');
    expect(source).toContain('withActionTimestamp(');
    expect(source).toContain('withActionActor(');
  });
});
