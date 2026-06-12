import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  renderTicketDescriptionHtml,
  renderTicketRichTextHtml,
} from '../../../lib/api/services/ticketRichRender';

function readHelperSource(): string {
  const filePath = path.resolve(__dirname, '../../../lib/api/services/ticketRichRender.ts');
  return fs.readFileSync(filePath, 'utf8');
}

describe('ticketRichRender helper', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('derives HTML for serialized BlockNote JSON using the shared formatting package', () => {
    const source = readHelperSource();
    expect(source).toContain("import { convertBlockContentToHTML } from '@alga-psa/formatting';");

    const html = renderTicketRichTextHtml(
      JSON.stringify([
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Bold reply',
              styles: { bold: true },
            },
          ],
        },
      ])
    );

    expect(html).toContain('<strong>Bold reply</strong>');
  });

  it("derives HTML for ProseMirror '{type:\"doc\"}' payloads using the shared formatting package", () => {
    const html = renderTicketRichTextHtml({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Hello from ProseMirror',
            },
          ],
        },
      ],
    });

    expect(html).toBe('<p>Hello from ProseMirror</p>');
  });

  it('derives description HTML from ticket attributes for mobile detail responses without parsing plain text as JSON', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const html = renderTicketDescriptionHtml({
      description: 'Legacy plain text description',
    });

    expect(html).toBe('<p>Legacy plain text description</p>');
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
