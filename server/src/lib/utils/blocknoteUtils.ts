import { Block, PartialBlock } from '@blocknote/core';

/**
 * Converts BlockNote JSON content to Markdown format
 *
 * This function uses a custom implementation to convert blocks to markdown.
 * It handles various block types including paragraphs, headings, tables, lists, etc.
 *
 * @param blocks - BlockNote content as Block array, PartialBlock array, JSON string, or undefined
 * @returns A string containing the markdown representation, never undefined
 */
export function convertBlockNoteToMarkdown(blocks: Block[] | PartialBlock[] | string | undefined): string {
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
    .filter((item: any) => item && item.type === 'text')
    .map((item: any) => {
      if (!item.text && item.text !== '') return '';
      
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
    .filter((item: any) => item && item.type === 'text')
    .map((item: any) => {
      if (!item.text && item.text !== '') return '';

      let result = item.text.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>'); 

      if (item.styles) {
        if (item.styles.code) result = `<code>${result}</code>`; 
        if (item.styles.strike) result = `<s>${result}</s>`;
        if (item.styles.underline) result = `<u>${result}</u>`;
        if (item.styles.italic) result = `<em>${result}</em>`;
        if (item.styles.bold) result = `<strong>${result}</strong>`;

        let stylesArray = [];
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
export function convertBlockNoteToHTML(blocks: Block[] | PartialBlock[] | string | undefined): string {
  if (!blocks) return '<p>[No content]</p>';

  let blockData: Block[] | PartialBlock[];
  if (typeof blocks === 'string') {
    try {
      blockData = JSON.parse(blocks);
    } catch (e) {
      console.error("[BlockNoteUtils] Failed to parse BlockNote JSON string for HTML conversion:", e);
      return '<p>[Invalid content format]</p>';
    }
  } else {
    blockData = blocks;
  }

  let listBuffer: { type: 'ol' | 'ul', items: string[] } | null = null;
  const output: string[] = [];

  const flushListBuffer = () => {
    if (listBuffer) {
      output.push(`<${listBuffer.type}>${listBuffer.items.join('')}</${listBuffer.type}>`);
      listBuffer = null;
    }
  };

  blockData.forEach((block) => {
    let blockStyles = '';
    if (block.props) {
      const props = block.props as any;
      if (props.backgroundColor && props.backgroundColor !== 'default') {
        blockStyles += `background-color:${props.backgroundColor};`;
      }
      if (props.textAlignment && props.textAlignment !== 'left') {
        blockStyles += `text-align:${props.textAlignment};`;
      }
    }
    const styleAttribute = blockStyles ? ` style="${blockStyles}"` : '';

    let content = '';
    let isListItem = false;

    switch (block.type) {
      case 'paragraph':
        flushListBuffer();
        content = extractStyledTextToHTML(block.content as any[]);
        output.push(`<p${styleAttribute}>${content || '<br>'}</p>`); 
        break;
      case 'heading':
        flushListBuffer();
        const level = (block.props as any)?.level || 1;
        content = extractStyledTextToHTML(block.content as any[]);
        output.push(`<h${level}${styleAttribute}>${content}</h${level}>`);
        break;
      case 'numberedListItem':
        content = extractStyledTextToHTML(block.content as any[]);
        if (!listBuffer || listBuffer.type !== 'ol') {
          flushListBuffer();
          listBuffer = { type: 'ol', items: [] };
        }
        listBuffer.items.push(`<li${styleAttribute}>${content}</li>`);
        isListItem = true;
        break;
      case 'bulletListItem':
        content = extractStyledTextToHTML(block.content as any[]);
        if (!listBuffer || listBuffer.type !== 'ul') {
          flushListBuffer();
          listBuffer = { type: 'ul', items: [] };
        }
        listBuffer.items.push(`<li${styleAttribute}>${content}</li>`);
        isListItem = true;
        break;
      case 'checkListItem':
        flushListBuffer();
        const checked = (block.props as any)?.checked;
        content = extractStyledTextToHTML(block.content as any[]);
        output.push(`<div${styleAttribute}>[${checked ? 'x' : ' '}] ${content}</div>`);
        break;
      case 'table':
        flushListBuffer();
        const tableContent = block.content as { type: 'tableContent', rows: Array<{ cells: Array<PartialBlock[]> }> };
        if (!tableContent || !tableContent.rows) {
           output.push('<!-- Invalid table structure -->');
           break;
        }
        let tableHTML = '<table><tbody>';
        tableContent.rows.forEach(row => {
          tableHTML += '<tr>';
          row.cells.forEach(cellContent => {
            tableHTML += `<td>${extractStyledTextToHTML(cellContent as any[])}</td>`;
          });
          tableHTML += '</tr>';
        });
        tableHTML += '</tbody></table>';
        output.push(blockStyles ? `<div${styleAttribute}>${tableHTML}</div>` : tableHTML);
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
      // Add cases for other block types as needed
      // case 'image':
      //   flushListBuffer();
      //   const src = (block.props as any)?.src;
      //   if (src) output.push(`<img src="${src}" alt="Image" />`);
      //   else output.push('<!-- Image block with no source -->');
      //   break;
      default:
        flushListBuffer();
        console.log(`[BlockNoteUtils] HTML Conversion: Unknown block type: ${block.type}`);
        if (block.content && Array.isArray(block.content)) {
           content = extractStyledTextToHTML(block.content as any[]);
           output.push(`<div${styleAttribute}>${content}</div>`);
        } else if (block.content && typeof block.content === 'string') {
           const escapedContent = block.content.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
           output.push(`<div${styleAttribute}>${escapedContent}</div>`);
        } else {
           output.push(`<!-- Unsupported block type: ${block.type} -->`);
        }
        break;
    }
    if (!isListItem) {
        flushListBuffer();
    }
  });

  flushListBuffer();

  return output.join('\n');
}
