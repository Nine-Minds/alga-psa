import TurndownService from 'turndown';

export interface BlockNoteBlock {
  type: string;
  props?: Record<string, any>;
  content?: any[];
  children?: BlockNoteBlock[];
}

export function convertHtmlToBlockNote(html: string): BlockNoteBlock[] {
  if (!html) return [];

  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-'
  });

  const markdown = turndownService.turndown(html);
  return convertMarkdownToBlocks(markdown);
}

function convertMarkdownToBlocks(markdown: string): BlockNoteBlock[] {
  const lines = markdown.split('\n');
  const blocks: BlockNoteBlock[] = [];
  
  let currentCodeBlock: BlockNoteBlock | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Handle code blocks
    if (line.trim().startsWith('```')) {
      if (currentCodeBlock) {
        // End of code block
        blocks.push(currentCodeBlock);
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
      // Code blocks in BlockNote usually have one text item with newlines, or multiple?
      // Looking at the server utils, it seems to map content array to text. 
      // Let's accumulate text.
      const currentText = currentCodeBlock.content?.[0]?.text || '';
      currentCodeBlock.content = [{ 
        type: 'text', 
        text: currentText ? currentText + '\n' + line : line,
        styles: {}
      }];
      continue;
    }

    // Skip empty lines (except potentially as spacers, but BlockNote handles spacing)
    if (!line.trim()) continue;

    // Headings
    if (line.startsWith('#')) {
      const level = line.match(/^#+/)?.[0].length || 1;
      const text = line.substring(level).trim();
      blocks.push({
        type: 'heading',
        props: { level: Math.min(level, 3) }, // BlockNote supports h1-h3
        content: parseInlineStyles(text)
      });
      continue;
    }

    // Unordered List
    if (line.match(/^[\*\-]\s/)) {
      const text = line.substring(2).trim();
      blocks.push({
        type: 'bulletListItem',
        content: parseInlineStyles(text)
      });
      continue;
    }

    // Ordered List
    if (line.match(/^\d+\.\s/)) {
      const text = line.replace(/^\d+\.\s/, '').trim();
      blocks.push({
        type: 'numberedListItem',
        content: parseInlineStyles(text)
      });
      continue;
    }

    // Blockquote (map to paragraph for now, or check if 'blockquote' type exists - usually not in standard BN schema)
    if (line.startsWith('>')) {
      const text = line.substring(1).trim();
      blocks.push({
        type: 'paragraph',
        content: parseInlineStyles(text) // Could add italic style to represent quote
      });
      continue;
    }

    // Image (on its own line)
    // Regex: ![alt](url)
    const imageMatch = line.match(/^!\[(.*?)\]\((.*?)\)$/);
    if (imageMatch) {
      const [_, alt, url] = imageMatch;
      blocks.push({
        type: 'image',
        props: {
          url: url,
          name: alt,
          caption: alt // Optional, but good for accessibility/display
        }
      });
      continue;
    }

    // Paragraph (default)
    blocks.push({
      type: 'paragraph',
      content: parseInlineStyles(line)
    });
  }

  return blocks;
}

function parseInlineStyles(text: string, inheritedStyles: Record<string, boolean> = {}): any[] {
  const content: any[] = [];
  let remaining = text;

  // Regex for tokens: **bold**, *italic*, [link](url), ![image](url)
  // Added image detection to avoid parsing ![alt](url) as a link [alt](url) with a preceding !
  // Note: BlockNote doesn't support inline images well in text blocks, so we'll convert inline images to links for now.
  const tokenRegex = /(\*\*(.*?)\*\*)|(\*(.*?)\*)|(!?\[(.*?)\]\((.*?)\))/;

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
    // 5: [link](url) OR ![image](url) (6: text/alt, 7: url)
    const [fullMatch, _bold, boldText, _italic, italicText, linkOrImageGroup, linkText, linkUrl] = match;

    if (boldText !== undefined) {
      const innerContent = parseInlineStyles(boldText, { ...inheritedStyles, bold: true });
      content.push(...innerContent);
    } else if (italicText !== undefined) {
      const innerContent = parseInlineStyles(italicText, { ...inheritedStyles, italic: true });
      content.push(...innerContent);
    } else if (linkOrImageGroup) {
      // Check if it's an image (starts with !)
      if (linkOrImageGroup.startsWith('!')) {
        // Convert inline image to a link with an image icon/indicator in text
        content.push({ 
          type: 'link', 
          href: linkUrl, 
          content: [{ type: 'text', text: `🖼️ ${linkText || 'Image'}`, styles: { ...inheritedStyles } }] 
        });
      } else {
        // Regular link
        const innerContent = parseInlineStyles(linkText, { ...inheritedStyles });
        content.push({ 
          type: 'link', 
          href: linkUrl, 
          content: innerContent 
        });
      }
    }

    remaining = remaining.substring(index + fullMatch.length);
  }

  return content;
}
