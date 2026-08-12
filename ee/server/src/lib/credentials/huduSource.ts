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

import { createTenantKnex } from '@alga-psa/db';
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
import { toHuduAssetPasswordSummary, clearCachedHuduList } from '../integrations/hudu/referenceData';
import { writeHuduPasswordRevealAudit } from '../integrations/hudu/revealAudit';
import { fetchCompanyList, toErrorMessage } from '../integrations/hudu/huduDataCore';
import { writeCredentialAudit } from './audit';
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
    attachedAssetIds: [],
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

function huduErrorKind(error: unknown): HuduErrorKind | undefined {
  return error instanceof HuduRequestError ? error.hudu.kind : undefined;
}

export class HuduCredentialSource implements CredentialSource {
  readonly kind = 'hudu' as const;

  async list(ctx: CredentialSourceContext, filter: CredentialListFilter): Promise<CredentialSummary[]> {
    if (!filter.clientId) {
      // Hudu rows are company-scoped; without a client the aggregation handles
      // only native rows. No Hudu traffic for tenant-wide searches in v1.
      return [];
    }
    if (filter.assetId) {
      // v1 Hudu writes are company-scoped; no asset-attachment linkage.
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

  async reveal(ctx: CredentialSourceContext, id: string): Promise<CredentialRevealResult> {
    try {
      const { companyId, passwordId } = parseHuduCredentialId(id);
      const { knex } = await createTenantKnex(ctx.tenant);
      const clientId = await resolveClientIdForHuduCompany(knex, ctx.tenant, companyId);
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
      const clientId = await resolveClientIdForHuduCompany(knex, ctx.tenant, companyId);
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
    const huduCompanyId = await resolveHuduCompanyIdForClient(knex, ctx.tenant, input.clientId ?? '');
    if (!huduCompanyId || huduCompanyId !== companyId) {
      throw Object.assign(new Error('Client is not mapped to this Hudu company.'), { code: 'HUDU_UNMAPPED' });
    }

    const payload: Partial<HuduAssetPasswordWriteInput> = {};
    if (input.name !== undefined) payload.name = input.name.trim();
    if (input.username !== undefined) payload.username = input.username || null;
    if (input.password !== undefined) payload.password = input.password || null;
    if (input.otpSecret !== undefined) payload.otp_secret = input.otpSecret ? normalizeOtpSecret(input.otpSecret) : null;
    if (input.url !== undefined) payload.url = input.url || null;
    if (input.description !== undefined) payload.description = input.description || null;

    const client = await createHuduClient(ctx.tenant);
    const updated = await client.updateAssetPassword(Number(passwordId), payload);
    clearCachedHuduList(ctx.tenant, huduCompanyId, 'asset_passwords');

    await writeCredentialAudit(knex, ctx.tenant, 'credential_updated', {
      userId: ctx.userId,
      credentialId: id,
      clientId: input.clientId ?? '',
    });

    return toSummary(toHuduAssetPasswordSummary(updated), input.clientId ?? '', null);
  }

  async remove(ctx: CredentialSourceContext, id: string): Promise<void> {
    const { companyId, passwordId } = parseHuduCredentialId(id);
    const { knex } = await createTenantKnex(ctx.tenant);
    const client = await createHuduClient(ctx.tenant);
    await client.deleteAssetPassword(Number(passwordId));
    clearCachedHuduList(ctx.tenant, companyId, 'asset_passwords');

    await writeCredentialAudit(knex, ctx.tenant, 'credential_deleted', {
      userId: ctx.userId,
      credentialId: id,
      clientId: '',
    });
  }
}

export const huduCredentialSource: CredentialSource = new HuduCredentialSource();
