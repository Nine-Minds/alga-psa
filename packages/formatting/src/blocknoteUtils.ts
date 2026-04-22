import type { Block, PartialBlock } from '@blocknote/core';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Debug sentinel strings returned by the conversion helpers when they can't
// extract anything meaningful from the input. We never want these surfaced to
// end users (e.g. in email bodies) — treat their presence as "effectively
// empty" and let callers render their own fallback.
const DEBUG_SENTINELS = [
  '[No content]',
  '[Invalid content format]',
  '[Invalid content format - not an array]',
  '[Content could not be converted to markdown]',
];

function stripDebugSentinels(value: string): string {
  let result = value;
  for (const sentinel of DEBUG_SENTINELS) {
    result = result.split(sentinel).join('');
  }
  return result;
}

function isEffectivelyEmpty(html: string, text: string): boolean {
  const cleanedHtml = stripDebugSentinels(html).replace(/<[^>]*>/g, '').trim();
  const cleanedText = stripDebugSentinels(text).trim();
  return cleanedHtml.length === 0 && cleanedText.length === 0;
}

export function formatBlockNoteContent(content: unknown): { html: string; text: string } {
  if (content === null || content === undefined) {
    return { html: '', text: '' };
  }

  const convertSafely = (input: any): { html: string; text: string } => {
    try {
      const htmlResult = convertBlockNoteToHTML(input);
      const textResult = convertBlockNoteToMarkdown(input);

      if (!isEffectivelyEmpty(htmlResult || '', textResult || '')) {
        return { html: htmlResult, text: textResult };
      }
      return { html: '', text: '' };
    } catch (error) {
      console.warn('[BlockNoteUtils] Failed to convert BlockNote content, falling back to plain text', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    const fallback = typeof input === 'string' ? input : JSON.stringify(input);
    return {
      html: `<p>${escapeHtml(fallback)}</p>`,
      text: fallback,
    };
  };

  if (typeof content === 'string') {
    const trimmed = content.trim();
    if (trimmed.length === 0) {
      return { html: '', text: '' };
    }
    try {
      const parsed = JSON.parse(content);
      return convertSafely(parsed);
    } catch {
      return {
        html: `<p>${escapeHtml(content)}</p>`,
        text: content,
      };
    }
  }

  return convertSafely(content);
}

/**
 * Converts BlockNote JSON content to Markdown format
 *
 * This function uses a custom implementation to convert blocks to markdown.
 * It handles various block types including paragraphs, headings, tables, lists, etc.
 *
 * @param blocks - BlockNote content as Block array, PartialBlock array, JSON string, or undefined
 * @returns A string containing the markdown representation, never undefined
 */
export function convertBlockNoteToMarkdown(blocks: any): string {
  console.log("[BlockNoteUtils] Converting to markdown:", typeof blocks === 'string' ? 'JSON string' : (blocks ? 'blocks array' : 'undefined'));

  // Handle empty input
  if (!blocks) {
    return "[No content]";
  }

  // Parse JSON string if needed
  let blockData: Block[] | PartialBlock[];
  if (typeof blocks === 'string') {
    try {
      blockData = JSON.parse(blocks);
    } catch (e) {
      console.error("[BlockNoteUtils] Failed to parse BlockNote JSON string:", e);
      return "[Invalid content format]";
    }
  } else {
    blockData = blocks;
  }

  // Try conversion methods in sequence and use the first one that works
  let markdown: string = "";

  // 1. Try custom converter first
  try {
    markdown = customBlocksToMarkdown(blockData);
    if (markdown && markdown.trim() !== '') {
      return markdown;
    }
  } catch (customError) {
    console.error("[BlockNoteUtils] Custom markdown conversion failed:", customError);
  }

  // 2. If custom converter failed, try simple text extraction
  try {
    markdown = simpleTextExtraction(blockData);
    if (markdown && markdown.trim() !== '') {
      return markdown;
    }
  } catch (error) {
    console.error("[BlockNoteUtils] Simple text extraction failed:", error);
  }

  // 3. Last resort - extract any text we can find
  try {
    const extractedText = extractRawText(blockData);
    if (extractedText && extractedText.trim() !== '') {
      return extractedText;
    }
  } catch (error) {
    console.error("[BlockNoteUtils] Direct text extraction failed:", error);
  }

  // Absolute last resort
  return "[Content could not be converted to markdown]";
}

/**
 * Extract raw text from blocks as a last resort
 *
 * This function recursively searches through the block structure
 * to find any text content that can be extracted.
 *
 * @param blocks - The blocks to extract text from
 * @returns The extracted text as a string
 */
function extractRawText(blocks: Block[] | PartialBlock[]): string {
  const textParts: string[] = [];

  try {
    // Recursively search for text in the block structure
    const extractTextFromObject = (obj: any): void => {
      if (!obj) return;

      if (typeof obj === 'string') {
        textParts.push(obj);
      } else if (Array.isArray(obj)) {
        obj.forEach(item => extractTextFromObject(item));
      } else if (typeof obj === 'object') {
        // Look for text property
        if (obj.text && typeof obj.text === 'string') {
          textParts.push(obj.text);
        }

        // Look for content property
        if (obj.content) {
          extractTextFromObject(obj.content);
        }

        // Recursively check all properties
        Object.values(obj).forEach(value => {
          if (typeof value === 'object' || Array.isArray(value)) {
            extractTextFromObject(value);
          }
        });
      }
    };

    extractTextFromObject(blocks);
    return textParts.join('\n').trim();
  } catch (error) {
    console.error("[BlockNoteUtils] Error in extractRawText:", error);
    return "";
  }
}

/**
 * Simple text extraction as a fallback method
 *
 * This function extracts text from blocks in a straightforward way,
 * handling different content types.
 *
 * @param blocks - The blocks to extract text from
 * @returns The extracted text as a string
 */
function simpleTextExtraction(blocks: Block[] | PartialBlock[]): string {
  return blocks
    .map(block => {
      if (!block.content) return '';

      if (typeof block.content === 'string') {
        return block.content;
      }

      if (Array.isArray(block.content)) {
        return block.content
          .filter((item: any) => item && item.type === 'text')
          .map((item: any) => item.text || '')
          .join('');
      }

      if (typeof block.content === 'object' && block.content !== null) {
        return JSON.stringify(block.content);
      }

      return '';
    })
    .filter(text => text.trim() !== '')
    .join('\n\n');
}

/**
 * Extract styled text content from block content array
 *
 * This function processes text with styles and converts them to markdown/HTML
 *
 * @param content - The content array to extract styled text from
 * @returns The extracted text with styling as a string
 */
function extractStyledTextFromContent(content: any[]): string {
  if (!Array.isArray(content)) return '';

  if (content.length === 0) {
    // Return a non-breaking space for empty content to preserve the paragraph
    return '';
  }

  return content
    .filter((item: any) => item && (item.type === 'text' || item.type === 'mention' || item.type === 'link'))
    .map((item: any) => {
      // Handle link inline content
      if (item.type === 'link') {
        const href = item.href || '';
        const linkText = Array.isArray(item.content)
          ? item.content
              .filter((c: any) => c.type === 'text')
              .map((c: any) => c.text || '')
              .join('')
          : '';
        return `[${linkText}](${href})`;
      }

      // Handle mention inline content
      if (item.type === 'mention') {
        const { userId, username, displayName } = item.props || {};
        const displayText = username ? `@${username}` : `@[${displayName || 'Unknown'}]`;
        return displayText;
      }

      // Handle text inline content
      if (!item.text && item.text !== '') return '';

      // Ensure item.text is a string
      if (typeof item.text !== 'string') {
        console.warn('[BlockNoteUtils] item.text is not a string in extractStyledTextFromContent:', typeof item.text, item);
        return '';
      }

      let result = item.text;

      // Apply styling if present
      if (item.styles) {
        // Bold
        if (item.styles.bold) {
          result = `**${result}**`;
        }

        // Italic
        if (item.styles.italic) {
          result = `*${result}*`;
        }

        // Underline - using HTML since markdown doesn't have underline
        if (item.styles.underline) {
          result = `<u>${result}</u>`;
        }

        // Text color
        if (item.styles.textColor && item.styles.textColor !== 'default') {
          result = `<span style="color:${item.styles.textColor}">${result}</span>`;
        }

        // Background color
        if (item.styles.backgroundColor && item.styles.backgroundColor !== 'default') {
          result = `<span style="background-color:${item.styles.backgroundColor}">${result}</span>`;
        }
      }

      return result;
    })
    .join('');
}

/**
 * Custom function to convert blocks to markdown format
 *
 * This handles various block types including paragraphs, headings,
 * tables, lists, and code blocks.
 *
 * @param blocks - The blocks to convert to markdown
 * @returns The markdown representation as a string
 */
function customBlocksToMarkdown(blocks: Block[] | PartialBlock[]): string {
  return blocks.map((block) => {
    // Check for block-level styling (like paragraph background color)
    let blockWrapper = (content: string): string => content;

    if (block.props) {
      const props = block.props as any;

      // Handle block background color
      if (props.backgroundColor && props.backgroundColor !== 'default') {
        blockWrapper = (content: string) =>
          `<div style="background-color:${props.backgroundColor}">${content}</div>`;
      }

      // Handle text alignment
      if (props.textAlignment && props.textAlignment !== 'left') {
        const alignStyle = props.textAlignment === 'center' ? 'center' :
                          (props.textAlignment === 'right' ? 'right' : 'justify');

        const prevWrapper = blockWrapper;
        blockWrapper = (content: string) =>
          prevWrapper(`<div style="text-align:${alignStyle}">${content}</div>`);
      }
    }

    // Handle different block types
    let content = '';

    switch (block.type) {
      case 'paragraph':
        // Handle empty paragraphs explicitly
        if (!block.content || !Array.isArray(block.content) || block.content.length === 0) {
          // Use a single space instead of &nbsp; for better compatibility with markdown parsers
          return blockWrapper(' ');
        }
        content = extractStyledTextFromContent(block.content);
        return blockWrapper(content);

      case 'heading':
        if (block.content && Array.isArray(block.content)) {
          const level = (block.props as any)?.level || 1;
          const prefix = '#'.repeat(level) + ' ';
          content = prefix + extractStyledTextFromContent(block.content);
          return blockWrapper(content);
        }
        break;

      case 'table':
        return convertTableToMarkdown(block);

      case 'numberedListItem':
        if (block.content && Array.isArray(block.content)) {
          content = `1. ${extractStyledTextFromContent(block.content)}`;
          return blockWrapper(content);
        }
        break;

      case 'bulletListItem':
        if (block.content && Array.isArray(block.content)) {
          content = `* ${extractStyledTextFromContent(block.content)}`;
          return blockWrapper(content);
        }
        break;

      case 'checkListItem':
        if (block.content && Array.isArray(block.content)) {
          const checked = (block.props as any)?.checked ? 'x' : ' ';
          content = `- [${checked}] ${extractStyledTextFromContent(block.content)}`;
          return blockWrapper(content);
        }
        break;

      case 'codeBlock':
        if (block.content && Array.isArray(block.content)) {
          const language = (block.props as any)?.language || '';
          content = '```' + language + '\n' + extractStyledTextFromContent(block.content) + '\n```';
          return blockWrapper(content);
        }
        break;

      case 'image': {
        const props = (block.props as any) || {};
        const url = typeof props.url === 'string' ? props.url.trim() : '';
        if (!url) {
          return '';
        }
        const alt = typeof props.caption === 'string' && props.caption.trim().length > 0
          ? props.caption.trim()
          : typeof props.name === 'string'
            ? props.name.trim()
            : 'clipboard-image';
        return `![${alt}](${url})`;
      }

      default:
        // Unknown block type
        console.log(`[BlockNoteUtils] Unknown block type: ${block.type}`);
        return '';
    }

    return '';
  }).join('\n\n'); // Don't filter empty strings to preserve empty paragraphs
}

/**
 * Converts a table block to markdown format with styling support
 *
 * @param block - The table block to convert
 * @returns The markdown representation of the table
 */
function convertTableToMarkdown(block: Block | PartialBlock): string {
  try {
    const content = block.content as any;

    // Validate table structure
    if (!content || typeof content !== 'object' || !content.rows) {
      return '[Invalid table structure]';
    }

    const rows = content.rows || [];
    if (rows.length === 0) {
      return '';
    }

    // Determine the number of columns from the first row
    const numCols = rows[0].cells ? rows[0].cells.length : 0;
    if (numCols === 0) {
      return '';
    }

    // Build the markdown table
    let markdown = '';

    // Process each row
    rows.forEach((row: any, rowIndex: number) => {
      const cells = row.cells || [];

      // Add cells for this row
      let rowMarkdown = '|';
      for (let colIndex = 0; colIndex < numCols; colIndex++) {
        const cell = cells[colIndex] || [];
        let cellText = ' ';

        // Extract styled text from cell content
        if (Array.isArray(cell)) {
          // Use our styled text extraction function
          cellText = extractStyledTextFromContent(cell);

          // If cell is empty, use a space to maintain table structure
          if (!cellText || cellText.trim() === '') {
            cellText = ' ';
          }
        }

        rowMarkdown += ` ${cellText} |`;
      }
      markdown += rowMarkdown + '\n';

      // Add separator row after the header
      if (rowIndex === 0) {
        let separator = '|';
        for (let i = 0; i < numCols; i++) {
          separator += ' --- |';
        }
        markdown += separator + '\n';
      }
    });

    // Apply any block-level styling to the table
    if (block.props) {
      const props = block.props as any;

      // Handle block background color
      if (props.backgroundColor && props.backgroundColor !== 'default') {
        markdown = `<div style="background-color:${props.backgroundColor}">\n${markdown}\n</div>`;
      }
    }

    return markdown;
  } catch (error) {
    console.error("[BlockNoteUtils] Error converting table to markdown:", error);
    return '[Table conversion error]';
  }
}

/**
 * Extracts styled text content from block content array and converts to HTML
 *
 * @param content - The content array to extract styled text from
 * @returns The extracted text with styling as an HTML string
 */
function extractStyledTextToHTML(content: any[]): string {
  if (!Array.isArray(content)) return '';
  if (content.length === 0) return '<br>';

  return content
    .filter((item: any) => item && (item.type === 'text' || item.type === 'mention' || item.type === 'link'))
    .map((item: any) => {
      // Handle link inline content
      if (item.type === 'link') {
        const href = (item.href || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        const linkText = Array.isArray(item.content)
          ? item.content
              .filter((c: any) => c.type === 'text')
              .map((c: any) => {
                let text = (c.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                if (c.styles) {
                  if (c.styles.code) text = `<code>${text}</code>`;
                  if (c.styles.strike) text = `<s>${text}</s>`;
                  if (c.styles.underline) text = `<u>${text}</u>`;
                  if (c.styles.italic) text = `<em>${text}</em>`;
                  if (c.styles.bold) text = `<strong>${text}</strong>`;
                }
                return text;
              })
              .join('')
          : '';
        return `<a href="${href}" target="_blank" rel="noopener noreferrer">${linkText}</a>`;
      }

      // Handle mention inline content
      if (item.type === 'mention') {
        const { userId, username, displayName } = item.props || {};
        const displayText = username ? `@${username}` : `@[${displayName || 'Unknown'}]`;
        const escapedText = displayText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<span style="display:inline-flex;align-items:center;padding:1px 4px;border-radius:3px;background-color:#dbeafe;color:#1e40af;font-weight:500;">${escapedText}</span>`;
      }

      // Handle text inline content
      if (!item.text && item.text !== '') return '';

      // Ensure item.text is a string
      if (typeof item.text !== 'string') {
        console.warn('[BlockNoteUtils] item.text is not a string:', typeof item.text, item);
        return '';
      }

      let result = item.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      if (item.styles) {
        if (item.styles.code) result = `<code>${result}</code>`;
        if (item.styles.strike) result = `<s>${result}</s>`;
        if (item.styles.underline) result = `<u>${result}</u>`;
        if (item.styles.italic) result = `<em>${result}</em>`;
        if (item.styles.bold) result = `<strong>${result}</strong>`;

        let stylesArray: string[] = [];
        if (item.styles.textColor && item.styles.textColor !== 'default') {
          stylesArray.push(`color:${item.styles.textColor}`);
        }
        if (item.styles.backgroundColor && item.styles.backgroundColor !== 'default') {
          stylesArray.push(`background-color:${item.styles.backgroundColor}`);
        }
        if (stylesArray.length > 0) {
          result = `<span style="${stylesArray.join(';')}">${result}</span>`;
        }
      }
      return result;
    })
    .join('');
}

/**
 * Converts BlockNote JSON blocks to an HTML string.
 *
 * @param blocks - BlockNote content as Block array, PartialBlock array, or JSON string.
 * @returns An HTML string representation of the BlockNote content.
 */
export function convertBlockNoteToHTML(blocks: any): string {
  if (!blocks) return '<p>[No content]</p>';

  let blockData: Block[] | PartialBlock[];
  if (typeof blocks === 'string') {
    try {
      const parsed = JSON.parse(blocks);
      // Ensure parsed data is an array
      if (!Array.isArray(parsed)) {
        console.error("[BlockNoteUtils] Parsed BlockNote data is not an array:", typeof parsed);
        return '<p>[Invalid content format - not an array]</p>';
      }
      blockData = parsed;
    } catch (e) {
      console.error("[BlockNoteUtils] Failed to parse BlockNote JSON string for HTML conversion:", e);
      return '<p>[Invalid content format]</p>';
    }
  } else {
    blockData = blocks;
  }

  // Additional safety check for non-string input
  if (!Array.isArray(blockData)) {
    console.error("[BlockNoteUtils] BlockNote data is not an array:", typeof blockData);
    return '<p>[Invalid content format - not an array]</p>';
  }

  let output: string[] = [];


  function processBlocksRecursive(
    blocksToProcess: Block[] | PartialBlock[],
    currentLevel: number
  ) {
    let listBuffer: { type: 'ol' | 'ul'; items: string[] } | null = null;

    const flushListBuffer = () => {
      if (listBuffer) {
        output.push(`<${listBuffer.type}>${listBuffer.items.join('')}</${listBuffer.type}>`);
        listBuffer = null;
      }
    };

    blocksToProcess.forEach((block) => {
      let blockStylesArray: string[] = [];
      if (block.props) {
        const props = block.props as any;
        if (props.backgroundColor && props.backgroundColor !== 'default') {
          blockStylesArray.push(`background-color:${props.backgroundColor}`);
        }
        if (props.textAlignment && props.textAlignment !== 'left') {
          blockStylesArray.push(`text-align:${props.textAlignment}`);
        }
      }

      if (block.type === 'paragraph' && currentLevel > 0) {
        blockStylesArray.push(`margin-left: ${currentLevel * 25}px`); // 25px per indent level
      }

      const styleAttribute = blockStylesArray.length > 0 ? ` style="${blockStylesArray.join(';')}"` : '';

      let content = '';
      let isListItem = false;

      switch (block.type) {
        case 'paragraph':
          flushListBuffer();
          content = extractStyledTextToHTML(block.content as any[]);
          output.push(`<p${styleAttribute}>${content || '<br>'}</p>`);
          if (block.children && (block.children as any[]).length > 0) {
            processBlocksRecursive(block.children as Block[], currentLevel + 1);
          }
          break;
        case 'heading':
          flushListBuffer();
          const level = (block.props as any)?.level || 1;
          content = extractStyledTextToHTML(block.content as any[]);
          output.push(`<h${level}${styleAttribute}>${content}</h${level}>`);
          if (block.children && (block.children as any[]).length > 0) {
            processBlocksRecursive(block.children as Block[], currentLevel + 1);
          }
          break;
        case 'numberedListItem':
          content = extractStyledTextToHTML(block.content as any[]);
          if (!listBuffer || listBuffer.type !== 'ol') {
            flushListBuffer();
            listBuffer = { type: 'ol', items: [] };
          }
          let listItemContent = `<li${styleAttribute}>${content}`;
          if (block.children && (block.children as any[]).length > 0) {
            const nestedOutput: string[] = [];
            const originalOutputRef = output;
            (output as any) = nestedOutput;
            processBlocksRecursive(block.children as Block[], 0);
            (output as any) = originalOutputRef;
            listItemContent += nestedOutput.join('\n');
          }
          listItemContent += `</li>`;
          listBuffer.items.push(listItemContent);
          isListItem = true;
          break;
        case 'bulletListItem':
          content = extractStyledTextToHTML(block.content as any[]);
          if (!listBuffer || listBuffer.type !== 'ul') {
            flushListBuffer();
            listBuffer = { type: 'ul', items: [] };
          }
          let bulletItemContent = `<li${styleAttribute}>${content}`;
           if (block.children && (block.children as any[]).length > 0) {
            const nestedOutput: string[] = [];
            const originalOutputRef = output;
            (output as any) = nestedOutput;
            processBlocksRecursive(block.children as Block[], 0);
            (output as any) = originalOutputRef;
            bulletItemContent += nestedOutput.join('\n');
          }
          bulletItemContent += `</li>`;
          listBuffer.items.push(bulletItemContent);
          isListItem = true;
          break;
        case 'checkListItem':
          flushListBuffer();
          const checked = (block.props as any)?.checked;
          content = extractStyledTextToHTML(block.content as any[]);
          output.push(`<div${styleAttribute}>[${checked ? 'x' : ' '}] ${content}</div>`);
          if (block.children && (block.children as any[]).length > 0) {
            processBlocksRecursive(block.children as Block[], currentLevel + 1);
          }
          break;
        case 'table':
          flushListBuffer();
          // BlockNote table content typing differs from our PartialBlock[][] shape.
          // Accept unknown, validate, then treat cells as arrays of inline content.
          const rawTable = block.content as unknown;
          const tableContent = (rawTable && typeof rawTable === 'object' && (rawTable as any).rows)
            ? (rawTable as { rows: Array<{ cells: any[] }> })
            : null;
          if (!tableContent || !Array.isArray(tableContent.rows)) {
            output.push('<!-- Invalid table structure -->');
            break;
          }
          let tableHTML = '<table><tbody>';
          tableContent.rows.forEach((row) => {
            tableHTML += '<tr>';
            const cells = Array.isArray(row?.cells) ? row.cells : [];
            cells.forEach((cellContent) => {
              const inlineArray = Array.isArray(cellContent) ? cellContent : [];
              tableHTML += `<td>${extractStyledTextToHTML(inlineArray as any[])}</td>`;
            });
            tableHTML += '</tr>';
          });
          tableHTML += '</tbody></table>';
          output.push(blockStylesArray.length > 0 ? `<div${styleAttribute}>${tableHTML}</div>` : tableHTML);
          break;
        case 'codeBlock':
          flushListBuffer();
          const language = (block.props as any)?.language || '';
          const codeText = (block.content as any[])
              .map(item => item.text || '')
              .join('\n')
              .replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
          content = `<code class="language-${language}">${codeText}</code>`;
          output.push(`<pre${styleAttribute}>${content}</pre>`);
          break;
        case 'image': {
          flushListBuffer();
          const props = (block.props as any) || {};
          const imageUrl = typeof props.url === 'string' ? props.url.trim() : '';
          if (!imageUrl) {
            break;
          }

          const imageName = typeof props.name === 'string' ? props.name.trim() : '';
          const imageCaption = typeof props.caption === 'string' ? props.caption.trim() : '';
          const altText = imageCaption || imageName || 'ticket-comment-image';
          const captionHtml = imageCaption
            ? `<figcaption style="margin-top:8px;color:#667085;font-size:12px;">${escapeHtml(imageCaption)}</figcaption>`
            : '';

          output.push(
            `<figure${styleAttribute}><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(altText)}" style="max-width:100%;height:auto;" />${captionHtml}</figure>`
          );
          break;
        }
        default:
          flushListBuffer();
          const anyBlock = block as any;
          console.log(`[BlockNoteUtils] HTML Conversion: Unknown block type: ${anyBlock?.type}`);
          if (anyBlock?.content && Array.isArray(anyBlock.content)) {
             content = extractStyledTextToHTML(anyBlock.content as any[]);
             output.push(`<div${styleAttribute}>${content}</div>`);
          } else if (anyBlock?.content && typeof anyBlock.content === 'string') {
             const escapedContent = anyBlock.content.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
             output.push(`<div${styleAttribute}>${escapedContent}</div>`);
          } else {
             output.push(`<!-- Unsupported block type: ${String(anyBlock?.type)} -->`);
          }
          if (anyBlock?.children && (anyBlock.children as any[]).length > 0) {
            processBlocksRecursive(anyBlock.children as Block[], currentLevel + 1);
          }
          break;
      }
      if (!isListItem) {
        flushListBuffer();
      }
    });
    flushListBuffer();
  }

  processBlocksRecursive(blockData, 0);

  return output.join('\n');
}

// ── ProseMirror JSON → HTML conversion ─────────────────────────────

type PMNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
};

function renderPMMarks(text: string, marks: PMNode['marks']): string {
  if (!marks || marks.length === 0) return text;

  let result = text;
  for (const mark of marks) {
    switch (mark.type) {
      case 'bold':
        result = `<strong>${result}</strong>`;
        break;
      case 'italic':
        result = `<em>${result}</em>`;
        break;
      case 'underline':
        result = `<u>${result}</u>`;
        break;
      case 'strike':
        result = `<s>${result}</s>`;
        break;
      case 'code':
        result = `<code>${result}</code>`;
        break;
      case 'link': {
        const href = escapeHtml(String(mark.attrs?.href ?? ''));
        result = `<a href="${href}" target="_blank" rel="noopener noreferrer">${result}</a>`;
        break;
      }
    }
  }
  return result;
}

function renderPMInlineContent(nodes: PMNode[] | undefined): string {
  if (!nodes || nodes.length === 0) return '';

  return nodes.map(node => {
    if (node.type === 'text' && node.text != null) {
      return renderPMMarks(escapeHtml(node.text), node.marks);
    }
    if (node.type === 'mention') {
      const { userId, username, displayName } = (node.attrs ?? {}) as {
        userId?: string; username?: string; displayName?: string;
      };
      const label = username ? `@${username}` : `@${displayName || 'Unknown'}`;
      const escapedLabel = escapeHtml(label);
      const dataAttr = userId ? ` data-user-id="${escapeHtml(userId)}"` : '';
      return `<span style="display:inline-flex;align-items:center;padding:1px 4px;border-radius:3px;background-color:#dbeafe;color:#1e40af;font-weight:500;"${dataAttr}>${escapedLabel}</span>`;
    }
    // Unknown inline node — render children if any
    if (node.content) return renderPMInlineContent(node.content);
    return '';
  }).join('');
}

function renderPMNode(node: PMNode): string {
  switch (node.type) {
    case 'doc':
      return (node.content ?? []).map(renderPMNode).join('\n');

    case 'paragraph': {
      const inner = renderPMInlineContent(node.content);
      return `<p>${inner || '<br>'}</p>`;
    }

    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 6);
      const inner = renderPMInlineContent(node.content);
      return `<h${level}>${inner}</h${level}>`;
    }

    case 'bullet_list':
    case 'bulletList': {
      const items = (node.content ?? []).map(renderPMNode).join('\n');
      return `<ul>${items}</ul>`;
    }

    case 'ordered_list':
    case 'orderedList': {
      const start = Number(node.attrs?.order ?? node.attrs?.start ?? 1);
      const startAttr = start !== 1 ? ` start="${start}"` : '';
      const items = (node.content ?? []).map(renderPMNode).join('\n');
      return `<ol${startAttr}>${items}</ol>`;
    }

    case 'list_item':
    case 'listItem': {
      const inner = (node.content ?? []).map(renderPMNode).join('\n');
      return `<li>${inner}</li>`;
    }

    case 'blockquote': {
      const inner = (node.content ?? []).map(renderPMNode).join('\n');
      return `<blockquote>${inner}</blockquote>`;
    }

    case 'code_block':
    case 'codeBlock': {
      const lang = node.attrs?.language ? ` class="language-${escapeHtml(String(node.attrs.language))}"` : '';
      const code = (node.content ?? [])
        .map(n => escapeHtml(n.text ?? ''))
        .join('\n');
      return `<pre><code${lang}>${code}</code></pre>`;
    }

    case 'horizontal_rule':
    case 'horizontalRule':
      return '<hr>';

    case 'hard_break':
    case 'hardBreak':
      return '<br>';

    case 'text':
      return renderPMMarks(escapeHtml(node.text ?? ''), node.marks);

    case 'mention': {
      const { userId, username, displayName } = (node.attrs ?? {}) as {
        userId?: string; username?: string; displayName?: string;
      };
      const label = username ? `@${username}` : `@${displayName || 'Unknown'}`;
      const escapedLabel = escapeHtml(label);
      const dataAttr = userId ? ` data-user-id="${escapeHtml(userId)}"` : '';
      return `<span style="display:inline-flex;align-items:center;padding:1px 4px;border-radius:3px;background-color:#dbeafe;color:#1e40af;font-weight:500;"${dataAttr}>${escapedLabel}</span>`;
    }

    default: {
      // Unknown block — try to render children
      if (node.content) return (node.content).map(renderPMNode).join('\n');
      if (node.text != null) return escapeHtml(node.text);
      return `<!-- unsupported node type: ${escapeHtml(String(node.type))} -->`;
    }
  }
}

/**
 * Converts ProseMirror JSON ({type: 'doc', content: [...]}) to an HTML string.
 * Handles paragraphs, headings, lists, code blocks, blockquotes, marks
 * (bold, italic, underline, strike, code, link), mention nodes, and emoji.
 */
export function convertProseMirrorToHTML(doc: unknown): string {
  if (!doc) return '<p>[No content]</p>';

  let parsed: unknown = doc;
  if (typeof doc === 'string') {
    try {
      parsed = JSON.parse(doc);
    } catch {
      return '<p>[Invalid content format]</p>';
    }
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return '<p>[Invalid content format]</p>';
  }

  const pmDoc = parsed as PMNode;
  if (pmDoc.type !== 'doc') {
    return '<p>[Invalid ProseMirror document]</p>';
  }

  return renderPMNode(pmDoc);
}

// ── ProseMirror JSON → Markdown conversion ─────────────────────────

function renderPMMarksMarkdown(text: string, marks: PMNode['marks']): string {
  if (!text) return text;
  if (!marks || marks.length === 0) return text;

  // CommonMark forbids leading/trailing whitespace inside emphasis delimiters
  // (e.g. `*foo *` won't render). Peel whitespace off and restore it outside.
  const leadingMatch = text.match(/^\s+/);
  const trailingMatch = text.match(/\s+$/);
  const leading = leadingMatch ? leadingMatch[0] : '';
  const trailing = trailingMatch ? trailingMatch[0] : '';
  let core = text.slice(leading.length, text.length - trailing.length);

  if (core.length === 0) return text;

  for (const mark of marks) {
    switch (mark.type) {
      case 'bold':
        core = `**${core}**`;
        break;
      case 'italic':
        core = `*${core}*`;
        break;
      case 'underline':
        core = `<u>${core}</u>`;
        break;
      case 'strike':
        core = `~~${core}~~`;
        break;
      case 'code':
        core = `\`${core}\``;
        break;
      case 'link': {
        const href = String(mark.attrs?.href ?? '');
        core = `[${core}](${href})`;
        break;
      }
    }
  }
  return `${leading}${core}${trailing}`;
}

function renderPMInlineMarkdown(nodes: PMNode[] | undefined): string {
  if (!nodes || nodes.length === 0) return '';

  return nodes.map(node => {
    if (node.type === 'text' && node.text != null) {
      return renderPMMarksMarkdown(node.text, node.marks);
    }
    if (node.type === 'hard_break' || node.type === 'hardBreak') {
      return '  \n';
    }
    if (node.type === 'mention') {
      const { username, displayName } = (node.attrs ?? {}) as {
        username?: string; displayName?: string;
      };
      return username ? `@${username}` : `@${displayName || 'Unknown'}`;
    }
    if (node.content) return renderPMInlineMarkdown(node.content);
    return '';
  }).join('');
}

function renderPMNodeMarkdown(node: PMNode, listContext?: { ordered: boolean; index: number }): string {
  switch (node.type) {
    case 'doc':
      return (node.content ?? [])
        .map(child => renderPMNodeMarkdown(child))
        .join('\n\n');

    case 'paragraph': {
      const inner = renderPMInlineMarkdown(node.content);
      return inner;
    }

    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 6);
      const inner = renderPMInlineMarkdown(node.content);
      return `${'#'.repeat(level)} ${inner}`;
    }

    case 'bullet_list':
    case 'bulletList': {
      return (node.content ?? [])
        .map(item => renderPMNodeMarkdown(item, { ordered: false, index: 0 }))
        .join('\n');
    }

    case 'ordered_list':
    case 'orderedList': {
      const start = Number(node.attrs?.order ?? node.attrs?.start ?? 1);
      return (node.content ?? [])
        .map((item, i) => renderPMNodeMarkdown(item, { ordered: true, index: start + i }))
        .join('\n');
    }

    case 'list_item':
    case 'listItem': {
      const marker = listContext?.ordered ? `${listContext.index}.` : '-';
      const childBlocks = (node.content ?? []).map(child => renderPMNodeMarkdown(child));
      const first = (childBlocks[0] ?? '').trim();
      const rest = childBlocks.slice(1)
        .map(block => block.split('\n').map(l => (l ? `  ${l}` : l)).join('\n'))
        .join('\n');
      return rest ? `${marker} ${first}\n${rest}` : `${marker} ${first}`;
    }

    case 'task_list':
    case 'taskList': {
      return (node.content ?? [])
        .map(item => renderPMNodeMarkdown(item))
        .join('\n');
    }

    case 'task_item':
    case 'taskItem': {
      const checked = Boolean(node.attrs?.checked);
      const inner = (node.content ?? []).map(child => renderPMNodeMarkdown(child)).join('\n').trim();
      return `- [${checked ? 'x' : ' '}] ${inner}`;
    }

    case 'blockquote': {
      const inner = (node.content ?? []).map(child => renderPMNodeMarkdown(child)).join('\n\n');
      return inner.split('\n').map(line => `> ${line}`).join('\n');
    }

    case 'code_block':
    case 'codeBlock': {
      const lang = node.attrs?.language ? String(node.attrs.language) : '';
      const code = (node.content ?? []).map(n => n.text ?? '').join('');
      return `\`\`\`${lang}\n${code}\n\`\`\``;
    }

    case 'horizontal_rule':
    case 'horizontalRule':
      return '---';

    case 'hard_break':
    case 'hardBreak':
      return '  \n';

    case 'image': {
      const src = String(node.attrs?.src ?? '');
      const alt = String(node.attrs?.alt ?? '');
      return src ? `![${alt}](${src})` : '';
    }

    case 'text':
      return renderPMMarksMarkdown(node.text ?? '', node.marks);

    case 'mention': {
      const { username, displayName } = (node.attrs ?? {}) as {
        username?: string; displayName?: string;
      };
      return username ? `@${username}` : `@${displayName || 'Unknown'}`;
    }

    default: {
      if (node.content) return (node.content).map(child => renderPMNodeMarkdown(child)).join('\n');
      if (node.text != null) return node.text;
      return '';
    }
  }
}

/**
 * Converts ProseMirror JSON ({type: 'doc', content: [...]}) to a Markdown string.
 * Handles paragraphs, headings, lists, code blocks, blockquotes, marks
 * (bold, italic, underline, strike, code, link), mention nodes, and emoji.
 */
export function convertProseMirrorToMarkdown(doc: unknown): string {
  if (!doc) return '';

  let parsed: unknown = doc;
  if (typeof doc === 'string') {
    try {
      parsed = JSON.parse(doc);
    } catch {
      return typeof doc === 'string' ? doc : '';
    }
  }

  if (typeof parsed !== 'object' || parsed === null) return '';

  const pmDoc = parsed as PMNode;
  if (pmDoc.type !== 'doc') return '';

  return renderPMNodeMarkdown(pmDoc);
}

/**
 * Auto-detects whether block_data is BlockNote or ProseMirror format
 * and converts it to Markdown using the appropriate converter.
 */
export function convertBlockContentToMarkdown(blockData: unknown): string {
  if (!blockData) return '';

  let parsed: unknown = blockData;
  if (typeof blockData === 'string') {
    try {
      parsed = JSON.parse(blockData);
    } catch {
      return convertBlockNoteToMarkdown(blockData);
    }
  }

  // ProseMirror format: {type: 'doc', content: [...]}
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const maybeDoc = parsed as { type?: string };
    if (maybeDoc.type === 'doc') {
      return convertProseMirrorToMarkdown(parsed);
    }
  }

  // BlockNote format: [{type: '...', props: {...}, content: [...]}]
  return convertBlockNoteToMarkdown(blockData);
}

/**
 * Auto-detects whether block_data is BlockNote or ProseMirror format
 * and converts it to HTML using the appropriate converter.
 */
export function convertBlockContentToHTML(blockData: unknown): string {
  if (!blockData) return '<p>[No content]</p>';

  let parsed: unknown = blockData;
  if (typeof blockData === 'string') {
    try {
      parsed = JSON.parse(blockData);
    } catch {
      return convertBlockNoteToHTML(blockData);
    }
  }

  // ProseMirror format: {type: 'doc', content: [...]}
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const maybeDoc = parsed as { type?: string };
    if (maybeDoc.type === 'doc') {
      return convertProseMirrorToHTML(parsed);
    }
  }

  // BlockNote format: [{type: '...', props: {...}, content: [...]}]
  return convertBlockNoteToHTML(blockData);
}
