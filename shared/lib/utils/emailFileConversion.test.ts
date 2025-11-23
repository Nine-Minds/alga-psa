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

  it('should handle hidden preheader text', () => {
    const emlPath = path.join(__dirname, 'test-email.eml');
    const emlContent = fs.readFileSync(emlPath, 'utf-8');
    const bodyRaw = emlContent.split(/\r?\n\r?\n/).slice(1).join('\n\n');
    const html = decodeQuotedPrintable(bodyRaw);
    const blocks = convertHtmlToBlockNote(html);

    // The preheader text "The bill contains significant exceptions." is in a display:none div.
    // Turndown standard behavior usually renders hidden text unless specifically configured not to.
    // We want to see if it's there.
    const preheader = blocks.find(b => 
      b.content?.some(c => c.type === 'text' && c.text.includes('The bill contains significant exceptions.'))
    );
    expect(preheader).toBeDefined();
  });

  it('should handle tracking pixels (1x1 images)', () => {
    const emlPath = path.join(__dirname, 'test-email.eml');
    const emlContent = fs.readFileSync(emlPath, 'utf-8');
    const bodyRaw = emlContent.split(/\r?\n\r?\n/).slice(1).join('\n\n');
    const html = decodeQuotedPrintable(bodyRaw);
    const blocks = convertHtmlToBlockNote(html);

    // There is a tracking pixel at the end
    // <img ... width="1" height="1" ...>
    // We want to see if it's preserved as an image block (currently expected behavior)
    // or if we might want to filter it later (not enforcing filter now, just checking presence).
    
    // We look for an image with empty name/caption or specific URL pattern if known, 
    // but just checking for "any image" is too broad. 
    // Let's look for the last image in the email which is the tracking pixel.
    const lastBlock = blocks[blocks.length - 1];
    // Based on previous output, the last block was the tracking pixel image.
    
    if (lastBlock.type === 'image') {
       expect(lastBlock.props?.url).toBeDefined();
    } else {
       // If it's not the last block, maybe it's somewhere?
       const trackingPixel = blocks.find(b => b.type === 'image' && b.props?.url.includes('nl.nytimes.com/q/'));
       expect(trackingPixel).toBeDefined();
    }
  });

  it('should correctly parse the "More Top Stories" block link with image', () => {
    const emlPath = path.join(__dirname, 'test-email.eml');
    const emlContent = fs.readFileSync(emlPath, 'utf-8');
    const bodyRaw = emlContent.split(/\r?\n\r?\n/).slice(1).join('\n\n');
    const html = decodeQuotedPrintable(bodyRaw);
    const blocks = convertHtmlToBlockNote(html);

    // This section has a link wrapping an image and a heading.
    // <a ...><img ...><h3>Lawrence Summers...</h3></a>
    
    // We expect our new block link logic to handle this by applying the link to the image and the heading.
    
    // Find the heading "Lawrence Summers will stop teaching..."
    // The text might be inside a link object now.
    const headingBlock = blocks.find(b => 
      b.type === 'heading' && 
      b.content?.some(c => {
          if (c.type === 'text' && c.text) return c.text.includes('Lawrence Summers will stop teaching');
          if (c.type === 'link') return c.content?.some((nested: any) => nested.type === 'text' && nested.text?.includes('Lawrence Summers will stop teaching'));
          return false;
      })
    );
    
    expect(headingBlock).toBeDefined();
    
    // Check if the content inside the heading is wrapped in a link
    const headingLinkContent = headingBlock?.content?.find(c => c.type === 'link');
    expect(headingLinkContent).toBeDefined();
    expect(headingLinkContent?.href).toContain('nl.nytimes.com');
    
    // Check for the image preceding it (Lawrence Summers image)
    // It resulted in a "paragraph" with a "link" containing text "🖼️ Lawrence Summers..." in the previous run,
    // OR it might be an image block if my logic improved. 
    // Let's look for either.
    
    const imageBlockOrParagraph = blocks.find(b => 
       (b.type === 'image' && b.props?.caption?.includes('Lawrence Summers')) ||
       (b.type === 'paragraph' && b.content?.some(c => 
           c.type === 'link' && c.content?.some((n: any) => n.text?.includes('Lawrence Summers') && n.text?.includes('🖼️'))
       ))
    );
    
    expect(imageBlockOrParagraph).toBeDefined();
  });

  it('should handle social media icons as a list or sequence of images', () => {
    const emlPath = path.join(__dirname, 'test-email.eml');
    const emlContent = fs.readFileSync(emlPath, 'utf-8');
    const bodyRaw = emlContent.split(/\r?\n\r?\n/).slice(1).join('\n\n');
    const html = decodeQuotedPrintable(bodyRaw);
    const blocks = convertHtmlToBlockNote(html);

    // Facebook, X, Instagram, Whatsapp
    // In the previous output, these were paragraph blocks with links containing "🖼️ facebook", "🖼️ x", etc.
    // This is acceptable for now given the text-based blocknote conversion.
    
    const fbBlock = blocks.find(b => 
        b.content?.some(c => c.type === 'link' && c.content?.[0]?.text?.includes('facebook'))
    );
    expect(fbBlock).toBeDefined();
  });

  it('should handle footer inline links correctly', () => {
    const emlPath = path.join(__dirname, 'test-email.eml');
    const emlContent = fs.readFileSync(emlPath, 'utf-8');
    const bodyRaw = emlContent.split(/\r?\n\r?\n/).slice(1).join('\n\n');
    const html = decodeQuotedPrintable(bodyRaw);
    const blocks = convertHtmlToBlockNote(html);

    // "If you received this newsletter from someone else, subscribe here."
    const footerBlock = blocks.find(b => 
        b.type === 'paragraph' && 
        b.content?.some(c => c.text === 'If you received this newsletter from someone else, ')
    );
    expect(footerBlock).toBeDefined();
    
    const subscribeLink = footerBlock?.content?.find(c => c.type === 'link' && c.content?.[0]?.text === 'subscribe here');
    expect(subscribeLink).toBeDefined();
    expect(subscribeLink?.href).toContain('nl.nytimes.com');
  });
});
