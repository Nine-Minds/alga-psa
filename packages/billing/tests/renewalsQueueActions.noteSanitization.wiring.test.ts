import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/actions/renewalsQueueActions.ts', import.meta.url),
  'utf8'
);

describe('renewalsQueueActions note sanitization wiring', () => {
  it('sanitizes user-provided action notes before persistence', () => {
    expect(source).toContain('const sanitizeActionNoteText = (value: string): string => (');
    expect(source).toContain(".replace(/<[^>]*>/g, ' ')");
    expect(source).toContain(".replace(/[<>]/g, '')");
    expect(source).toContain(".replace(/[\\u0000-\\u001F\\u007F]/g, ' ')");
    expect(source).toContain(".replace(/\\s+/g, ' ')");
    expect(source).toContain('const trimmed = sanitizeActionNoteText(note);');
    expect(source).toContain('hasLastActionNoteColumn && note');
    expect(source).toContain('last_action_note: note');
  });
});
