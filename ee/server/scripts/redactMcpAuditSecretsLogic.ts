import { redactToolArguments, redactToolResult } from '@alga-psa/agent-tooling';

/** Coarse SQL/JS prefilter: rows that mention a secret-shaped key anywhere. */
export const SECRET_SHAPE_SQL = '(secret|password|_token|private_key|api_key)';
const SECRET_SHAPE = new RegExp(SECRET_SHAPE_SQL, 'i');
/** A secret-shaped key followed by a separator, in text we could not parse (e.g. a summary cut at 2000 chars). */
const SECRET_KEY_IN_TEXT = /[\w-]*(?:secret|password|_token|private_key|api_key)["']?\s*[:=]/i;

export interface AuditRowLike {
  tool: string;
  result_summary: string | null;
  arguments: unknown;
}

export interface RowPatch {
  result_summary?: string | null;
  arguments?: string | null;
}

/**
 * What an already-stored audit row should become, or null when it needs no change.
 * Idempotent: applying the patch and planning again yields null.
 */
export function planRowRemediation(row: AuditRowLike): RowPatch | null {
  const patch: RowPatch = {};

  const summary = row.result_summary;
  if (summary && SECRET_SHAPE.test(summary)) {
    let next: string | null;
    let parses = true;
    try {
      JSON.parse(summary);
    } catch {
      parses = false;
    }
    if (parses) next = redactToolResult(row.tool, summary);
    // Unparseable (truncated) text can't be walked; if a secret key is visible, drop the summary.
    else next = SECRET_KEY_IN_TEXT.test(summary) ? null : redactToolResult(row.tool, summary);
    if (next !== summary) patch.result_summary = next;
  }

  if (row.arguments !== null && row.arguments !== undefined) {
    const parsed = typeof row.arguments === 'string' ? safeParse(row.arguments) : row.arguments;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const before = JSON.stringify(parsed);
      const after = JSON.stringify(redactToolArguments(row.tool, parsed as Record<string, unknown>));
      if (after !== before) patch.arguments = after;
    }
  }

  return Object.keys(patch).length ? patch : null;
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
