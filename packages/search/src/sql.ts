export interface SqlFragment {
  sql: string;
  bindings: unknown[];
}

export function buildTsvectorSql(title: string, subtitle?: string | null, body?: string | null): SqlFragment {
  return {
    sql: [
      "setweight(public.process_large_lexemes(?), 'A')",
      "setweight(public.process_large_lexemes(?), 'B')",
      "setweight(public.process_large_lexemes(?), 'C')",
    ].join(' || '),
    bindings: [title, subtitle ?? '', body ?? ''],
  };
}
