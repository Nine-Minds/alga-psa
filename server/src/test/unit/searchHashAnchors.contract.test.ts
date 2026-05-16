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
    // Highlight clears on user interaction with a long fallback (not a short
    // fixed timer) so it stays visible long enough to register.
    expect(source).toContain('const dismiss = () => setIsSearchHighlighted(false)');
    expect(source).toContain("window.addEventListener('pointerdown', dismiss, { once: true })");
    expect(source).toContain('window.setTimeout(dismiss, 15000)');
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

  it('T159 project task comments preserve #comment anchors and highlight the target comment', () => {
    const redirectSource = readRepoFile('server/src/app/msp/projects/[id]/tasks/[taskId]/ProjectTaskSearchRedirectClient.tsx');
    const projectPageSource = readRepoFile('packages/projects/src/components/ProjectPage.tsx');
    const taskCommentSource = readRepoFile('packages/projects/src/components/TaskComment.tsx');

    expect(redirectSource).toContain('const hash = window.location.hash ||');
    expect(redirectSource).toContain('${hash}');
    expect(projectPageSource).toContain("window.location.hash.startsWith('#comment-')");
    expect(projectPageSource).toContain("const hash = shouldPreserveCommentHash ? window.location.hash : ''");
    expect(taskCommentSource).toContain('`comment-${comment.taskCommentId}`');
    expect(taskCommentSource).toContain('window.location.hash !== `#${searchAnchorId}`');
    expect(taskCommentSource).toContain("document.getElementById(searchAnchorId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })");
    expect(taskCommentSource).toContain('search-highlight border-yellow-400 bg-yellow-50');
  });

  it('T164 ticket-comment search results link to the ticket comment hash highlight target', () => {
    const indexerSource = readRepoFile('server/src/lib/search/indexers/ticket_comment.ts');
    const commentItemSource = readRepoFile('packages/tickets/src/components/ticket/CommentItem.tsx');

    expect(indexerSource).toContain('url: `/msp/tickets/${row.ticket_id}#comment-${row.comment_id}`');
    expect(indexerSource).toContain("parentType: 'ticket'");
    expect(indexerSource).toContain('body: resolveCommentBody(row)');
    expect(commentItemSource).toContain('const expectedHash = `#comment-${conversation.comment_id}`');
    expect(commentItemSource).toContain('target?.scrollIntoView({ behavior: \'smooth\', block: \'center\' })');
    expect(commentItemSource).toContain('search-highlight ring-2 ring-yellow-400 bg-yellow-50');
  });
});
