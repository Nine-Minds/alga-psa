import crypto from 'node:crypto';
import { generateKeyPair, exportJWK, importJWK, type JWK } from 'jose';
import { getConnection } from '@/lib/db/db';

// jose v6 removed the `KeyLike` export; keys are `CryptoKey | Uint8Array`.
type SigningKey = Awaited<ReturnType<typeof importJWK>>;

/**
 * Signing keys for AlgaPSA-issued MCP access tokens (plan: Alga as MCP AS).
 *
 * Keys are instance-wide (the AS signs regardless of tenant) and persisted in
 * `mcp_oauth_signing_keys` so they survive restarts and support rotation. We use
 * ES256 (EC P-256) and publish the public JWK at the JWKS endpoint so the resource
 * server — and any conformant introspector — can verify tokens.
 */

const ALG = 'ES256';

interface SigningKeyRow {
  kid: string;
  alg: string;
  private_jwk: JWK;
  public_jwk: JWK;
  active: boolean;
}

export interface ActiveSigningKey {
  kid: string;
  alg: string;
  privateKey: SigningKey;
}

let cachedActive: ActiveSigningKey | null = null;
const verifyKeyCache = new Map<string, SigningKey>();

function parseJwk(value: JWK | string): JWK {
  return typeof value === 'string' ? (JSON.parse(value) as JWK) : value;
}

/** The active signing key, generating + persisting one on first use. */
export async function getActiveSigningKey(): Promise<ActiveSigningKey> {
  if (cachedActive) return cachedActive;
  const knex = await getConnection(null);

  const existing = (await knex('mcp_oauth_signing_keys')
    .where({ active: true })
    .orderBy('created_at', 'desc')
    .first()) as SigningKeyRow | undefined;

  if (existing) {
    const privateKey = (await importJWK(parseJwk(existing.private_jwk), existing.alg)) as SigningKey;
    cachedActive = { kid: existing.kid, alg: existing.alg, privateKey };
    return cachedActive;
  }

  // First run (or post-rotation with no active key): mint one.
  const { publicKey, privateKey } = await generateKeyPair(ALG, { extractable: true });
  const privateJwk = await exportJWK(privateKey);
  const publicJwk = await exportJWK(publicKey);
  const kid = crypto.randomUUID();
  publicJwk.kid = kid;
  publicJwk.alg = ALG;
  publicJwk.use = 'sig';
  privateJwk.kid = kid;

  await knex('mcp_oauth_signing_keys')
    .insert({
      kid,
      alg: ALG,
      private_jwk: JSON.stringify(privateJwk),
      public_jwk: JSON.stringify(publicJwk),
      active: true,
    })
    .onConflict('kid')
    .ignore();

  cachedActive = { kid, alg: ALG, privateKey: privateKey as SigningKey };
  return cachedActive;
}

/** Resolve a verification key by `kid` (for token validation at the RS). */
export async function getVerificationKey(kid: string): Promise<SigningKey | null> {
  const hit = verifyKeyCache.get(kid);
  if (hit) return hit;
  const knex = await getConnection(null);
  const row = (await knex('mcp_oauth_signing_keys').where({ kid }).first()) as
    | SigningKeyRow
    | undefined;
  if (!row) return null;
  const key = (await importJWK(parseJwk(row.public_jwk), row.alg)) as SigningKey;
  verifyKeyCache.set(kid, key);
  return key;
}

/** Public JWKS document (current + any retained previous keys). */
export async function getPublicJwks(): Promise<{ keys: JWK[] }> {
  const knex = await getConnection(null);
  const rows = (await knex('mcp_oauth_signing_keys').orderBy('created_at', 'desc')) as SigningKeyRow[];
  // Ensure at least one key exists so JWKS is never empty.
  if (rows.length === 0) {
    await getActiveSigningKey();
    return getPublicJwks();
  }
  return { keys: rows.map((r) => parseJwk(r.public_jwk)) };
}

/** Test/rotation helper — clears in-process caches. */
export function _resetKeyCaches(): void {
  cachedActive = null;
  verifyKeyCache.clear();
}
