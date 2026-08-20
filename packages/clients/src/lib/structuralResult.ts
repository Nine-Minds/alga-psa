/**
 * Result of a structural schema pass over a write payload.
 *
 * Read the failure branch through `isStructuralFailure`, never through a bare
 * `!result.ok`: ee/server compiles these sources with `strict: false`, where a
 * boolean discriminant does not narrow the union and `result.error` stops
 * existing. A type predicate narrows under both strict modes.
 */
export type StructuralResult<T, E = string> =
  | { ok: true; data: T }
  | { ok: false; error: E };

export function isStructuralFailure<T, E>(
  result: StructuralResult<T, E>
): result is { ok: false; error: E } {
  return !result.ok;
}
