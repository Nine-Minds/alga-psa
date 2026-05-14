import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(process.cwd(), '..');

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

describe('app-wide search hash-anchor contracts', () => {
  it('T157 ticket comments scroll and highlight for #comment-{id} anchors', () => {
    const source = readRepoFile('packages/tickets/src/components/ticket/CommentItem.tsx');

    expect(source).toContain('const expectedHash = `#comment-${conversation.comment_id}`');
    expect(source).toContain('window.location.hash !== expectedHash');
    expect(source).toContain('document.getElementById(commentId)');
    expect(source).toContain("target?.scrollIntoView({ behavior: 'smooth', block: 'center' })");
    expect(source).toContain('setIsSearchHighlighted(true)');
    expect(source).toContain('window.setTimeout(() => setIsSearchHighlighted(false), 2000)');
    expect(source).toContain("'search-highlight ring-2 ring-yellow-400 bg-yellow-50'");
  });
});
