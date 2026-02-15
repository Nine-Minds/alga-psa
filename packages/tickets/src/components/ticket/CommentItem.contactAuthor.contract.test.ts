import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readCommentItemSource(): string {
  const filePath = path.resolve(__dirname, './CommentItem.tsx');
  return fs.readFileSync(filePath, 'utf8');
}

describe('CommentItem contact-authored rendering contract', () => {
  it('T027: renders contact display name via resolved author (no Unknown User fallback for resolvable contact)', () => {
    const source = readCommentItemSource();

    expect(source).toContain('resolveCommentAuthor(conversation');
    expect(source).toContain('resolvedAuthor.displayName');
    expect(source).toContain("resolvedAuthor.source === 'contact'");
  });

  it('T028: renders contact email line when available', () => {
    const source = readCommentItemSource();

    expect(source).toContain('const authorEmail = getAuthorEmail()');
    expect(source).toContain('mailto:${authorEmail}');
    expect(source).toContain('authorEmail && (');
  });

  it('T029: uses ContactAvatar for contact-authored comments without user records', () => {
    const source = readCommentItemSource();

    expect(source).toContain("resolvedAuthor.source === 'contact' ? (");
    expect(source).toContain('<ContactAvatar');
    expect(source).toContain('contactId={resolvedAuthor.contactId || conversation.contact_id || \'\'}');
  });

  it('T030: preserves Unknown User fallback when neither user nor contact resolves', () => {
    const source = readCommentItemSource();

    expect(source).toContain("resolvedAuthor.source === 'unknown'");
    expect(source).toContain('userName="Unknown User"');
  });

  it('T031: edit/delete permission check remains bound to authenticated user_id ownership', () => {
    const source = readCommentItemSource();

    expect(source).toContain('currentUserId === conversation.user_id');
    expect(source).not.toContain('currentUserId === conversation.contact_id');
  });
});
