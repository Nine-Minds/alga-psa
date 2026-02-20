import axios from 'axios';
import { getEntraCippCredentials } from './cippSecretStore';
import type {
  EntraListManagedTenantsInput,
  EntraListUsersForTenantInput,
  EntraManagedTenantRecord,
  EntraManagedUserRecord,
  EntraProviderAdapter,
} from '../types';

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function extractCollection(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  const obj = toObject(payload);
  if (Array.isArray(obj.data)) return obj.data;
  if (Array.isArray(obj.tenants)) return obj.tenants;
  if (Array.isArray(obj.value)) return obj.value;
  if (Array.isArray(obj.items)) return obj.items;
  return [];
}

function extractPrimaryDomain(raw: Record<string, unknown>): string | null {
  const direct =
    toStringOrNull(raw.primaryDomain) ||
    toStringOrNull(raw.defaultDomainName) ||
    toStringOrNull(raw.domainName) ||
    toStringOrNull(raw.domain);
  if (direct) {
    return direct;
  }

  const domains = raw.domains;
  if (Array.isArray(domains)) {
    for (const item of domains) {
      if (typeof item === 'string' && item.trim().length > 0) {
        return item.trim();
      }
      const record = toObject(item);
      const candidate =
        toStringOrNull(record.domainName) ||
        toStringOrNull(record.defaultDomainName) ||
        toStringOrNull(record.name);
      if (candidate) {
        return candidate;
      }
    }
  }

  return null;
}

export class CippProviderAdapter implements EntraProviderAdapter {
  public readonly connectionType = 'cipp' as const;

  private async requestFromCandidates(
    baseUrl: string,
    apiToken: string,
    candidates: string[]
  ): Promise<unknown> {
    let lastError: Error | null = null;

    for (const candidate of candidates) {
      const url = `${baseUrl.replace(/\/+$/, '')}${candidate}`;
      try {
        const response = await axios.get(url, {
          timeout: 20_000,
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'X-API-KEY': apiToken,
          },
        });
        return response.data;
      } catch (error: unknown) {
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          lastError = error;
          continue;
        }

        throw error;
      }
    }

    if (lastError) {
      throw lastError;
    }

    throw new Error('No CIPP endpoint candidates were configured.');
  }

  public async listManagedTenants(
    input: EntraListManagedTenantsInput
  ): Promise<EntraManagedTenantRecord[]> {
    const credentials = await getEntraCippCredentials(input.tenant);
    if (!credentials) {
      throw new Error('CIPP credentials are not configured.');
    }

    const payload = await this.requestFromCandidates(credentials.baseUrl, credentials.apiToken, [
      '/api/listtenants',
      '/api/tenant/list',
      '/api/tenants',
    ]);
    const rows = extractCollection(payload);

    const tenants: EntraManagedTenantRecord[] = [];
    const seen = new Set<string>();

    for (const row of rows) {
      const raw = toObject(row);
      const entraTenantId =
        toStringOrNull(raw.tenantId) ||
        toStringOrNull(raw.id) ||
        toStringOrNull(raw.customerTenantId);
      if (!entraTenantId || seen.has(entraTenantId)) {
        continue;
      }

      seen.add(entraTenantId);
      tenants.push({
        entraTenantId,
        displayName:
          toStringOrNull(raw.displayName) ||
          toStringOrNull(raw.name) ||
          toStringOrNull(raw.tenantName),
        primaryDomain: extractPrimaryDomain(raw),
        sourceUserCount:
          toNumber(raw.userCount) ||
          toNumber(raw.usersCount) ||
          toNumber(raw.licensedUsers),
        raw,
      });
    }

    return tenants;
  }

  public async listUsersForTenant(
    _input: EntraListUsersForTenantInput
  ): Promise<EntraManagedUserRecord[]> {
    throw new Error('CippProviderAdapter.listUsersForTenant is not implemented yet.');
  }
}

export function createCippProviderAdapter(): EntraProviderAdapter {
  return new CippProviderAdapter();
}
