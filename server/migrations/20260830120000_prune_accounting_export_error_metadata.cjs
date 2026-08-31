/**
 * Accounting export error metadata now stores allowlisted diagnostics only
 * (adapter type, stable code, document ID, correlation ID, validation
 * messages). Historical rows can still carry raw provider payloads under
 * `metadata.raw` / `metadata.originalError`, and legacy validation entries
 * kept provider message text verbatim; strip the raw keys and scrub
 * token-shaped substrings out of validation messages in place.
 *
 * Forward-only: the discarded payload data is intentionally unrecoverable.
 * Tenant-scoped batches keep every UPDATE routable to a single shard on
 * Citus and keep transaction sizes bounded on large installs.
 */

const BATCH_SIZE = 500;
const AFFECTED_PREDICATE = "metadata ?| array['raw', 'originalError', 'validationErrors']";
const MAX_MESSAGE_LENGTH = 300;

// Mirrors MESSAGE_SECRET_PATTERNS in packages/core/src/lib/providerErrors.ts:
// bearer/basic credentials, JWTs, and long opaque base64/hex blobs.
const MESSAGE_SECRET_PATTERNS = [
  /\b(?:bearer|basic)\s+[a-z0-9._~+/=-]+/gi,
  /\beyJ[a-zA-Z0-9_-]{8,}(?:\.[a-zA-Z0-9_-]{4,}){1,2}/g,
  /\b[a-zA-Z0-9_-]{40,}\b/g
];

function sanitizeMessage(message) {
  if (typeof message !== 'string' || message.length === 0) {
    return 'Validation error';
  }
  let sanitized = message;
  for (const pattern of MESSAGE_SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }
  if (sanitized.length > MAX_MESSAGE_LENGTH) {
    sanitized = `${sanitized.slice(0, MAX_MESSAGE_LENGTH)}…`;
  }
  return sanitized;
}

function pruneMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return metadata;
  }
  const result = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (key === 'raw' || key === 'originalError') {
      continue;
    }
    if (key === 'validationErrors' && Array.isArray(value)) {
      result[key] = value.map((item) => {
        const entry = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
        return {
          message: sanitizeMessage(entry.message),
          ...(typeof entry.field === 'string' ? { field: entry.field } : {})
        };
      });
      continue;
    }
    result[key] = value;
  }
  return result;
}

exports.up = async function up(knex) {
  const tenants = await knex('accounting_export_errors')
    .whereRaw(AFFECTED_PREDICATE)
    .distinct('tenant')
    .pluck('tenant');

  for (const tenant of tenants) {
    // Keyset pagination on error_id: rows with validationErrors still match
    // the predicate after rewriting, so a plain limit loop would not converge.
    let lastErrorId = null;
    for (;;) {
      let query = knex('accounting_export_errors')
        .where({ tenant })
        .whereRaw(AFFECTED_PREDICATE);
      if (lastErrorId !== null) {
        query = query.where('error_id', '>', lastErrorId);
      }
      const rows = await query
        .orderBy('error_id')
        .limit(BATCH_SIZE)
        .select('error_id', 'metadata');
      if (rows.length === 0) {
        break;
      }

      for (const row of rows) {
        const metadata =
          typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
        await knex('accounting_export_errors')
          .where({ tenant, error_id: row.error_id })
          .update({ metadata: JSON.stringify(pruneMetadata(metadata)) });
      }

      lastErrorId = rows[rows.length - 1].error_id;
    }
  }
};

exports.down = async function down() {
  // Forward-only: raw provider payloads are removed permanently by design.
};
