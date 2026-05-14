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

  it('T158 invoice items and annotations scroll and highlight for hash anchors', () => {
    const redirectSource = readRepoFile('server/src/app/msp/invoices/[id]/InvoiceSearchRedirectClient.tsx');
    const lineItemSource = readRepoFile('packages/billing/src/components/billing-dashboard/LineItem.tsx');
    const annotationSource = readRepoFile('packages/billing/src/components/billing-dashboard/InvoiceAnnotations.tsx');

    expect(redirectSource).toContain('const hash = window.location.hash ||');
    expect(redirectSource).toContain('${hash}');
    expect(lineItemSource).toContain('const expectedHash = `#item-${item.item_id}`');
    expect(lineItemSource).toContain('document.getElementById(itemDomId)');
    expect(lineItemSource).toContain("target?.scrollIntoView({ behavior: 'smooth', block: 'center' })");
    expect(lineItemSource).toContain('search-highlight ring-2 ring-yellow-400 bg-yellow-50');
    expect(annotationSource).toContain("window.location.hash.startsWith('#annotation-')");
    expect(annotationSource).toContain("document.getElementById(`annotation-${annotationId}`)");
    expect(annotationSource).toContain("target?.scrollIntoView({ behavior: 'smooth', block: 'center' })");
    expect(annotationSource).toContain('search-highlight rounded ring-2 ring-yellow-400 bg-yellow-50');
  });
});
