import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const actionPath = path.resolve(__dirname, './commentActions.ts');

function getActionSource(): string {
  return fs.readFileSync(actionPath, 'utf-8');
}

describe('commentActions contract', () => {
  it('clears email reply token comment references before deleting a comment', () => {
    const source = getActionSource();

    expect(source).toContain("await trx('email_reply_tokens')");
    expect(source).toContain(".where({ tenant, comment_id: id })");
    expect(source).toContain(".update({ comment_id: null });");
    expect(source).toContain('await Comment.delete(trx, tenant, id);');
  });
});
