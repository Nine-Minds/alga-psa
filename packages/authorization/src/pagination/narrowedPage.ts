/**
 * A page whose rows SQL has already narrowed to what the reader may see: the total and the page boundaries come
 * from the narrowed query, so nothing here counts or skips rows.
 *
 * What is left to do per row is the part SQL cannot express: field redaction. The page (at most one page of rows,
 * never a scan of the source) is projected through the reader's per-row redactions. A rule that redacts fields
 * therefore changes what a row shows, never which rows there are or how many.
 */

export interface NarrowedPage<T> {
  data: T[];
  total: number;
}

export interface NarrowedPageProjection<T> {
  /** Whether any rule that applies to the reader redacts fields. False skips the per-row decisions entirely. */
  redactsFields: boolean;
  /** The reader's decision for one narrowed row. A refusal drops the row (fail closed). */
  decideRow: (row: T) => Promise<{ allowed: boolean; redactedFields: readonly string[] }>;
  /** Apply the redactions to a row; null hides the row altogether. */
  projectRow: (row: T, redactedFields: readonly string[]) => T | null;
}

export async function projectNarrowedPage<T>(
  page: NarrowedPage<T>,
  projection: NarrowedPageProjection<T>
): Promise<NarrowedPage<T>> {
  if (!projection.redactsFields) return page;

  const decisions = await Promise.all(page.data.map((row) => projection.decideRow(row)));
  const data: T[] = [];
  page.data.forEach((row, index) => {
    const decision = decisions[index];
    if (!decision.allowed) return;
    const projected = projection.projectRow(row, decision.redactedFields);
    if (projected !== null) data.push(projected);
  });

  // The SQL predicate and the per-row decision are the same rule, so a row dropped here is not expected; if one is,
  // the total stops counting it rather than promising a row the page does not carry.
  const dropped = page.data.length - data.length;
  return { data, total: Math.max(0, page.total - dropped) };
}
