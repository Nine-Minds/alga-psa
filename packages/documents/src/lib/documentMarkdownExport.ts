import { convertBlockContentToMarkdown } from '@alga-psa/formatting/blocknoteUtils';

const BLOCK_CONVERSION_FAILURES = new Set([
  '[No content]',
  '[Invalid content format]',
  '[Invalid content format - not an array]',
  '[Content could not be converted to markdown]',
]);

export function buildDocumentMarkdown(blockData: unknown, textContent: string | null | undefined): string | null {
  let markdown: string | null = null;
  if (blockData !== undefined && blockData !== null) {
    const converted = convertBlockContentToMarkdown(blockData);
    const trimmed = typeof converted === 'string' ? converted.trim() : '';
    if (trimmed && !BLOCK_CONVERSION_FAILURES.has(trimmed)) markdown = converted;
  }
  if (!markdown && typeof textContent === 'string' && textContent.trim()) markdown = textContent;
  if (!markdown) return null;
  return markdown.replace(/\r\n/g, '\n').split('\n').map(line => line.trim() ? line.replace(/[ \t]+$/, '') : '').join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
