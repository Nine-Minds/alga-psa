// Pure-JS markdown → BlockNote block conversion. Kept in its own module so
// server code that only needs this lightweight path (e.g. API route handlers
// creating KB articles) does not pull `@blocknote/server-util` — and its
// jsdom + Tiptap + React subgraph — into the webpack server graph.

export interface BlockNoteBlock {
  type: string;
  props?: Record<string, any>;
  content?: any[];
  children?: BlockNoteBlock[];
}

function sanitizeUrl(url: string): string {
  if (!url) return '';
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

    if (line.trim().startsWith('```')) {
      if (currentCodeBlock) {
        const target = currentBlockLink ? currentBlockLink.blocks : blocks;
        target.push(currentCodeBlock);
        currentCodeBlock = null;
      } else {
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
      const currentText = currentCodeBlock.content?.[0]?.text || '';
      currentCodeBlock.content = [{
        type: 'text',
        text: currentText ? currentText + '\n' + line : line,
        styles: {}
      }];
      continue;
    }

    // Turndown-style block links:
    //   [
    //   ### Header
    //   text](url)
    if (line.trim() === '[') {
      currentBlockLink = { blocks: [] };
      continue;
    }

    if (currentBlockLink) {
      const endMatch = line.match(/^\s*(.*)\]\((.*?)\)\s*$/);
      if (endMatch) {
        const text = endMatch[1];
        const url = endMatch[2];

        if (text.trim()) {
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
          blocks.push(...currentBlockLink.blocks);
        }

        currentBlockLink = null;
        continue;
      }
    }

    if (!line.trim()) continue;

    const targetBlocks = currentBlockLink ? currentBlockLink.blocks : blocks;

    if (line.startsWith('#')) {
      const level = line.match(/^#+/)?.[0].length || 1;
      const text = line.substring(level).trim();
      targetBlocks.push({
        type: 'heading',
        props: { level: Math.min(level, 3) },
        content: parseInlineStyles(text)
      });
      continue;
    }

    if (line.match(/^\s*[\*\-]\s/)) {
      const text = line.replace(/^\s*[\*\-]\s/, '').trim();
      targetBlocks.push({
        type: 'bulletListItem',
        content: parseInlineStyles(text)
      });
      continue;
    }

    if (line.match(/^\s*\d+\.\s/)) {
      const text = line.replace(/^\s*\d+\.\s/, '').trim();
      targetBlocks.push({
        type: 'numberedListItem',
        content: parseInlineStyles(text)
      });
      continue;
    }

    if (line.startsWith('>')) {
      const text = line.substring(1).trim();
      targetBlocks.push({
        type: 'paragraph',
        content: parseInlineStyles(text)
      });
      continue;
    }

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
            caption: alt
          }
        });
      } else {
        targetBlocks.push({
          type: 'paragraph',
          content: parseInlineStyles(`![${alt}](${url})`)
        });
      }
      continue;
    }

    // Split image syntax wrapped by email clients:
    //   ![alt]
    //   (url)
    const splitImageStart = line.match(/^\s*!\[(.*?)\]\s*$/);
    if (splitImageStart && i + 1 < lines.length) {
      const nextLine = lines[i + 1].trim();
      if (nextLine.startsWith('(') && nextLine.endsWith(')')) {
        const alt = splitImageStart[1];
        const url = nextLine.slice(1, -1);

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
        i++;
        continue;
      }
    }

    // Split link syntax wrapped by email clients / long URLs
    const splitLinkMatch = line.match(/(!?\[.*?\]\([^\)]+)$/);
    if (splitLinkMatch) {
      let merged = false;

      while (i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();

        if (nextLine.match(/^!?\[/)) {
          break;
        }

        lines[i] = lines[i].trimEnd() + nextLine;
        lines.splice(i + 1, 1);

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

    targetBlocks.push({
      type: 'paragraph',
      content: parseInlineStyles(line)
    });
  }

  return blocks;
}

function applyLinkToBlock(block: BlockNoteBlock, url: string) {
  if (block.content && Array.isArray(block.content)) {
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

  // 1. **bold**  2. *italic*  3. _italic_
  // 4. [![alt](src)](href)  5. [text](url) / ![alt](url)
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

    if (index > 0) {
      content.push({
        type: 'text',
        text: remaining.substring(0, index),
        styles: { ...inheritedStyles }
      });
    }

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
      // linkedImageUrl is intentionally unused; the image is rendered as a text placeholder.
      void linkedImageUrl;

      if (safeLinkUrl) {
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
          const innerContent = parseInlineStyles(linkText, { ...inheritedStyles });
          content.push(...innerContent);
        }
      }
    }

    remaining = remaining.substring(index + fullMatch.length);
  }

  return content;
}
