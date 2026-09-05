import axios from 'axios';
import { getEntraCippCredentials } from './cippSecretStore';
import { normalizeEntraSyncUser } from '../../sync/types';
import {
  EntraOperatorError,
  isTimeoutError,
} from '../../entraOperatorError';
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

function toBoolean(value: unknown, fallback = false): boolean {
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

function toStringArray(value: unknown): string[] {
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

/** How long CIPP gets to answer one call before we call it a timeout. */
const CIPP_REQUEST_TIMEOUT_MS = 20_000;

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
          timeout: CIPP_REQUEST_TIMEOUT_MS,
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

        // A rotated or revoked API key is the usual way a working CIPP
        // connection stops working, and it is the one an operator can fix.
        // Raw axios reaches the run history as "Request failed with status
        // code 401", which names neither the cause nor the remedy.
        if (axios.isAxiosError(error)) {
          const status = error.response?.status;
          if (status === 401 || status === 403) {
            throw new EntraOperatorError(
              'credential-rejected',
              'CIPP rejected the stored API credential. Rotate it from the Connection tab to resume syncing.'
            );
          }
          // A timeout is not a refusal: CIPP is up and still working, and the
          // remedy is to try again rather than to go looking at the connection.
          if (isTimeoutError(error)) {
            throw new EntraOperatorError(
              'timeout',
              `CIPP did not answer within ${Math.round(CIPP_REQUEST_TIMEOUT_MS / 1000)} seconds. It may still be gathering the directory — try again in a moment.`
            );
          }
          throw new EntraOperatorError(
            'unreachable',
            `CIPP could not be reached${status ? ` (HTTP ${status})` : ''}. The sync will retry on its next run.`
          );
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

    // CIPP-API exposes Azure Functions by name: ListTenants is the endpoint.
    // The REST-style aliases this adapter used to guess at (/api/tenant/list,
    // /api/tenants) do not exist in stock CIPP.
    const payload = await this.requestFromCandidates(credentials.baseUrl, credentials.apiToken, [
      '/api/listtenants',
    ]);
    const rows = extractCollection(payload);

    const tenants: EntraManagedTenantRecord[] = [];
    const seen = new Set<string>();

    for (const row of rows) {
      const raw = toObject(row);
      // Real CIPP ListTenants identifies a tenant as `customerId`.
      const entraTenantId =
        toStringOrNull(raw.customerId) ||
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
    input: EntraListUsersForTenantInput
  ): Promise<EntraManagedUserRecord[]> {
    const credentials = await getEntraCippCredentials(input.tenant);
    if (!credentials) {
      throw new Error('CIPP credentials are not configured.');
    }

    // Per CIPP-API source (Invoke-ListUsers.ps1): the tenant scope parameter
    // is `tenantFilter` — a customerId GUID or default domain — and the
    // response is a plain array of Graph beta user objects.
    const tenantId = encodeURIComponent(input.managedTenantId);
    const payload = await this.requestFromCandidates(credentials.baseUrl, credentials.apiToken, [
      `/api/listusers?tenantFilter=${tenantId}`,
    ]);
    const rows = extractCollection(payload);

    const users: EntraManagedUserRecord[] = [];
    const seen = new Set<string>();

    for (const row of rows) {
      const raw = toObject(row);
      const entraObjectId =
        toStringOrNull(raw.id) ||
        toStringOrNull(raw.objectId) ||
        toStringOrNull(raw.userId);
      if (!entraObjectId || seen.has(entraObjectId)) {
        continue;
      }

      seen.add(entraObjectId);

      const userPrincipalName =
        toStringOrNull(raw.userPrincipalName) ||
        toStringOrNull(raw.upn);
      const email =
        toStringOrNull(raw.mail) ||
        toStringOrNull(raw.email) ||
        userPrincipalName;

      users.push(normalizeEntraSyncUser({
        entraTenantId:
          toStringOrNull(raw.tenantId) ||
          toStringOrNull(raw.customerTenantId) ||
          input.managedTenantId,
        entraObjectId,
        userPrincipalName,
        email,
        displayName: toStringOrNull(raw.displayName) || toStringOrNull(raw.name),
        givenName: toStringOrNull(raw.givenName),
        surname: toStringOrNull(raw.surname),
        accountEnabled:
          toBoolean(raw.accountEnabled, true) &&
          toBoolean(raw.enabled, true) &&
          toBoolean(raw.isEnabled, true),
        jobTitle: toStringOrNull(raw.jobTitle) || toStringOrNull(raw.title),
        mobilePhone: toStringOrNull(raw.mobilePhone) || toStringOrNull(raw.phoneNumber),
        businessPhones:
          toStringArray(raw.businessPhones).length > 0
            ? toStringArray(raw.businessPhones)
            : toStringArray(raw.phones),
        raw,
      }));
    }

    return users;
  }

  public async listSecurityGroupsForTenant(
    input: EntraListUsersForTenantInput
  ): Promise<Array<{ id: string; displayName: string | null }>> {
    const credentials = await getEntraCippCredentials(input.tenant);
    if (!credentials) {
      throw new Error('CIPP credentials are not configured.');
    }

    // Per CIPP-API source (Invoke-ListGroups.ps1): `tenantFilter` scopes the
    // read, and the rows are Graph group objects that include ALL group types
    // — securityEnabled is selected precisely so callers can filter, which
    // the direct adapter already does and this one must match.
    const tenantId = encodeURIComponent(input.managedTenantId);
    const payload = await this.requestFromCandidates(credentials.baseUrl, credentials.apiToken, [
      `/api/listgroups?tenantFilter=${tenantId}`,
    ]);
    const rows = extractCollection(payload);
    const groups: Array<{ id: string; displayName: string | null }> = [];
    const seen = new Set<string>();

    for (const row of rows) {
      const raw = toObject(row);
      const id = toStringOrNull(raw.id) || toStringOrNull(raw.groupId) || toStringOrNull(raw.objectId);
      if (!id || seen.has(id)) continue;
      if (!toBoolean(raw.securityEnabled, true)) continue;
      seen.add(id);
      groups.push({
        id,
        displayName: toStringOrNull(raw.displayName) || toStringOrNull(raw.name),
      });
    }

    return groups;
  }

  public async isUserInSecurityGroup(input: {
    tenant: string;
    managedTenantId: string;
    userEntraObjectId: string;
    groupId: string;
    membershipMode: 'transitive';
  }): Promise<boolean> {
    const credentials = await getEntraCippCredentials(input.tenant);
    if (!credentials) {
      throw new Error('CIPP credentials are not configured.');
    }

    // Per CIPP-API source (Invoke-ListUserGroups.ps1): `tenantFilter` +
    // `userId`, returning the user's memberOf groups with a lowercase `id`
    // (the display fields are PascalCase — DisplayName, SecurityGroup).
    const tenantId = encodeURIComponent(input.managedTenantId);
    const userId = encodeURIComponent(input.userEntraObjectId);
    const payload = await this.requestFromCandidates(credentials.baseUrl, credentials.apiToken, [
      `/api/listusergroups?tenantFilter=${tenantId}&userId=${userId}`,
    ]);
    const rows = extractCollection(payload);
    const groupIds = new Set(
      rows
        .map((row) => {
          const raw = toObject(row);
          return toStringOrNull(raw.id) || toStringOrNull(raw.groupId) || toStringOrNull(raw.objectId);
        })
        .filter((value): value is string => Boolean(value))
    );
    return groupIds.has(input.groupId);
  }
}

export function createCippProviderAdapter(): EntraProviderAdapter {
  return new CippProviderAdapter();
}
