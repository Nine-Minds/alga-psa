import { getMeaningfulBlockContentMarkdown } from '@alga-psa/formatting/blocknoteUtils';

export function buildDocumentMarkdown(blockData: unknown, textContent: string | null | undefined): string | null {
  let markdown: string | null = null;
  markdown = getMeaningfulBlockContentMarkdown(blockData);
  if (!markdown && typeof textContent === 'string' && textContent.trim()) markdown = textContent;
  if (!markdown) return null;
  return markdown.replace(/\r\n/g, '\n').split('\n').map(line => line.trim() ? line.replace(/[ \t]+$/, '') : '').join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
