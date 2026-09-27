/**
 * Postgres/Citus unique-violation detection, shared by every idempotency key
 * in the service-requests domain.
 *
 * Plain Postgres reports the bare index name in `error.constraint`, but Citus
 * executes the insert against a shard and reports the shard-local index name
 * with a numeric shard-id suffix (e.g. `<index>_102008`). The suffix is
 * anchored to `_<digits>` so a differently named index sharing the prefix can
 * never match. One implementation, used by both the submission client-key path
 * and the answer-mapping apply path.
 */
export function isUniqueViolationOnIndex(error: unknown, indexName: string): boolean {
  const candidate = error as { code?: string; constraint?: string } | null;
  if (candidate?.code !== '23505' || typeof candidate?.constraint !== 'string') {
    return false;
  }
  const escaped = indexName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}(_\\d+)?$`).test(candidate.constraint);
}
