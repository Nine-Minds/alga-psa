/**
 * Hudu write-through credentials backend (EE-only). Implements the
 * CredentialSource abstraction on top of the existing HuduClient and the
 * huduDataCore list/cache plumbing.
 *
 * Row ids are namespaced `hudu:{company_id}:{password_id}`. Hudu rows are
 * governed by RBAC / tier / bundle scope only — per-item grants do not apply
 * (Hudu has no enforceable equivalent), so `isRestricted` is always false.
 *
 * SECURITY: values returned from Hudu (reveal, seed reveal, create/update
 * echoes) are transient — never persisted, cached, or logged. List payloads
 * stay value-stripped (toHuduAssetPasswordSummary). Reveal audits fail-closed
 * via the existing writeHuduPasswordRevealAudit; seed reveals audit through
 * the credential audit writer. TOTP codes for Hudu rows are computed
 * server-side from the reveal-time otp_secret; the seed is discarded.
 */

import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import type {
  CredentialListFilter,
  CredentialRevealResult,
  CredentialSource,
  CredentialSourceContext,
  CredentialSummary,
  CredentialWriteInput,
} from './contracts';
import { createHuduClient, HuduRequestError } from '../integrations/hudu/huduClient';
import type { HuduClient, HuduErrorKind } from '../integrations/hudu/huduClient';
import type {
  HuduAssetPassword,
  HuduAssetPasswordSummary,
  HuduAssetPasswordWriteInput,
} from '../integrations/hudu/contracts';
import { resolveHuduCompanyIdForClient, resolveClientIdForHuduCompany } from '../integrations/hudu/companyMapping';
import { toHuduAssetPasswordSummary, clearCachedHuduList, buildHuduRecordUrl } from '../integrations/hudu/referenceData';
import { writeHuduPasswordRevealAudit } from '../integrations/hudu/revealAudit';
import { fetchCompanyList, toErrorMessage, resolveCompanyUrl } from '../integrations/hudu/huduDataCore';
import { writeCredentialAudit } from './audit';
import {
  authorizeCredentialRecord,
  createCredentialAuthorizationContext,
} from './credentialAuthorization';
import { generateTotp, normalizeOtpSecret } from './totp';

export const HUDU_CREDENTIAL_ID_PREFIX = 'hudu:';

export function isHuduCredentialId(id: string): boolean {
  return id.startsWith(HUDU_CREDENTIAL_ID_PREFIX);
}

/** `hudu:{company_id}:{password_id}` → { companyId, passwordId }. Throws on malformed. */
export function parseHuduCredentialId(id: string): { companyId: string; passwordId: string } {
  const parts = id.split(':');
  if (parts.length !== 3 || parts[0] !== 'hudu' || !parts[1] || !parts[2]) {
    throw new Error(`Malformed Hudu credential id: ${id}`);
  }
  return { companyId: parts[1], passwordId: parts[2] };
}

export function buildHuduCredentialId(companyId: string | number, passwordId: string | number): string {
  return `${HUDU_CREDENTIAL_ID_PREFIX}${companyId}:${passwordId}`;
}

function toSummary(record: HuduAssetPasswordSummary, clientId: string, externalUrl: string | null): CredentialSummary {
  return {
    id: buildHuduCredentialId(record.company_id, record.id),
    source: 'hudu',
    clientId,
    name: record.name,
    username: record.username ?? null,
    url: record.url ?? null,
    description: record.description ?? null,
    // List payloads are value-stripped; hasOtp for Hudu rows is only known at
    // reveal time (the reveal result carries the rolling code when present).
    hasOtp: false,
    isRestricted: false,
    folderName: record.password_folder_name ?? null,
    externalUrl,
    attachments: [],
    createdAt: record.created_at ?? null,
    updatedAt: record.updated_at ?? null,
  };
}

function applySearch(items: CredentialSummary[], term?: string): CredentialSummary[] {
  const normalized = term?.trim().toLowerCase();
  if (!normalized) return items;
  return items.filter((item) => {
    const haystack = [item.name, item.username, item.url].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(normalized);
  });
}

/**
 * Field names that changed in a Hudu update — names only, never values.
 * Secret-bearing fields record only the fact of change (value-free).
 */
function changedFieldsForHuduUpdate(
  input: Partial<CredentialWriteInput>,
  record: HuduAssetPassword
): string[] {
  const changed: string[] = [];
  if (input.name !== undefined && input.name.trim() !== record.name) changed.push('name');
  if (input.username !== undefined && (input.username || null) !== (record.username ?? null)) {
    changed.push('username');
  }
  if (input.password !== undefined) changed.push('password');
  if (input.otpSecret !== undefined) changed.push('otp_secret');
  if (input.url !== undefined && (input.url || null) !== (record.url ?? null)) changed.push('url');
  if (input.description !== undefined && (input.description || null) !== (record.description ?? null)) {
    changed.push('description');
  }
  return changed;
}

function huduErrorKind(error: unknown): HuduErrorKind | undefined {
  return error instanceof HuduRequestError ? error.hudu.kind : undefined;
}

/**
 * Bundle-scope check for a single Hudu row (confused-deputy guard). Hudu rows
 * carry no per-item grants; a caller with a direct `hudu:{company}:{password}`
 * id must still be denied when the authorization kernel's bundle narrowing
 * excludes the owning client (e.g. `credential read → selected_clients`). The
 * synthetic record is unrestricted with the resolved owning client, so the
 * kernel applies RBAC tier + bundle rules only — exactly the Hudu contract.
 *
 * Fail-closed: any resolution error denies rather than leaking.
 */
async function isClientInCredentialBundleScope(
  knex: Knex,
  ctx: CredentialSourceContext,
  clientId: string,
  credentialId: string
): Promise<boolean> {
  try {
    return await withTransaction(knex, async (trx) => {
      const context = await createCredentialAuthorizationContext(trx, ctx.tenant, ctx.user);
      return authorizeCredentialRecord(
        trx,
        context,
        {
          credential_id: credentialId,
          created_by: '',
          client_id: clientId,
          is_restricted: false,
        },
        []
      );
    });
  } catch {
    return false;
  }
}

/**
 * Resolve the owning client for a Hudu row id and confirm the caller's bundle
 * scope includes it. Returns the clientId when in scope, else null (denied or
 * unmapped — both are indistinguishable to the caller).
 */
async function resolveHuduRecordClientId(
  knex: Knex,
  ctx: CredentialSourceContext,
  companyId: string,
  credentialId: string
): Promise<string | null> {
  const clientId = await resolveClientIdForHuduCompany(knex, ctx.tenant, companyId);
  if (!clientId) {
    return null;
  }
  if (!(await isClientInCredentialBundleScope(knex, ctx, clientId, credentialId))) {
    return null;
  }
  return clientId;
}

/**
 * Confirm the numeric Hudu password id actually belongs to the claimed company
 * before any single-record mutation/delete (deleteAssetPassword/PUT address a
 * global password id, so an unverified id could hit another company's record).
 * Fail-closed: throws CREDENTIAL_NOT_FOUND on mismatch / unmapped / not_found.
 */
async function requireHuduRecordInCompany(
  client: HuduClient,
  passwordId: string,
  companyId: string
): Promise<HuduAssetPassword> {
  let record: HuduAssetPassword;
  try {
    record = await client.getAssetPassword(Number(passwordId));
  } catch (error) {
    if (error instanceof HuduRequestError) {
      if (error.hudu.kind === 'no_password_access') {
        throw Object.assign(new Error('Credential not found'), { code: 'CREDENTIAL_NOT_FOUND' });
      }
      if (error.hudu.kind === 'not_found') {
        throw Object.assign(new Error('Credential not found'), { code: 'CREDENTIAL_NOT_FOUND' });
      }
    }
    throw error;
  }
  if (String(record.company_id) !== companyId) {
    throw Object.assign(new Error('Credential not found'), { code: 'CREDENTIAL_NOT_FOUND' });
  }
  return record;
}

export class HuduCredentialSource implements CredentialSource {
  readonly kind = 'hudu' as const;

  async list(ctx: CredentialSourceContext, filter: CredentialListFilter): Promise<CredentialSummary[]> {
    if (!filter.clientId) {
      // Hudu rows are company-scoped; a tenant-wide aggregation resolves
      // mapped clients itself and calls list per client.
      return [];
    }
    if (filter.entityType && filter.entityId) {
      // Entity-scoped lists are association-driven and resolved by the action
      // aggregation via resolveByIds; a source-level entity filter has no Hudu
      // equivalent (Hudu rows have no entity linkage).
      return [];
    }

    // Bundle-scope guard on the LIST path too: a bundle that narrows
    // `credential read` to selected clients must hide Hudu rows of excluded
    // clients the same way it hides native restricted rows. Unmapped + excluded
    // are indistinguishable (empty result).
    const { knex } = await createTenantKnex(ctx.tenant);
    const mappedCompanyId = await resolveHuduCompanyIdForClient(knex, ctx.tenant, filter.clientId);
    if (!mappedCompanyId) {
      return [];
    }
    if (!(await isClientInCredentialBundleScope(knex, ctx, filter.clientId, `hudu:${mappedCompanyId}`))) {
      return [];
    }

    const result = await fetchCompanyList<HuduAssetPassword, HuduAssetPasswordSummary>(
      ctx.tenant,
      filter.clientId,
      'asset_passwords',
      false,
      (client, companyId) => client.getAssetPasswords(companyId),
      toHuduAssetPasswordSummary
    );

    if (result.state !== 'ok') {
      return [];
    }

    return applySearch(
      result.items.map((item) => toSummary(item, filter.clientId!, item.hudu_url ?? null)),
      filter.search
    );
  }

  /**
   * Resolve a set of association refs live against Hudu, for the
   * association-driven entity lists. Every ref is re-fetched (never served
   * from the cached list) so entity views reflect the current Hudu record.
   *
   * Returned rows carry a `prune` flag meaning "Hudu CONFIRMED this record is
   * gone" (a 404 on the password id). Only those rows may be lazily pruned
   * from credential_associations. Everything else — transport/API errors,
   * `no_password_access`, unmapped companies, bundle-scope exclusions — is
   * omitted from the response but must NEVER prune (the association may simply
   * be temporarily unresolvable or outside the caller's scope).
   */
  async resolveByIds(
    ctx: CredentialSourceContext,
    refs: string[]
  ): Promise<Array<{ ref: string; summary: CredentialSummary | null; prune: boolean }>> {
    const unique = Array.from(new Set(refs));
    if (unique.length === 0) return [];
    const { knex } = await createTenantKnex(ctx.tenant);
    const client = await createHuduClient(ctx.tenant);

    // Deep-link base URLs per company (list-path parity: the record's own URL
    // resolved against the instance, falling back to the company URL).
    const companyIds = Array.from(
      new Set(
        unique.flatMap((ref) => {
          try {
            return [parseHuduCredentialId(ref).companyId];
          } catch {
            return [];
          }
        })
      )
    );
    const companyUrlsByCompany = new Map<string, { baseUrl: string | null; companyUrl: string | null }>();
    await Promise.all(
      companyIds.map(async (companyId) => {
        companyUrlsByCompany.set(companyId, await resolveCompanyUrl(knex, ctx.tenant, companyId));
      })
    );

    return Promise.all(
      unique.map(async (ref) => {
        let companyId: string;
        let passwordId: string;
        try {
          ({ companyId, passwordId } = parseHuduCredentialId(ref));
        } catch {
          // Malformed ref cannot exist in Hudu; do not prune (nothing was
          // confirmed) — the row is simply un-resolvable for this response.
          return { ref, summary: null, prune: false };
        }

        // Bundle scope + company mapping (fail-closed: unmapped OR excluded
        // resolves to null; indistinguishable, and never a prune signal).
        const clientId = await resolveHuduRecordClientId(knex, ctx, companyId, ref);
        if (!clientId) {
          return { ref, summary: null, prune: false };
        }

        let record: HuduAssetPassword;
        try {
          record = await client.getAssetPassword(Number(passwordId));
        } catch (error) {
          if (error instanceof HuduRequestError && error.hudu.kind === 'not_found') {
            // Confirmed gone: omit AND signal the association row for pruning.
            return { ref, summary: null, prune: true };
          }
          // Transport / permission / any other API error: omit, never prune.
          return { ref, summary: null, prune: false };
        }

        if (String(record.company_id) !== companyId) {
          // The numeric password id resolved to a DIFFERENT company than the
          // ref claims — the ref is dangling. Omit; do not prune (nothing was
          // confirmed deleted, and pruning could race a mapping change).
          return { ref, summary: null, prune: false };
        }

        const projected = toHuduAssetPasswordSummary(record);
        const { baseUrl, companyUrl } = companyUrlsByCompany.get(companyId) ?? { baseUrl: null, companyUrl: null };
        const externalUrl = buildHuduRecordUrl(projected, baseUrl) ?? companyUrl;

        return {
          ref,
          summary: toSummary(projected, clientId, externalUrl),
          prune: false,
        };
      })
    );
  }

  /**
   * Owning client for a Hudu ref, exposed only when the caller's bundle scope
   * includes it (fail-closed). Returns null for unmapped companies AND
   * out-of-scope clients — indistinguishable, so association writes fail
   * closed as not-found.
   */
  async resolveOwnerClientId(ctx: CredentialSourceContext, id: string): Promise<string | null> {
    const { companyId } = parseHuduCredentialId(id);
    const { knex } = await createTenantKnex(ctx.tenant);
    return resolveHuduRecordClientId(knex, ctx, companyId, id);
  }

  async reveal(ctx: CredentialSourceContext, id: string): Promise<CredentialRevealResult> {
    try {
      const { companyId, passwordId } = parseHuduCredentialId(id);
      const { knex } = await createTenantKnex(ctx.tenant);
      // Bundle-scope guard FIRST (fail-closed): a direct id must not bypass a
      // bundle that excludes the owning client. Resolves to null for unmapped
      // companies AND out-of-scope clients — indistinguishable to the caller.
      const clientId = await resolveHuduRecordClientId(knex, ctx, companyId, id);
      if (!clientId) {
        return { state: 'not_found' };
      }

      const client = await createHuduClient(ctx.tenant);
      let record: HuduAssetPassword;
      try {
        record = await client.getAssetPassword(Number(passwordId));
      } catch (error) {
        if (error instanceof HuduRequestError) {
          if (error.hudu.kind === 'no_password_access') return { state: 'no_access' };
          if (error.hudu.kind === 'not_found') return { state: 'not_found' };
        }
        throw error;
      }

      if (String(record.company_id) !== companyId) {
        return { state: 'not_found' };
      }

      // Fail-closed: existing Hudu reveal audit shape; failure aborts reveal.
      await writeHuduPasswordRevealAudit(knex, ctx.tenant, {
        userId: ctx.userId,
        clientId,
        huduPasswordId: passwordId,
        huduCompanyId: companyId,
      });

      let otpCode: CredentialRevealResult['otpCode'] = null;
      if (record.otp_secret) {
        otpCode = generateTotp(record.otp_secret);
      }

      return { state: 'ok', password: record.password ?? '', otpCode };
    } catch (error) {
      return { state: 'error', error: toErrorMessage(error), ...(huduErrorKind(error) ? { errorKind: huduErrorKind(error) } : {}) };
    }
  }

  async revealOtpSeed(ctx: CredentialSourceContext, id: string): Promise<CredentialRevealResult> {
    try {
      const { companyId, passwordId } = parseHuduCredentialId(id);
      const { knex } = await createTenantKnex(ctx.tenant);
      const clientId = await resolveHuduRecordClientId(knex, ctx, companyId, id);
      if (!clientId) {
        return { state: 'not_found' };
      }

      const client = await createHuduClient(ctx.tenant);
      let record: HuduAssetPassword;
      try {
        record = await client.getAssetPassword(Number(passwordId));
      } catch (error) {
        if (error instanceof HuduRequestError) {
          if (error.hudu.kind === 'no_password_access') return { state: 'no_access' };
          if (error.hudu.kind === 'not_found') return { state: 'not_found' };
        }
        throw error;
      }

      if (String(record.company_id) !== companyId) {
        return { state: 'not_found' };
      }

      await writeCredentialAudit(knex, ctx.tenant, 'credential_otp_seed_reveal', {
        userId: ctx.userId,
        credentialId: id,
        clientId,
      });

      return { state: 'ok', password: record.otp_secret ?? null, otpCode: null };
    } catch (error) {
      return { state: 'error', error: toErrorMessage(error), ...(huduErrorKind(error) ? { errorKind: huduErrorKind(error) } : {}) };
    }
  }

  async create(ctx: CredentialSourceContext, input: CredentialWriteInput): Promise<CredentialSummary> {
    const { knex } = await createTenantKnex(ctx.tenant);
    const huduCompanyId = await resolveHuduCompanyIdForClient(knex, ctx.tenant, input.clientId);
    if (!huduCompanyId) {
      throw Object.assign(new Error('Client is not mapped to a Hudu company.'), { code: 'HUDU_UNMAPPED' });
    }

    const payload: HuduAssetPasswordWriteInput = {
      company_id: Number(huduCompanyId),
      name: input.name.trim(),
      username: input.username ?? null,
      password: input.password ?? null,
      otp_secret: input.otpSecret ? normalizeOtpSecret(input.otpSecret) : null,
      url: input.url ?? null,
      description: input.description ?? null,
    };

    const client = await createHuduClient(ctx.tenant);
    const created = await client.createAssetPassword(payload);
    clearCachedHuduList(ctx.tenant, huduCompanyId, 'asset_passwords');

    await writeCredentialAudit(knex, ctx.tenant, 'credential_created', {
      userId: ctx.userId,
      credentialId: buildHuduCredentialId(huduCompanyId, created.id),
      clientId: input.clientId,
    });

    return toSummary(toHuduAssetPasswordSummary(created), input.clientId, null);
  }

  async update(
    ctx: CredentialSourceContext,
    id: string,
    input: Partial<CredentialWriteInput>
  ): Promise<CredentialSummary> {
    const { companyId, passwordId } = parseHuduCredentialId(id);
    const { knex } = await createTenantKnex(ctx.tenant);

    // Resolve the owning client from the row's company (authoritative) and
    // enforce bundle scope. When the caller supplies a clientId, it must match
    // the row's owning client — otherwise the caller is claiming a mapping
    // that does not exist for this row (confused deputy).
    const clientId = await resolveHuduRecordClientId(knex, ctx, companyId, id);
    if (!clientId) {
      throw Object.assign(new Error('Credential not found'), { code: 'CREDENTIAL_NOT_FOUND' });
    }
    if (input.clientId && input.clientId !== clientId) {
      throw Object.assign(new Error('Client is not mapped to this Hudu company.'), { code: 'HUDU_UNMAPPED' });
    }

    const client = await createHuduClient(ctx.tenant);
    // Confirm the numeric password id actually belongs to the claimed company
    // before PUT (an unverified id could hit another company's record).
    const record = await requireHuduRecordInCompany(client, passwordId, companyId);

    const payload: Partial<HuduAssetPasswordWriteInput> = {};
    if (input.name !== undefined) payload.name = input.name.trim();
    if (input.username !== undefined) payload.username = input.username || null;
    if (input.password !== undefined) payload.password = input.password || null;
    if (input.otpSecret !== undefined) payload.otp_secret = input.otpSecret ? normalizeOtpSecret(input.otpSecret) : null;
    if (input.url !== undefined) payload.url = input.url || null;
    if (input.description !== undefined) payload.description = input.description || null;

    const updated = await client.updateAssetPassword(Number(passwordId), payload);
    clearCachedHuduList(ctx.tenant, companyId, 'asset_passwords');

    await writeCredentialAudit(knex, ctx.tenant, 'credential_updated', {
      userId: ctx.userId,
      credentialId: id,
      clientId,
    }, { changed_fields: changedFieldsForHuduUpdate(input, record) });

    return toSummary(toHuduAssetPasswordSummary(updated), clientId, null);
  }

  async remove(ctx: CredentialSourceContext, id: string): Promise<void> {
    const { companyId, passwordId } = parseHuduCredentialId(id);
    const { knex } = await createTenantKnex(ctx.tenant);

    // Same confused-deputy guards as update/reveal: resolve the owning client
    // authoritatively, enforce bundle scope, and confirm the numeric password
    // id belongs to the claimed company before DELETE.
    const clientId = await resolveHuduRecordClientId(knex, ctx, companyId, id);
    if (!clientId) {
      throw Object.assign(new Error('Credential not found'), { code: 'CREDENTIAL_NOT_FOUND' });
    }

    const client = await createHuduClient(ctx.tenant);
    await requireHuduRecordInCompany(client, passwordId, companyId);

    await client.deleteAssetPassword(Number(passwordId));
    clearCachedHuduList(ctx.tenant, companyId, 'asset_passwords');

    await writeCredentialAudit(knex, ctx.tenant, 'credential_deleted', {
      userId: ctx.userId,
      credentialId: id,
      clientId,
    });
  }
}

export const huduCredentialSource: HuduCredentialSource = new HuduCredentialSource();
