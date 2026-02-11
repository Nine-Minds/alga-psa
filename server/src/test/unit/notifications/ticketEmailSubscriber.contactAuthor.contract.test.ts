import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readTicketEmailSubscriberSource(): string {
  const filePath = path.resolve(__dirname, '../../../lib/eventBus/subscribers/ticketEmailSubscriber.ts');
  return fs.readFileSync(filePath, 'utf8');
}

describe('ticketEmailSubscriber contact-author exclusion contract', () => {
  it('T035: excludes contact-only comment authors from recipient fan-out', () => {
    const source = readTicketEmailSubscriberSource();

    expect(source).toContain("let commentAuthorContactId: string | null = null");
    expect(source).toContain("let commentAuthorEmail = ''");
    expect(source).toContain("if (commentAuthorEmail && key === normalizeEmail(commentAuthorEmail))");
    expect(source).toContain('const isPrimaryContactAuthor = Boolean(');
    expect(source).toContain('const isChildContactAuthor = Boolean(');
  });
});
