import TurndownService from 'turndown';

export interface BlockNoteBlock {
  type: string;
  props?: Record<string, any>;
  content?: any[];
  children?: BlockNoteBlock[];
}

export function convertHtmlToBlockNote(html: string): BlockNoteBlock[] {
  if (!html) return [];

  // Preprocess HTML to strip newlines from href attributes which break markdown generation
  const cleanHtml = html.replace(/href="([^"]*)"/g, (match, url) => {
    return `href="${url.replace(/[\r\n]+/g, '')}"`;
  });

  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '_',
    strongDelimiter: '**'
  });

  const markdown = turndownService.turndown(cleanHtml);
  return convertMarkdownToBlocks(markdown);
}

function sanitizeUrl(url: string): string {
  if (!url) return '';
  // Allow http, https, mailto, and relative paths (though emails usually have absolute)
  // Block javascript:, data:, vbscript:
  if (/^(javascript:|data:|vbscript:)/i.test(url)) {
    return '';
  }
  return url;
}

export function convertMarkdownToBlocks(markdown: string): BlockNoteBlock[] {
  const lines = markdown.split('\n');
  const blocks: BlockNoteBlock[] = [];
  
  let currentCodeBlock: BlockNoteBlock | null = null;
  let currentBlockLink: { blocks: BlockNoteBlock[] } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Handle code blocks
    if (line.trim().startsWith('```')) {
      if (currentCodeBlock) {
        // End of code block
        // Code blocks cannot be inside block links in this simple parser, 
        // or we just push to target
        const target = currentBlockLink ? currentBlockLink.blocks : blocks;
        target.push(currentCodeBlock);
        currentCodeBlock = null;
      } else {
        // Start of code block
        const language = line.trim().substring(3);
        currentCodeBlock = {
          type: 'codeBlock',
          props: { language },
          content: []
        };
      }
      continue;
    }

    if (currentCodeBlock) {
      // Add line to code block content
      const currentText = currentCodeBlock.content?.[0]?.text || '';
      currentCodeBlock.content = [{
        type: 'text', 
        text: currentText ? currentText + '\n' + line : line,
        styles: {}
      }];
      continue;
    }

    // START Block Link Detection
    // Turndown produces block links like:
    // [
    // ### Header
    // Description
    // Last line](url)
    if (line.trim() === '[') {
        currentBlockLink = { blocks: [] };
        continue;
    }

    if (currentBlockLink) {
        // Check for end of block link: text](url)
        // We use a regex that looks for the closing pattern.
        // Note: we need to be careful not to match [text](url) which is a self-contained link,
        // but in the block link case, the line usually does NOT start with [.
        // However, if the text content inside the block link starts with [, it might be tricky.
        // But Turndown escapes [ in text.
        
        const endMatch = line.match(/^\s*(.*)\]\((.*?)\)\s*$/);
        if (endMatch) {
             const text = endMatch[1];
             const url = endMatch[2];
             
             // Process the last line content if it exists
             if (text.trim()) {
                 // We can use recursion to parse this last line as it might contain inline styles
                 const tempBlocks = convertMarkdownToBlocks(text);
                 currentBlockLink.blocks.push(...tempBlocks);
             }
             
             const safeUrl = sanitizeUrl(url);
             if (safeUrl) {
                 for (const b of currentBlockLink.blocks) {
                     applyLinkToBlock(b, safeUrl);
                     blocks.push(b);
                 }
             } else {
                 // Invalid URL, just push blocks as is
                 blocks.push(...currentBlockLink.blocks);
             }
             
             currentBlockLink = null;
             continue;
        }
    }
    // END Block Link Detection

    // Skip empty lines (except potentially as spacers, but BlockNote handles spacing)
    if (!line.trim()) continue;

    // Define target for new blocks
    const targetBlocks = currentBlockLink ? currentBlockLink.blocks : blocks;

    // Headings
    if (line.startsWith('#')) {
      const level = line.match(/^#+/)?.[0].length || 1;
      const text = line.substring(level).trim();
      targetBlocks.push({
        type: 'heading',
        props: { level: Math.min(level, 3) }, // BlockNote supports h1-h3
        content: parseInlineStyles(text)
      });
      continue;
    }

    // Unordered List
    if (line.match(/^\s*[\*\-]\s/)) {
      const text = line.replace(/^\s*[\*\-]\s/, '').trim();
      const targetBlocks = currentBlockLink ? currentBlockLink.blocks : blocks;
      targetBlocks.push({
        type: 'bulletListItem',
        content: parseInlineStyles(text)
      });
      continue;
    }

    // Ordered List
    if (line.match(/^\s*\d+\.\s/)) {
      const text = line.replace(/^\s*\d+\.\s/, '').trim();
      const targetBlocks = currentBlockLink ? currentBlockLink.blocks : blocks;
      targetBlocks.push({
        type: 'numberedListItem',
        content: parseInlineStyles(text)
      });
      continue;
    }

    // Blockquote (map to paragraph for now, or check if 'blockquote' type exists - usually not in standard BN schema)
    if (line.startsWith('>')) {
      const text = line.substring(1).trim();
      targetBlocks.push({
        type: 'paragraph',
        content: parseInlineStyles(text) // Could add italic style to represent quote
      });
      continue;
    }

    // Image (on its own line)
    // Regex: ![alt](url)
    const imageMatch = line.match(/^\s*!\[(.*?)\]\((.*?)\)\s*$/);
    if (imageMatch) {
      const [_, alt, url] = imageMatch;
      const safeUrl = sanitizeUrl(url);
      if (safeUrl) {
        targetBlocks.push({
          type: 'image',
          props: {
            url: safeUrl,
            name: alt,
            caption: alt // Optional, but good for accessibility/display
          }
        });
      } else {
        // If invalid URL, render as text
        targetBlocks.push({
          type: 'paragraph',
          content: parseInlineStyles(`![${alt}](${url})`)
        });
      }
      continue;
    }

    // Handle split image syntax (e.g. wrapped by email client):
    // Line 1: ![alt]
    // Line 2: (url)
    const splitImageStart = line.match(/^\s*!\[(.*?)\]\s*$/);
    if (splitImageStart && i + 1 < lines.length) {
      const nextLine = lines[i+1].trim();
      // Check if next line is (url)
      // Note: nextLine might contain parens inside, so just check start/end
      if (nextLine.startsWith('(') && nextLine.endsWith(')')) {
        const alt = splitImageStart[1];
        const url = nextLine.slice(1, -1); // remove outer parens
        
        const safeUrl = sanitizeUrl(url);
        if (safeUrl) {
          targetBlocks.push({
            type: 'image',
            props: {
              url: safeUrl,
              name: alt,
              caption: alt
            }
          });
        } else {
           targetBlocks.push({
            type: 'paragraph',
            content: parseInlineStyles(`![${alt}](${url})`)
          });
        }
        i++; // Skip next line
        continue;
      }
    }

    // Handle split link syntax (e.g. wrapped by email client or long URLs):
    // Line 1: ... [text](part_of_url
    // Line 2: part_of_url
    // Line 3: rest_of_url)
    const splitLinkMatch = line.match(/(!?\[.*?\]\([^\)]+)$/);
    if (splitLinkMatch) {
        let merged = false;
        
        // Attempt to merge subsequent lines until we find the closing parenthesis
        while (i + 1 < lines.length) {
            const nextLine = lines[i+1].trim();
            
            // Safety check: don't merge if next line looks like a new image/link start
            if (nextLine.match(/^!?\[/)) {
              break;
            }

            lines[i] = lines[i].trimEnd() + nextLine; // Merge
            lines.splice(i + 1, 1); // Remove next line from array
            
            if (nextLine.includes(')')) {
                merged = true;
                break;
            }
        }
        
        if (merged) {
             i--; 
             continue;
        }
    }

    // Paragraph (default)
    targetBlocks.push({
      type: 'paragraph',
      content: parseInlineStyles(line)
    });
  }

  return blocks;
}

function applyLinkToBlock(block: BlockNoteBlock, url: string) {
  if (block.content && Array.isArray(block.content)) {
      // If content already has a link, we generally shouldn't wrap it again.
      // But for simplicity, we wrap the whole content in a link if no link exists,
      // or if a link exists, we might just skip or try to wrap non-linked parts (too complex).
      // Let's assume no nested links for now.
      
      const hasLink = block.content.some((c: any) => c.type === 'link');
      if (!hasLink) {
         block.content = [{
             type: 'link',
             href: url,
             content: block.content
         }];
      }
  }
  
  if (block.children) {
      block.children.forEach(child => applyLinkToBlock(child, url));
  }
}

function parseInlineStyles(text: string, inheritedStyles: Record<string, boolean> = {}): any[] {
  const content: any[] = [];
  let remaining = text;

  // Regex for tokens:
  // 1. **bold**
  // 2. *italic*
  // 3. _italic_
  // 4. Linked Image: [![alt](src)](href)
  // 5. Regular Link or Image: [text](url) or ![alt](url)
  const tokenRegex = /(\*\*(.*?)\*\*)|(\*(.*?)\*)|(_(.*?)_)|(\[!\[(.*?)\]\((.*?)\)\]\((.*?)\))|(!?\[(.*?)\]\((.*?)\))/;

  while (remaining) {
    const match = remaining.match(tokenRegex);
    
    if (!match) {
      if (remaining) {
        content.push({ 
          type: 'text', 
          text: remaining, 
          styles: { ...inheritedStyles } 
        });
      }
      break;
    }

    const index = match.index!;
    
    // Add text before match
    if (index > 0) {
      content.push({ 
        type: 'text', 
        text: remaining.substring(0, index), 
        styles: { ...inheritedStyles } 
      });
    }

    // Process match
    // Groups:
    // 1: **bold** (2: content)
    // 3: *italic* (4: content)
    // 5: _italic_ (6: content)
    // 7: Linked Image (8: alt, 9: image url, 10: link url)
    // 11: Link/Image (12: text/alt, 13: url)
    const [
      fullMatch, 
      _bold, boldText, 
      _italicStar, italicStarText, 
      _italicUnderscore, italicUnderscoreText, 
      linkedImageGroup, linkedImageAlt, linkedImageUrl, linkedLinkUrl,
      linkOrImageGroup, linkText, linkUrl
    ] = match;

    if (boldText !== undefined) {
      const innerContent = parseInlineStyles(boldText, { ...inheritedStyles, bold: true });
      content.push(...innerContent);
    } else if (italicStarText !== undefined) {
      const innerContent = parseInlineStyles(italicStarText, { ...inheritedStyles, italic: true });
      content.push(...innerContent);
    } else if (italicUnderscoreText !== undefined) {
      const innerContent = parseInlineStyles(italicUnderscoreText, { ...inheritedStyles, italic: true });
      content.push(...innerContent);
    } else if (linkedImageGroup) {
       const safeLinkUrl = sanitizeUrl(linkedLinkUrl);
       const safeImageUrl = sanitizeUrl(linkedImageUrl);

       if (safeLinkUrl) {
         // Link containing an image representation
         content.push({
           type: 'link',
           href: safeLinkUrl,
           content: [{ 
             type: 'text', 
             text: `🖼️ ${linkedImageAlt || 'Image'}`, 
             styles: { ...inheritedStyles } 
            }]
         });
       } else {
         // Invalid link URL, maybe just show the image representation or text?
         // Let's fallback to text
         content.push({
           type: 'text',
           text: fullMatch,
           styles: { ...inheritedStyles }
         });
       }
    } else if (linkOrImageGroup) {
      const safeUrl = sanitizeUrl(linkUrl);
      
      if (linkOrImageGroup.startsWith('!')) {
        if (safeUrl) {
          content.push({ 
            type: 'link', 
            href: safeUrl, 
            content: [{ type: 'text', text: `🖼️ ${linkText || 'Image'}`, styles: { ...inheritedStyles } }] 
          });
        } else {
          // Invalid URL, render as text
          content.push({ 
            type: 'text', 
            text: fullMatch, 
            styles: { ...inheritedStyles } 
          });
        }
      } else {
        if (safeUrl) {
          const innerContent = parseInlineStyles(linkText, { ...inheritedStyles });
          content.push({ 
            type: 'link', 
            href: safeUrl, 
            content: innerContent 
          });
        } else {
          // Invalid URL, render link text without link
          const innerContent = parseInlineStyles(linkText, { ...inheritedStyles });
          content.push(...innerContent);
        }
      }
    }

    remaining = remaining.substring(index + fullMatch.length);
  }

  return content;
}