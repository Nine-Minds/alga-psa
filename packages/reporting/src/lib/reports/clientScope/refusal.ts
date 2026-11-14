/**
 * Why a report could not be narrowed to a subject's clients.
 *
 * A refusal is a typed result, not a thrown string: the planner returns it, the engine carries it on
 * `ReportClientScopeRefusedError`, and the action boundary turns it into a catalogued, localised message.
 */
export type ClientScopeRefusalCode =
  /** A table the report reads carries no client-ownership declaration, so nothing says how to narrow it. */
  | 'undeclared_table'
  /** The metric is raw SQL: there is no table structure to attach a predicate to. */
  | 'raw_sql'
  /** A right or full join keeps rows from a table the predicate cannot reach. */
  | 'unsupported_join'
  /** No table the metric reads is client-owned, so no predicate would restrict its rows. */
  | 'no_client_anchor'
  /** The report reads data that is not attributable to a client at all (hand-written reports only). */
  | 'not_client_attributable'
  /** A hand-written report that totals many clients' ledgers together and has no mechanical way to limit them. */
  | 'unnarrowable_report';

export interface ClientScopeRefusal {
  code: ClientScopeRefusalCode;
  /** The table the refusal is about, when one table is to blame. */
  table?: string;
  /** The report (definition id or action name) that was refused. */
  reportId?: string;
  /** The metric inside the report that could not be narrowed. */
  metricId?: string;
  /** English reason, for logs and the fallback message. The catalogue entry is keyed by `code`. */
  reason: string;
}

export type ClientScopeResult<T> = { ok: true; value: T } | { ok: false; refusal: ClientScopeRefusal };

export const clientScopeOk = <T>(value: T): ClientScopeResult<T> => ({ ok: true, value });
export const clientScopeRefused = (refusal: ClientScopeRefusal): ClientScopeResult<never> => ({ ok: false, refusal });

/** Thrown by hand-written report actions (and carried by the engine's error) when a narrowed subject's report is refused. */
export class ClientScopeRefusedError extends Error {
  constructor(public readonly refusal: ClientScopeRefusal) {
    super(`Report refused: ${refusal.reason}`);
    this.name = 'ClientScopeRefusedError';
  }
}

/**
 * English text of each refusal. The same strings are the `msp/reports` entries
 * `errors.report.clientScopeRefused.<code>`, which carry the other languages; `{{table}}` is interpolated.
 */
export const CLIENT_SCOPE_REFUSAL_MESSAGES: Readonly<Record<ClientScopeRefusalCode, string>> = {
  undeclared_table:
    'This report is not available to you because it cannot be limited to your clients: it reads {{table}}, which has no client ownership rule.',
  raw_sql:
    'This report is not available to you because it cannot be limited to your clients: it is built from raw SQL.',
  unsupported_join:
    'This report is not available to you because it cannot be limited to your clients: it joins {{table}} in a way that keeps rows from other clients.',
  no_client_anchor:
    'This report is not available to you because it cannot be limited to your clients: none of the data it reads belongs to a client.',
  not_client_attributable:
    'This report is not available to you because it cannot be limited to your clients: it reads {{table}}, which is not attributable to a client.',
  unnarrowable_report:
    'This report is not available to you because it cannot be limited to your clients: it totals the accounts of every client together.',
};

/** The catalogue entry (English text, i18n key and params) for a refusal. */
export function describeClientScopeRefusal(refusal: ClientScopeRefusal): {
  message: string;
  key: string;
  params: Record<string, string>;
} {
  const params: Record<string, string> = { table: refusal.table ?? '' };
  return {
    message: CLIENT_SCOPE_REFUSAL_MESSAGES[refusal.code].replace(/\{\{table\}\}/g, params.table),
    key: `msp/reports:errors.report.clientScopeRefused.${refusal.code}`,
    params,
  };
}
