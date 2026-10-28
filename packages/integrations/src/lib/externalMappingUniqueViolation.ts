import { actionError, type ActionMessageError } from '@alga-psa/ui/lib/errorHandling';

/**
 * Returns the base unique-index name for a Postgres 23505 error, or null for
 * any other error. Citus appends the shard id to names raised from shard-level
 * execution (`idx_unique_external_mapping_102345`), so a trailing `_<digits>`
 * is stripped.
 */
// LEVERAGE: pattern citus-constraint-name — exact `error.constraint === '...'` matches are dead code on Citus (shard suffix); also in billing invoice actions, projects taskDependency and extension schedule sites. A shared helper layer is missing.
export function uniqueViolationIndex(error: unknown): string | null {
  const e = error as { code?: string; constraint?: string } | null | undefined;
  if (e?.code !== '23505') return null;
  return typeof e.constraint === 'string' ? e.constraint.replace(/_\d+$/, '') : '';
}

/**
 * "Someone else already holds this external target." Shared by the pre-write
 * conflict check and the 23505 translation so a conflict reads the same
 * whichever one catches it.
 */
export function duplicateTargetError(row: {
  integration_type?: string;
  alga_entity_type?: string;
}): ActionMessageError {
  if (
    row.integration_type === 'xero' &&
    (row.alga_entity_type === 'service' || row.alga_entity_type === 'discount')
  ) {
    return actionError(
      'This Xero item is already mapped to another service. An item can be mapped to only one service; to bill several services to the same code, map them to a revenue account instead.',
      'msp/integrations:errors.mappings.duplicateXeroItem'
    );
  }
  return actionError(
    'This target is already mapped to another entity in this organisation. Choose a different target.',
    'msp/integrations:errors.mappings.duplicateTarget'
  );
}

/** "This Alga entity is already mapped." */
export function duplicateMappingError(): ActionMessageError {
  return actionError(
    'A mapping already exists for this entity. Edit the existing mapping instead.',
    'msp/integrations:errors.mappings.duplicate'
  );
}

/**
 * Maps a 23505 raised while writing a mapping row to a user-facing error.
 * Shared by create and update so the two paths cannot drift apart.
 * Returns null when the error is not a unique violation.
 *
 * idx_unique_external_mapping is a partial index on the external target:
 * item-kind rows (and every non-Xero integration) are one-to-one, while Xero
 * revenue-account rows are outside it and may be shared. Tombstoned (unlinked)
 * rows are outside both indexes and reserve nothing. Anything else
 * (idx_unique_alga_mapping) is the same Alga entity mapped twice.
 */
export function mapUniqueViolation(
  error: unknown,
  row: { integration_type?: string; alga_entity_type?: string }
): ActionMessageError | null {
  const index = uniqueViolationIndex(error);
  if (index === null) return null;

  if (index === 'idx_unique_external_mapping') {
    return duplicateTargetError(row);
  }
  return duplicateMappingError();
}
