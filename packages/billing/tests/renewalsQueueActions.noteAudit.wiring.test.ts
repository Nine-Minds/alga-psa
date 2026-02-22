import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/actions/renewalsQueueActions.ts', import.meta.url),
  'utf8'
);

describe('renewalsQueueActions note audit wiring', () => {
  it('persists optional action notes on queue mutations when last_action_note column is available', () => {
    expect(source).toContain('const normalizeActionNote = (note: string | null | undefined): string | null => {');
    expect(source).toContain('const withActionNote = (');
    expect(source).toContain('last_action_note: note');
    expect(source).toContain("schema?.hasColumn?.('client_contracts', 'last_action_note') ?? false");
    expect(source).toContain('const normalizedNote = normalizeActionNote(note);');
    expect(source).toContain('withActionNote(');
  });
});
