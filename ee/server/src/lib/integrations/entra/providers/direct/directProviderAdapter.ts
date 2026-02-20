import axios, { AxiosError } from 'axios';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { refreshEntraDirectToken } from '../../auth/refreshDirectToken';
import { ENTRA_DIRECT_SECRET_KEYS } from '../../secrets';
import type {
  EntraListManagedTenantsInput,
  EntraListUsersForTenantInput,
  EntraManagedTenantRecord,
  EntraManagedUserRecord,
  EntraProviderAdapter,
} from '../types';

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getFirstString(value: unknown, fallback = ''): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return fallback;
}

function getNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function getNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function extractPrimaryDomain(raw: Record<string, unknown>): string | null {
  const explicitDomain =
    getNullableString(raw.defaultDomainName) ||
    getNullableString(raw.primaryDomain) ||
    getNullableString(raw.domainName);
  if (explicitDomain) {
    return explicitDomain;
  }

  const domains = raw.domains;
  if (Array.isArray(domains)) {
    for (const domain of domains) {
      if (typeof domain === 'string' && domain.trim().length > 0) {
        return domain.trim();
      }

      if (domain && typeof domain === 'object') {
        const value = domain as Record<string, unknown>;
        const candidate =
          getNullableString(value.defaultDomainName) ||
          getNullableString(value.domainName) ||
          getNullableString(value.name);
        if (candidate) {
          return candidate;
        }
      }
    }
  }

  return null;
}

export class DirectProviderAdapter implements EntraProviderAdapter {
  public readonly connectionType = 'direct' as const;

  private async getAccessToken(tenant: string): Promise<string> {
    const secretProvider = await getSecretProviderInstance();
    const accessToken = await secretProvider.getTenantSecret(
      tenant,
      ENTRA_DIRECT_SECRET_KEYS.accessToken
    );
    const expiresAtRaw = await secretProvider.getTenantSecret(
      tenant,
      ENTRA_DIRECT_SECRET_KEYS.tokenExpiresAt
    );
    const expiresAt = expiresAtRaw ? Date.parse(expiresAtRaw) : NaN;
    const isExpired = Number.isFinite(expiresAt) && expiresAt <= Date.now() + 30_000;

    if (accessToken && !isExpired) {
      return accessToken;
    }

    const refreshed = await refreshEntraDirectToken(tenant);
    return refreshed.accessToken;
  }

  private async graphGet(
    tenant: string,
    url: string
  ): Promise<Record<string, unknown>> {
    const request = async (accessToken: string) =>
      axios.get(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 20_000,
      });

    let accessToken = await this.getAccessToken(tenant);

    try {
      const response = await request(accessToken);
      return toObject(response.data);
    } catch (error) {
      const status = (error as AxiosError).response?.status;
      if (status === 401) {
        const refreshed = await refreshEntraDirectToken(tenant);
        accessToken = refreshed.accessToken;
        const retry = await request(accessToken);
        return toObject(retry.data);
      }
      throw error;
    }
  }

  public async listManagedTenants(
    input: EntraListManagedTenantsInput
  ): Promise<EntraManagedTenantRecord[]> {
    const tenants: EntraManagedTenantRecord[] = [];
    const seenTenantIds = new Set<string>();
    let nextUrl = `${GRAPH_BASE_URL}/tenantRelationships/managedTenants/tenants?$top=999`;

    while (nextUrl) {
      const payload = await this.graphGet(input.tenant, nextUrl);
      const rows = Array.isArray(payload.value) ? payload.value : [];

      for (const row of rows) {
        const raw = toObject(row);
        const entraTenantId =
          getFirstString(raw.tenantId) || getFirstString(raw.id);
        if (!entraTenantId || seenTenantIds.has(entraTenantId)) {
          continue;
        }

        seenTenantIds.add(entraTenantId);

        tenants.push({
          entraTenantId,
          displayName: getNullableString(raw.displayName),
          primaryDomain: extractPrimaryDomain(raw),
          sourceUserCount: getNumber(raw.userCount),
          raw,
        });
      }

      const candidateNextLink = getNullableString(payload['@odata.nextLink']);
      nextUrl = candidateNextLink || '';
    }

    return tenants;
  }

  public async listUsersForTenant(
    _input: EntraListUsersForTenantInput
  ): Promise<EntraManagedUserRecord[]> {
    throw new Error('DirectProviderAdapter.listUsersForTenant is not implemented yet.');
  }
}

export function createDirectProviderAdapter(): EntraProviderAdapter {
  return new DirectProviderAdapter();
}
