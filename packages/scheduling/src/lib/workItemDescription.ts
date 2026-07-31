import { formatBlockNoteContent } from '@alga-psa/formatting/blocknoteUtils';

/**
 * Work item descriptions are stored as serialized editor content. Flatten them to a
 * single line of plain text for list/card surfaces, and collapse empty documents to ''.
 * The flattening keeps styling markup (spans, bold, headings) that would render
 * literally on a truncated card line, so strip it here.
 */
export function workItemDescriptionText(raw: unknown): string {
  if (raw === null || raw === undefined) return '';

  return formatBlockNoteContent(raw).text
    .replace(/<[^>]+>/g, '')
    .replace(/^\s*(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/(\*\*|__|~~)(.*?)\1/g, '$2')
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
