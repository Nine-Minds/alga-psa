/**
 * Per-inbox "trusted inbound gateway" policy and ARC seal verification.
 *
 * The seal is verified here, where the raw RFC822 bytes are at hand (every
 * ingest path carries them as `rawMimeBase64`, staged by inboundEmailSourceStager
 * or fetched through EmailProviderAdapter.downloadRawMessage), and only the
 * verdict travels into processInboundEmailInApp. Verification does DNS key
 * lookups, so it runs only for inboxes whose mode is `arc-sealed`.
 */
import type { Knex } from 'knex';
import {
  DEFAULT_INBOUND_AUTH_TRUST,
  normalizeInboundAuthTrust,
  type ArcSealVerdict,
  type InboundAuthTrustPolicy,
} from '../../lib/email/authResultsChain';

export type DnsResolver = (name: string, rrtype: string) => Promise<any>;

export interface ResolvedInboundAuthTrust {
  policy: InboundAuthTrustPolicy;
  arcSeal: ArcSealVerdict;
}

export const NO_ARC_SEAL: ArcSealVerdict = { cv: 'none', sealingAuthservId: null };

/** Reads the inbox's policy; any failure or absence is `off` (today's behaviour). */
export async function loadInboundAuthTrustPolicy(
  tenantId: string,
  providerId: string,
  db?: Knex | Knex.Transaction
): Promise<InboundAuthTrustPolicy> {
  try {
    const { tenantDb } = await import('@alga-psa/db');
    let connection = db;
    if (!connection) {
      const { getAdminConnection } = await import('@alga-psa/db/admin');
      connection = await getAdminConnection();
    }
    const row = await tenantDb(connection as Knex, tenantId)
      .table('email_providers')
      .where({ id: providerId })
      .first('inbound_auth_trust');
    return normalizeInboundAuthTrust(row?.inbound_auth_trust);
  } catch (error) {
    console.warn('inboundAuthTrust: failed to load policy; treating as off', {
      tenantId,
      providerId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ...DEFAULT_INBOUND_AUTH_TRUST };
  }
}

/**
 * Cryptographically verifies the ARC chain of a raw message (ARC-Seal and
 * ARC-Message-Signature of every instance, against the sealing domains' DNS keys).
 * Never throws: any failure is `cv: 'none'`, which is not trusted.
 */
export async function verifyArcSeal(
  rawMime: Buffer,
  options: { resolver?: DnsResolver } = {}
): Promise<ArcSealVerdict> {
  try {
    const { authenticate } = await import('mailauth');
    // No ip/sender/helo: SPF and DMARC are not evaluated (they would add DNS
    // lookups and the receiving MTA's verdicts are already in the headers).
    const { arc } = await authenticate(rawMime, {
      resolver: options.resolver,
      disableBimi: true,
      disableDmarc: true,
    });
    if (!arc) return { ...NO_ARC_SEAL };
    const result = arc.status?.result;
    if (result !== 'pass' || !arc.i) return { ...NO_ARC_SEAL, cv: result === 'fail' ? 'fail' : 'none' };
    const newest = (arc.authenticationResults as { mta?: unknown } | undefined)?.mta;
    return { cv: 'pass', sealingAuthservId: typeof newest === 'string' ? newest.toLowerCase() : null };
  } catch (error) {
    console.warn('inboundAuthTrust: ARC verification errored; treating as cv=none', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ...NO_ARC_SEAL };
  }
}

/**
 * Resolves the policy for an inbox and, only when it opted into `arc-sealed`,
 * verifies the seal of the raw message. Without raw bytes the verdict is
 * `cv: 'none'` (not trusted).
 */
export async function resolveInboundAuthTrust(params: {
  tenantId: string;
  providerId: string;
  rawMime?: Buffer | null;
  rawMimeBase64?: string | null;
  resolver?: DnsResolver;
  db?: Knex | Knex.Transaction;
}): Promise<ResolvedInboundAuthTrust> {
  const policy = await loadInboundAuthTrustPolicy(params.tenantId, params.providerId, params.db);
  if (policy.mode !== 'arc-sealed') return { policy, arcSeal: { ...NO_ARC_SEAL } };

  const rawMime = params.rawMime
    ?? (params.rawMimeBase64 ? Buffer.from(params.rawMimeBase64, 'base64') : null);
  if (!rawMime || rawMime.length === 0) return { policy, arcSeal: { ...NO_ARC_SEAL } };
  return { policy, arcSeal: await verifyArcSeal(rawMime, { resolver: params.resolver }) };
}
