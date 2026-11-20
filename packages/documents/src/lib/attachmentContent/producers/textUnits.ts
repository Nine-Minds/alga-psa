import { LIMITS } from '../limits';
import { chunkText } from '../chunkText';
import type { ContentUnit, ProducerCtx, UnitList } from '../types';

/** Shared by every producer whose output is Markdown/plain text: chunk it and expose the chunks as units. */
export function textUnitList(
  text: string,
  ctx: ProducerCtx,
  detail: string,
  opts: { extraNotes?: string[] } = {},
): UnitList {
  let body = text;
  const notes = [...(opts.extraNotes ?? [])];
  if (body.length > LIMITS.maxDocumentTextChars) {
    notes.push(`truncated at ${LIMITS.maxDocumentTextChars} characters`);
    body = body.slice(0, LIMITS.maxDocumentTextChars);
  }
  const chunks = chunkText(body, LIMITS.textChunkChars);
  const total = chunks.length;
  const unit = (index: number): ContentUnit => ({
    cost: () => ({ images: 0, encodedBytes: 0, textChars: chunks[index].length }),
    materialize: async () => {
      const parts = [detail, ...(total > 1 ? [`chunk ${index + 1} of ${total}`] : []), ...(index === 0 ? notes : [])];
      if (ctx.mimeNote && index === 0) parts.push(ctx.mimeNote);
      return {
        label: `${ctx.tag} (${parts.filter(Boolean).join(', ')})`,
        blocks: [{ type: 'text', text: chunks[index] }],
        rendering: 'text',
      };
    },
  });
  return {
    total,
    unit,
    describeRange: (from, to) => (total <= 1 ? null : from === to ? `chunk ${from + 1} of ${total}` : `chunks ${from + 1}-${to + 1} of ${total}`),
  };
}
