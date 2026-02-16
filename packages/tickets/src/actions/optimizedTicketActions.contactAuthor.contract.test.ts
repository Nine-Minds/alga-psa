import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readOptimizedTicketActionsSource(): string {
  const filePath = path.resolve(__dirname, './optimizedTicketActions.ts');
  return fs.readFileSync(filePath, 'utf8');
}

describe('MSP consolidated ticket data contact authorship contract', () => {
  it('T023: returns comments path with contact_id support in consolidated payload assembly', () => {
    const source = readOptimizedTicketActionsSource();

    expect(source).toContain("trx('comments')");
    expect(source).toContain('comments,');
    expect(source).toContain('comment.contact_id');
  });

  it('T024: builds contact author resolution data (contactMap) for conversation comments', () => {
    const source = readOptimizedTicketActionsSource();

    expect(source).toContain('const contactMap =');
    expect(source).toContain('commentContacts.reduce');
    expect(source).toContain('full_name: contact.full_name');
    expect(source).toContain('contactMap,');
  });
});
