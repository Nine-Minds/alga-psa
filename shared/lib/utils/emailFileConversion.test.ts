import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { convertHtmlToBlockNote } from './contentConversion';

// Simple Quoted-Printable Decoder

function decodeQuotedPrintable(input: string): string {

  return input

    // 1. Join soft line breaks (=\r\n, =\r, or =\n), allowing for trailing whitespace before the break

    .replace(/=[ \t]*(?:\r\n|\r|\n)/g, '')

    // 2. Decode hex encoded chars (=XX)

    .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

}

describe('Email EML File Conversion', () => {
  it('should correctly parse links in the test email', () => {
    const emlPath = path.join(__dirname, 'test-email.eml');
    const emlContent = fs.readFileSync(emlPath, 'utf-8');

    // 1. Separate Headers and Body
    const parts = emlContent.split(/\r?\n\r?\n/);
    // The body starts after the first double newline (headers end)
    // But wait, the file might have multiple parts?
    // Looking at the provided file content, it seems to be flat structure after headers:
    // Content-Type: text/html...
    // ...
    // (Body)
    
    // The "Body" part is everything after the first empty line.
    const bodyRaw = parts.slice(1).join('\n\n');

    // 2. Decode Quoted-Printable
    const html = decodeQuotedPrintable(bodyRaw);
    
    // 3. Convert to BlockNote
    const blocks = convertHtmlToBlockNote(html);
    
    // 4. Verify the specific "Read more" link
    // We are looking for a link with text "Read more"
    
    let foundReadMore = false;

    function searchBlocks(blocks: any[]) {
      for (const block of blocks) {
        if (block.content) {
          for (const inline of block.content) {
            if (inline.type === 'link' && inline.content) {
               // Check if link text is "Read more"
               const text = inline.content.map((t: any) => t.text).join('');
               if (text === 'Read more') {
                 foundReadMore = true;
                 
                 // Verify href structure (it should be the long NYT link)
                 expect(inline.href).toContain('nl.nytimes.com');
                 expect(inline.href).toContain('QL71Mg'); // Part of the redacted/original hash
               }
            }
          }
        }
        if (block.children) {
          searchBlocks(block.children);
        }
      }
    }

    searchBlocks(blocks);
    expect(foundReadMore).toBe(true);
  });

  it('should handle the specific Read more link snippet', () => {
    const html = `
      <a href="https://nl.nytimes.com/f/newsletter/QL71Mg_E-nLGjG-eAqBKTA~~/AAAAARA~/[REDACTED-HASH_2]maKt1NkdKNfPDz6j_C5fswPqM8PTAaGl1JYcSze_xCrzXczOfWNWz4qO7aPl0yculJoJ7znHZtJddnOwy3pGlq-XW40MoAP-BuPz8Pdd06R36C9Ilrec7w7sW8NT7vPfScwsEUkD0hKeIQJaDR0n6JVGj6zCekdp1EoEw0Y0ylbQ9PU-jVNJpwxkXhrnAPWrpZGu0Mfahd21u6go8-g20vGlkRFA_EkmAPi_Rj1xqSr7VYNPYUknlesfgGGK9KfPKl37P0rwWJwtBimUzu0iOKfE5ETuzs77P7Z6Jvdr9Pxhlak2TaDBdDySvLWCPdFQDRCdMhgA~" class="css-sdwaa1" style="-webkit-text-decoration:underline;color:#000;text-decoration:none;display:block"><h3 style="color:#000;margin:0;padding:0 0 10px;font:700 20px/27.5px georgia,serif" class="css-w6qq8t">Trump Signs Bill on Release of Epstein Files</h3><p style="color:#333;font:17px/25px georgia,serif;margin:0;margin-bottom:15px">Relenting to pressure from his base, President Trump signed legislation calling on the Justice Department to release its files on Jeffrey Epstein. But the bill contains significant exceptions.</p><span style="display:block;font:17px/25px georgia,serif;font-weight:700;color:#286ed0;margin-top:0;text-decoration:underline" class="css-afkfe3">Read more</span></a>
    `;
    // Note: In the actual email, the URL has newlines due to QP decoding issues.
    // Let's simulate that by injecting newlines in the HREF.
    const htmlWithNewlines = html.replace('QL71Mg', 'QL71Mg\n');
    
    const blocks = convertHtmlToBlockNote(htmlWithNewlines);
    
    const link = blocks.find(b => b.content?.some(c => c.type === 'link' && c.content?.[0]?.text === 'Read more'));
    expect(link).toBeDefined();
  });
});
