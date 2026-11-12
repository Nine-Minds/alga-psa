import knexFactory, { type Knex } from 'knex';

export type CapturedKnexQuery = { sql: string; bindings: readonly unknown[] };
export type RecordingKnexResponse = { rows: unknown[]; command: string };

/** A pg-client Knex instance that records compiled queries without connecting to a database. */
export function recordingKnex(
  captured: CapturedKnexQuery[],
  responseForQuery: (query: { sql: string; bindings: unknown[] }) => RecordingKnexResponse = () => ({ rows: [{}], command: 'INSERT' }),
): Knex {
  const db = knexFactory({ client: 'pg' });
  const client = db.client as any;
  client.acquireConnection = async () => ({
    query: (query: { text?: string; values?: unknown[] } | string, callback: (error: Error | null, response?: RecordingKnexResponse) => void) => {
      const sql = typeof query === 'string' ? query : query.text ?? '';
      const bindings = typeof query === 'string' ? [] : query.values ?? [];
      captured.push({ sql, bindings });
      callback(null, responseForQuery({ sql, bindings }));
    },
  });
  client.releaseConnection = async () => undefined;
  client._query = async (_connection: unknown, query: { sql: string; bindings: unknown[] }) => {
    captured.push({ sql: query.sql, bindings: query.bindings });
    return { ...query, response: responseForQuery(query) };
  };
  return db;
}
