import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.resolve(__dirname, '../ticket-columns.tsx'),
  'utf8'
);

describe('ticket list row links', () => {
  it('disable Next prefetch while preserving the ticket href and intercepted primary click', () => {
    const ticketLinkPattern =
      /<Link\s+href=\{`\/msp\/tickets\/\$\{record\.ticket_id\}`\}\s+prefetch=\{false\}\s+onClick=\{\(e\) => \{\s+if \(e\.metaKey \|\| e\.ctrlKey\) return;\s+e\.preventDefault\(\);\s+e\.stopPropagation\(\);\s+onTicketClick\(record\.ticket_id as string\);/g;

    const matches = source.match(ticketLinkPattern) ?? [];

    expect(matches).toHaveLength(2);
  });
});
