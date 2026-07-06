/**
 * Huntress public API client.
 *
 * Auth: HTTP Basic — Base64(api_key:api_secret), account-level keys generated
 * at <subdomain>.huntress.io/account/api_credentials.
 * Rate limit: 60 requests/minute sliding window per account; the client
 * spaces requests (default 1.1s) and retries 429s with backoff.
 */

import axios, { AxiosInstance } from 'axios';
import logger from '@alga-psa/core/logger';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { tenantDb } from '@alga-psa/db';
import { createTenantKnex } from '@/lib/db';
import type {
  HuntressAccount,
  HuntressAgent,
  HuntressIncidentReportsPage,
  HuntressOrganization,
  HuntressOrganizationsPage,
} from '../../../interfaces/huntress.interfaces';

export const HUNTRESS_DEFAULT_BASE_URL = 'https://api.huntress.io';
export const HUNTRESS_API_KEY_SECRET = 'huntress_api_key';
export const HUNTRESS_API_SECRET_SECRET = 'huntress_api_secret';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MIN_REQUEST_INTERVAL_MS = 1_100; // ~54 req/min, under the 60/min budget
const MAX_RATE_LIMIT_RETRIES = 2;
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 10_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface HuntressClientConfig {
  apiKey: string;
  apiSecret: string;
  baseUrl?: string;
  minRequestIntervalMs?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface ListIncidentReportsPageParams {
  page_token?: string;
  limit?: number;
}

export class HuntressClient {
  private http: AxiosInstance;
  private minIntervalMs: number;
  private lastRequestAt = 0;
  private sleep: (ms: number) => Promise<void>;

  constructor(config: HuntressClientConfig) {
    const token = Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString('base64');
    this.minIntervalMs = config.minRequestIntervalMs ?? DEFAULT_MIN_REQUEST_INTERVAL_MS;
    this.sleep = config.sleep ?? defaultSleep;
    this.http = axios.create({
      baseURL: config.baseUrl || HUNTRESS_DEFAULT_BASE_URL,
      timeout: DEFAULT_TIMEOUT_MS,
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${token}`,
      },
    });
  }

  private async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
      if (wait > 0) await this.sleep(wait);
      this.lastRequestAt = Date.now();

      try {
        const response = await this.http.get<T>(path, { params });
        return response.data;
      } catch (error) {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        if (status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
          const retryAfterRaw = axios.isAxiosError(error)
            ? error.response?.headers?.['retry-after']
            : undefined;
          const retryAfter = Number(retryAfterRaw);
          const backoff =
            Number.isFinite(retryAfter) && retryAfter > 0
              ? retryAfter * 1000
              : DEFAULT_RATE_LIMIT_BACKOFF_MS;
          logger.warn('[HuntressClient] 429 rate limited, backing off', { path, backoff });
          await this.sleep(backoff);
          continue;
        }
        throw error;
      }
    }
  }

  private async getOrNull<T>(path: string): Promise<T | null> {
    try {
      return await this.get<T>(path);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) return null;
      throw error;
    }
  }

  async getAccount(): Promise<HuntressAccount> {
    return this.get<HuntressAccount>('/v1/account');
  }

  async listOrganizations(): Promise<HuntressOrganization[]> {
    const organizations: HuntressOrganization[] = [];
    let pageToken: string | undefined;

    do {
      const page = await this.get<HuntressOrganizationsPage>('/v1/organizations', {
        limit: 500,
        ...(pageToken ? { page_token: pageToken } : {}),
      });
      organizations.push(...(page.organizations ?? []));
      pageToken = page.pagination?.next_page_token ?? undefined;
    } while (pageToken);

    return organizations;
  }

  async getOrganization(id: number): Promise<HuntressOrganization | null> {
    const data = await this.getOrNull<{ organization: HuntressOrganization }>(
      `/v1/organizations/${id}`
    );
    return data?.organization ?? null;
  }

  async listIncidentReportsPage(
    params: ListIncidentReportsPageParams = {}
  ): Promise<HuntressIncidentReportsPage> {
    return this.get<HuntressIncidentReportsPage>('/v1/incident_reports', {
      limit: params.limit ?? 500,
      sort_field: 'updated_at',
      sort_direction: 'desc',
      ...(params.page_token ? { page_token: params.page_token } : {}),
    });
  }

  async getAgent(id: number): Promise<HuntressAgent | null> {
    const data = await this.getOrNull<{ agent: HuntressAgent }>(`/v1/agents/${id}`);
    return data?.agent ?? null;
  }
}

/**
 * Build a client from tenant-scoped secrets. Returns null when credentials
 * are not configured (caller surfaces the error state).
 */
export async function createHuntressClient(tenantId: string): Promise<HuntressClient | null> {
  const secretProvider = await getSecretProviderInstance();
  const [apiKey, apiSecret] = await Promise.all([
    secretProvider.getTenantSecret(tenantId, HUNTRESS_API_KEY_SECRET),
    secretProvider.getTenantSecret(tenantId, HUNTRESS_API_SECRET_SECRET),
  ]);
  if (!apiKey || !apiSecret) return null;

  const { knex } = await createTenantKnex();
  const row = await tenantDb(knex, tenantId).table('rmm_integrations')
    .where({ provider: 'huntress' })
    .first('instance_url');

  return new HuntressClient({
    apiKey,
    apiSecret,
    baseUrl: row?.instance_url || undefined,
  });
}
