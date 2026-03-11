import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readTicketServiceSource(): string {
  const filePath = path.resolve(__dirname, '../../../lib/api/services/TicketService.ts');
  return fs.readFileSync(filePath, 'utf8');
}

describe('TicketService rich render contract', () => {
  it('maps description_html onto ticket detail responses', () => {
    const source = readTicketServiceSource();

    expect(source).toContain("import { renderTicketDescriptionHtml, renderTicketRichTextHtml } from './ticketRichRender';");
    expect(source).toContain('private withDescriptionHtml');
    expect(source).toContain('description_html: renderTicketDescriptionHtml(ticket.attributes)');
    expect(source).toContain('...this.withDescriptionHtml(ticket as ITicketWithDetails)');
    expect(source).toContain('return this.withDescriptionHtml(ticket as ITicket);');
  });

  it('maps comment_html onto ticket comment responses', () => {
    const source = readTicketServiceSource();

    expect(source).toContain('comment_html: renderTicketRichTextHtml(comment.note)');
  });
});
