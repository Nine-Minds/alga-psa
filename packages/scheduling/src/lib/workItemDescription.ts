import { formatBlockNoteContent } from '@alga-psa/formatting/blocknoteUtils';

/**
 * The flattening keeps styling markup (spans, bold, headings) that would render
 * literally wherever the text is shown, so strip it here.
 */
function stripMarkup(value: string): string {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/^\s*(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/(\*\*|__|~~)(.*?)\1/g, '$2')
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
}

/**
 * Work item descriptions are stored as serialized editor content. Flatten them to a
 * single line of plain text for list/card surfaces, and collapse empty documents to ''.
 */
export function workItemDescriptionText(raw: unknown): string {
  if (raw === null || raw === undefined) return '';

  return stripMarkup(formatBlockNoteContent(raw).text)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Same flattening for detail surfaces that render with whitespace-pre-wrap: keep the
 * block structure as blank-line-separated paragraphs instead of one long line.
 */
export function workItemDescriptionParagraphs(raw: unknown): string {
  if (raw === null || raw === undefined) return '';

  return stripMarkup(formatBlockNoteContent(raw).text)
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
