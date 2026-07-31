import { formatBlockNoteContent } from '@alga-psa/formatting/blocknoteUtils';

/**
 * Work item descriptions are stored as serialized editor content. Flatten them to
 * plain text for list/card surfaces, and collapse empty documents to ''.
 */
export function workItemDescriptionText(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  return formatBlockNoteContent(raw).text.trim();
}
