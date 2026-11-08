/**
 * Plain-text preview for a description that may hold a whole HTML body.
 *
 * Calendar sync stores Outlook/Google event bodies verbatim (echo detection and the Outlook
 * round-trip need the exact markup), so a synced schedule entry's notes can be a full
 * `<html>` document — head, inline CSS and all. Activity cards render the description as
 * text, which showed that markup literally. Strip it here, at display time only; nothing is
 * rewritten in storage.
 *
 * Plain-text descriptions (the common case) are returned untouched.
 */

/** Only bodies that actually look like markup are rewritten. */
const MARKUP_PATTERN = /<\/?(?:p|div|br|html|head|body|span|table|tr|td|ul|ol|li|h[1-6]|style|script)\b/i;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Decode once: &amp;lt; is the literal text &lt;, not a second encoded '<'. */
function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (!code.startsWith('#')) return NAMED_ENTITIES[code.toLowerCase()] ?? entity;
    const point = code[1].toLowerCase() === 'x'
      ? Number.parseInt(code.slice(2), 16)
      : Number.parseInt(code.slice(1), 10);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
      ? String.fromCodePoint(point)
      : entity;
  });
}

export function descriptionPreviewText(value: string | undefined): string {
  if (!value) return '';
  if (!MARKUP_PATTERN.test(value)) return value;

  const stripped = value
    // Comments first: Outlook wraps its stylesheet in <style><!-- … --></style>.
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(style|script|head)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    // Block boundaries become whitespace so paragraphs don't run together.
    .replace(/<br\s*\/?>|<\/(?:p|div|tr|td|th|li|h[1-6])\s*>/gi, ' ')
    .replace(/<[^>]*>/g, '');

  // Decode after stripping, then collapse: &nbsp; becomes a normal space.
  return decodeEntities(stripped).replace(/\s+/g, ' ').trim();
}
