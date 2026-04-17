import axios, { AxiosError } from 'axios';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { refreshEntraDirectToken } from '../../auth/refreshDirectToken';
import { ENTRA_DIRECT_SECRET_KEYS } from '../../secrets';
import { normalizeEntraSyncUser } from '../../sync/types';
import type {
  EntraListManagedTenantsInput,
  EntraListUsersForTenantInput,
  EntraManagedTenantRecord,
  EntraManagedUserRecord,
  EntraProviderAdapter,
} from '../types';

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';

// Smoke-only: when enabled, swap the GDAP-backed managedTenants/* endpoints for
// /organization and /users so the partner's own tenant acts as a single managed
// tenant for end-to-end testing without a CSP/GDAP relationship. Never enable in production.
const IS_SELF_TENANT_SMOKE =
  (process.env.ENTRA_DIRECT_SMOKE_SELF_TENANT_MODE || '').toLowerCase() === 'true';

// Smoke-only: partition the self-tenant /users response into N synthetic managed
// tenants so Flow 2 (cross-client bleed) can be exercised without real CSP/GDAP.
// Format: comma-separated `id|domain|displayName` entries. Users are distributed
// across buckets by index-mod-N, so each client sees a disjoint subset.
interface SyntheticSmokeTenant {
  id: string;
  domain: string;
  displayName: string;
}

function parseSyntheticSmokeTenants(raw: string | undefined): SyntheticSmokeTenant[] {
  if (!raw) return [];
  const specs: SyntheticSmokeTenant[] = [];
  for (const entry of raw.split(',')) {
    const parts = entry.split('|').map((part) => part.trim());
    if (parts.length < 3) continue;
    const [id, domain, displayName] = parts;
    if (id && domain && displayName) {
      specs.push({ id, domain, displayName });
    }
  }
  return specs;
}

const SYNTHETIC_SMOKE_TENANTS: SyntheticSmokeTenant[] = IS_SELF_TENANT_SMOKE
  ? parseSyntheticSmokeTenants(process.env.ENTRA_DIRECT_SMOKE_SYNTHETIC_TENANTS)
  : [];

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

function getBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return fallback;
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const output: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && item.trim().length > 0) {
      output.push(item.trim());
    }
  }
  return output;
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
    if (IS_SELF_TENANT_SMOKE) {
      return this.listSelfTenantAsManaged(input);
    }

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
    input: EntraListUsersForTenantInput
  ): Promise<EntraManagedUserRecord[]> {
    if (IS_SELF_TENANT_SMOKE) {
      return this.listSelfTenantUsers(input);
    }

    const users: EntraManagedUserRecord[] = [];
    const seenObjectIds = new Set<string>();
    const encodedTenant = encodeURIComponent(input.managedTenantId);
    const select = [
      'id',
      'tenantId',
      'displayName',
      'givenName',
      'surname',
      'mail',
      'userPrincipalName',
      'accountEnabled',
      'jobTitle',
      'mobilePhone',
      'businessPhones',
    ].join(',');

    let nextUrl =
      `${GRAPH_BASE_URL}/tenantRelationships/managedTenants/users` +
      `?$filter=tenantId eq '${encodedTenant}'&$select=${select}&$top=999`;

    while (nextUrl) {
      const payload = await this.graphGet(input.tenant, nextUrl);
      const rows = Array.isArray(payload.value) ? payload.value : [];

      for (const row of rows) {
        const raw = toObject(row);
        const entraObjectId = getFirstString(raw.id);
        if (!entraObjectId || seenObjectIds.has(entraObjectId)) {
          continue;
        }

        seenObjectIds.add(entraObjectId);

        const userPrincipalName = getNullableString(raw.userPrincipalName);
        const email = getNullableString(raw.mail) || userPrincipalName;
        const entraTenantId = getNullableString(raw.tenantId) || input.managedTenantId;

        users.push(normalizeEntraSyncUser({
          entraTenantId,
          entraObjectId,
          userPrincipalName,
          email,
          displayName: getNullableString(raw.displayName),
          givenName: getNullableString(raw.givenName),
          surname: getNullableString(raw.surname),
          accountEnabled: getBoolean(raw.accountEnabled, true),
          jobTitle: getNullableString(raw.jobTitle),
          mobilePhone: getNullableString(raw.mobilePhone),
          businessPhones: getStringArray(raw.businessPhones),
          raw,
        }));
      }

      const candidateNextLink = getNullableString(payload['@odata.nextLink']);
      nextUrl = candidateNextLink || '';
    }

    return users;
  }

  private async listSelfTenantAsManaged(
    input: EntraListManagedTenantsInput
  ): Promise<EntraManagedTenantRecord[]> {
    if (SYNTHETIC_SMOKE_TENANTS.length > 0) {
      return SYNTHETIC_SMOKE_TENANTS.map((spec) => ({
        entraTenantId: spec.id,
        displayName: spec.displayName,
        primaryDomain: spec.domain,
        sourceUserCount: 0,
        raw: { __smokeSynthetic: true, id: spec.id, domain: spec.domain },
      }));
    }

    const payload = await this.graphGet(input.tenant, `${GRAPH_BASE_URL}/organization`);
    const rows = Array.isArray(payload.value) ? payload.value : [];
    const tenants: EntraManagedTenantRecord[] = [];

    for (const row of rows) {
      const raw = toObject(row);
      const entraTenantId = getFirstString(raw.id);
      if (!entraTenantId) continue;

      const verifiedDomains = Array.isArray(raw.verifiedDomains) ? raw.verifiedDomains : [];
      let primaryDomain: string | null = null;
      let initialDomain: string | null = null;
      for (const domain of verifiedDomains) {
        const d = toObject(domain);
        const name = getNullableString(d.name);
        if (!name) continue;
        if (getBoolean(d.isDefault)) {
          primaryDomain = name;
        } else if (!initialDomain && getBoolean(d.isInitial)) {
          initialDomain = name;
        }
      }

      tenants.push({
        entraTenantId,
        displayName: getNullableString(raw.displayName),
        primaryDomain: primaryDomain || initialDomain,
        sourceUserCount: 0,
        raw,
      });
    }

    return tenants;
  }

  private async listSelfTenantUsers(
    input: EntraListUsersForTenantInput
  ): Promise<EntraManagedUserRecord[]> {
    const allUsers = await this.fetchSelfTenantUsersRaw(input.tenant, input.managedTenantId);

    if (SYNTHETIC_SMOKE_TENANTS.length > 0) {
      const bucketIndex = SYNTHETIC_SMOKE_TENANTS.findIndex((t) => t.id === input.managedTenantId);
      if (bucketIndex < 0) {
        return [];
      }
      const stride = SYNTHETIC_SMOKE_TENANTS.length;
      // Stable ordering so partitions are deterministic across calls.
      const sorted = [...allUsers].sort((a, b) => a.entraObjectId.localeCompare(b.entraObjectId));
      return sorted
        .filter((_, index) => index % stride === bucketIndex)
        .map((user) => ({ ...user, entraTenantId: SYNTHETIC_SMOKE_TENANTS[bucketIndex].id }));
    }

    return allUsers;
  }

  private async fetchSelfTenantUsersRaw(
    tenant: string,
    defaultEntraTenantId: string
  ): Promise<EntraManagedUserRecord[]> {
    const users: EntraManagedUserRecord[] = [];
    const seenObjectIds = new Set<string>();
    const select = [
      'id',
      'displayName',
      'givenName',
      'surname',
      'mail',
      'userPrincipalName',
      'accountEnabled',
      'jobTitle',
      'mobilePhone',
      'businessPhones',
    ].join(',');

    let nextUrl = `${GRAPH_BASE_URL}/users?$select=${select}&$top=999`;

    while (nextUrl) {
      const payload = await this.graphGet(tenant, nextUrl);
      const rows = Array.isArray(payload.value) ? payload.value : [];

      for (const row of rows) {
        const raw = toObject(row);
        const entraObjectId = getFirstString(raw.id);
        if (!entraObjectId || seenObjectIds.has(entraObjectId)) continue;
        seenObjectIds.add(entraObjectId);

        const userPrincipalName = getNullableString(raw.userPrincipalName);
        const email = getNullableString(raw.mail) || userPrincipalName;

        users.push(normalizeEntraSyncUser({
          entraTenantId: defaultEntraTenantId,
          entraObjectId,
          userPrincipalName,
          email,
          displayName: getNullableString(raw.displayName),
          givenName: getNullableString(raw.givenName),
          surname: getNullableString(raw.surname),
          accountEnabled: getBoolean(raw.accountEnabled, true),
          jobTitle: getNullableString(raw.jobTitle),
          mobilePhone: getNullableString(raw.mobilePhone),
          businessPhones: getStringArray(raw.businessPhones),
          raw,
        }));
      }

      const candidateNextLink = getNullableString(payload['@odata.nextLink']);
      nextUrl = candidateNextLink || '';
    }

    return users;
  }
}

export function createDirectProviderAdapter(): EntraProviderAdapter {
  return new DirectProviderAdapter();
}
