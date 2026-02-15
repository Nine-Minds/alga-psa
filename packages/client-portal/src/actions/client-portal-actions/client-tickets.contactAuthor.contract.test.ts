import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readClientTicketsSource(): string {
  const filePath = path.resolve(__dirname, './client-tickets.ts');
  return fs.readFileSync(filePath, 'utf8');
}

describe('Client portal ticket details contact authorship contract', () => {
  it('T025: includes contact author resolution map in client portal ticket details path', () => {
    const source = readClientTicketsSource();

    expect(source).toContain('const commentContactIds =');
    expect(source).toContain('comment.contact_id');
    expect(source).toContain('const contactMap =');
    expect(source).toContain('contactMap');
  });
});
