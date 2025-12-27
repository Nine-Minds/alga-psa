/**
 * NinjaOne API Client
 *
 * A TypeScript client for interacting with the NinjaOne Public API v2.
 * Handles OAuth token management, automatic token refresh, and rate limiting.
 */

import axios, { AxiosInstance, AxiosError, AxiosRequestConfig } from 'axios';
import { getSecretProviderInstance } from '@alga-psa/shared/core/secretProvider';
import logger from '@shared/core/logger';
import type {
  NinjaOneOAuthCredentials,
  NinjaOneOAuthTokenResponse,
  NinjaOneOrganization,
  NinjaOneOrganizationsResponse,
  NinjaOneDevice,
  NinjaOneDeviceDetail,
  NinjaOneDevicesResponse,
  NinjaOneAlert,
  NinjaOneAlertsResponse,
  NinjaOneActivity,
  NinjaOneDeviceLink,
  NinjaOneDevicePatchStatus,
  NinjaOneOrganizationQueryParams,
  NinjaOneDeviceQueryParams,
  NinjaOneAlertQueryParams,
  NinjaOneActivityQueryParams,
  NinjaOneApiError,
  NinjaOneRegion,
  WebhookConfiguration,
} from '../../../interfaces/ninjaone.interfaces';
import { NINJAONE_REGIONS } from '../../../interfaces/ninjaone.interfaces';

// Secret names for NinjaOne credentials
const NINJAONE_CLIENT_ID_SECRET = 'ninjaone_client_id';
const NINJAONE_CLIENT_SECRET_SECRET = 'ninjaone_client_secret';
const NINJAONE_CREDENTIALS_SECRET = 'ninjaone_credentials';

type NinjaOneClientCredentials = {
  clientId?: string;
  clientSecret?: string;
};

const resolveNinjaOneClientCredentials = async (
  tenantId?: string
): Promise<NinjaOneClientCredentials> => {
  const secretProvider = await getSecretProviderInstance();
  let clientId: string | undefined;
  let clientSecret: string | undefined;

  if (tenantId) {
    clientId = await secretProvider.getTenantSecret(tenantId, NINJAONE_CLIENT_ID_SECRET);
    clientSecret = await secretProvider.getTenantSecret(tenantId, NINJAONE_CLIENT_SECRET_SECRET);
  }

  if (!clientId) {
    clientId = await secretProvider.getAppSecret(NINJAONE_CLIENT_ID_SECRET);
  }
  if (!clientSecret) {
    clientSecret = await secretProvider.getAppSecret(NINJAONE_CLIENT_SECRET_SECRET);
  }

  if (!clientId) {
    clientId = process.env.NINJAONE_CLIENT_ID;
  }
  if (!clientSecret) {
    clientSecret = process.env.NINJAONE_CLIENT_SECRET;
  }

  return { clientId, clientSecret };
};

// Default configuration
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const TOKEN_REFRESH_BUFFER = 300; // 5 minutes before expiry

/**
 * Extract safe error info for logging (avoids circular reference issues with axios errors)
 */
function extractErrorInfo(error: unknown): object {
  if (axios.isAxiosError(error)) {
    return {
      message: error.message,
      code: error.code,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      url: error.config?.url,
    };
  }
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
    };
  }
  return { message: String(error) };
}

export interface NinjaOneClientConfig {
  tenantId: string;
  region?: NinjaOneRegion;
  instanceUrl?: string;
}

export class NinjaOneClient {
  private tenantId: string;
  private instanceUrl: string;
  private axiosInstance: AxiosInstance;
  private credentials: NinjaOneOAuthCredentials | null = null;
  private refreshPromise: Promise<void> | null = null;

  constructor(config: NinjaOneClientConfig) {
    this.tenantId = config.tenantId;
    this.instanceUrl = config.instanceUrl || NINJAONE_REGIONS[config.region || 'US'];

    this.axiosInstance = axios.create({
      baseURL: `${this.instanceUrl}/v2`,
      timeout: DEFAULT_TIMEOUT,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    });

    // Add request interceptor for auth
    this.axiosInstance.interceptors.request.use(
      async (config) => {
        const token = await this.getValidAccessToken();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Add response interceptor for error handling and token refresh
    this.axiosInstance.interceptors.response.use(
      (response) => response,
      async (error: AxiosError<NinjaOneApiError>) => {
        const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };

        // If 401 and not already retried, try refreshing token
        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;

          try {
            await this.refreshAccessToken();
            const token = await this.getValidAccessToken();
            if (token && originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${token}`;
            }
            return this.axiosInstance(originalRequest);
          } catch (refreshError) {
            logger.error('[NinjaOneClient] Token refresh failed:', extractErrorInfo(refreshError));
            throw refreshError;
          }
        }

        // Log API errors
        if (error.response?.data) {
          logger.error('[NinjaOneClient] API error:', {
            status: error.response.status,
            error: error.response.data,
            url: originalRequest.url,
          });
        }

        throw error;
      }
    );
  }

  /**
   * Load credentials from secret storage
   */
  private async loadCredentials(): Promise<NinjaOneOAuthCredentials | null> {
    try {
      const secretProvider = await getSecretProviderInstance();
      const credentialsJson = await secretProvider.getTenantSecret(
        this.tenantId,
        NINJAONE_CREDENTIALS_SECRET
      );

      if (!credentialsJson) {
        return null;
      }

      const credentials = JSON.parse(credentialsJson) as NinjaOneOAuthCredentials;
      this.credentials = credentials;
      return credentials;
    } catch (error) {
      logger.error('[NinjaOneClient] Failed to load credentials:', extractErrorInfo(error));
      return null;
    }
  }

  /**
   * Save credentials to secret storage
   */
  private async saveCredentials(credentials: NinjaOneOAuthCredentials): Promise<void> {
    try {
      const secretProvider = await getSecretProviderInstance();
      await secretProvider.setTenantSecret(
        this.tenantId,
        NINJAONE_CREDENTIALS_SECRET,
        JSON.stringify(credentials)
      );
      this.credentials = credentials;
    } catch (error) {
      logger.error('[NinjaOneClient] Failed to save credentials:', extractErrorInfo(error));
      throw error;
    }
  }

  /**
   * Get a valid access token, refreshing if necessary
   */
  private async getValidAccessToken(): Promise<string | null> {
    if (!this.credentials) {
      await this.loadCredentials();
    }

    if (!this.credentials) {
      return null;
    }

    // Check if token is expired or will expire soon
    const now = Date.now();
    const expiresAt = this.credentials.expires_at;

    if (now >= expiresAt - TOKEN_REFRESH_BUFFER * 1000) {
      await this.refreshAccessToken();
    }

    return this.credentials?.access_token || null;
  }

  /**
   * Refresh the access token using the refresh token
   */
  private async refreshAccessToken(): Promise<void> {
    // Prevent multiple simultaneous refresh calls
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      try {
        if (!this.credentials?.refresh_token) {
          throw new Error('No refresh token available');
        }

        const { clientId, clientSecret } = await resolveNinjaOneClientCredentials(this.tenantId);

        if (!clientId || !clientSecret) {
          throw new Error('NinjaOne client credentials not configured. Please set NINJAONE_CLIENT_ID and NINJAONE_CLIENT_SECRET environment variables or configure the secrets.');
        }

        const tokenUrl = `${this.instanceUrl}/oauth/token`;
        const params = new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.credentials.refresh_token,
          client_id: clientId,
          client_secret: clientSecret,
        });

        const response = await axios.post<NinjaOneOAuthTokenResponse>(
          tokenUrl,
          params.toString(),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            timeout: DEFAULT_TIMEOUT,
          }
        );

        const { access_token, refresh_token, expires_in } = response.data;

        const newCredentials: NinjaOneOAuthCredentials = {
          access_token,
          refresh_token,
          expires_at: Date.now() + expires_in * 1000,
          instance_url: this.instanceUrl,
        };

        await this.saveCredentials(newCredentials);

        logger.info('[NinjaOneClient] Successfully refreshed access token', {
          tenantId: this.tenantId,
        });
      } catch (error) {
        logger.error('[NinjaOneClient] Failed to refresh access token:', extractErrorInfo(error));
        throw error;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  /**
   * Check if the client is connected and has valid credentials
   */
  async isConnected(): Promise<boolean> {
    const credentials = await this.loadCredentials();
    return credentials !== null;
  }

  // ============ Organizations API ============

  /**
   * Get all organizations
   */
  async getOrganizations(params?: NinjaOneOrganizationQueryParams): Promise<NinjaOneOrganization[]> {
    const organizations: NinjaOneOrganization[] = [];
    let cursor: string | undefined = params?.after;

    do {
      const queryParams: Record<string, string | number> = {
        pageSize: params?.pageSize || 100,
      };

      if (cursor) queryParams.after = cursor;

      const response = await this.axiosInstance.get<NinjaOneOrganization[]>('/organizations', {
        params: queryParams,
      });

      organizations.push(...response.data);

      // Check for pagination cursor in response headers
      const linkHeader = response.headers['link'];
      cursor = this.extractCursorFromLink(linkHeader);
    } while (cursor);

    return organizations;
  }

  /**
   * Get organization by ID
   */
  async getOrganization(orgId: number): Promise<NinjaOneOrganization> {
    const response = await this.axiosInstance.get<NinjaOneOrganization>(
      `/organization/${orgId}`
    );
    return response.data;
  }

  // ============ Devices API ============

  /**
   * Get all devices with optional filters.
   * Handles both response formats from NinjaOne API:
   * 1. Direct array with Link header pagination
   * 2. Object response with cursor property
   */
  async getDevices(params?: NinjaOneDeviceQueryParams): Promise<NinjaOneDevice[]> {
    const devices: NinjaOneDevice[] = [];
    let cursor: string | undefined = params?.after;
    let pageNumber = 0;
    const pageSize = params?.pageSize || 100;

    do {
      pageNumber++;
      const queryParams: Record<string, string | number> = {
        pageSize,
      };

      if (cursor) queryParams.after = cursor;
      if (params?.df) queryParams.df = params.df;
      if (params?.org) queryParams.org = params.org;

      logger.debug('[NinjaOneClient] Fetching devices page', {
        tenantId: this.tenantId,
        page: pageNumber,
        cursor: cursor || '(none)',
        org: params?.org,
        pageSize,
      });

      // NinjaOne API can return either NinjaOneDevice[] or NinjaOneDevicesResponse
      const response = await this.axiosInstance.get<NinjaOneDevice[] | NinjaOneDevicesResponse>('/devices', {
        params: queryParams,
      });

      // Handle both response formats
      let pageDevices: NinjaOneDevice[];
      let bodyCursor: string | undefined;

      if (Array.isArray(response.data)) {
        // Format 1: Direct array response
        pageDevices = response.data;
      } else if (response.data && typeof response.data === 'object' && 'devices' in response.data) {
        // Format 2: Object with devices array and optional cursor
        const wrappedResponse = response.data as NinjaOneDevicesResponse;
        pageDevices = wrappedResponse.devices || [];
        bodyCursor = wrappedResponse.cursor;
      } else {
        // Unexpected format - log and treat as empty
        logger.error('[NinjaOneClient] Unexpected devices response format', {
          tenantId: this.tenantId,
          responseType: typeof response.data,
          isArray: Array.isArray(response.data),
        });
        pageDevices = [];
      }

      devices.push(...pageDevices);

      // Check for pagination cursor in response headers (Link header)
      const linkHeader = response.headers['link'];

      logger.debug('[NinjaOneClient] Devices page response', {
        tenantId: this.tenantId,
        page: pageNumber,
        devicesInPage: pageDevices.length,
        totalDevicesSoFar: devices.length,
        hasLinkHeader: !!linkHeader,
        hasBodyCursor: !!bodyCursor,
        allHeaders: Object.keys(response.headers).join(', '),
      });

      // Try to get cursor from Link header first, then fall back to body cursor
      cursor = this.extractCursorFromLink(linkHeader) || bodyCursor;

      // Safety check: if we got a full page but no cursor, log a warning
      if (pageDevices.length === pageSize && !cursor) {
        logger.warn('[NinjaOneClient] Full page received but no pagination cursor - possible data truncation', {
          tenantId: this.tenantId,
          org: params?.org,
          page: pageNumber,
          devicesInPage: pageDevices.length,
          totalDevices: devices.length,
          linkHeader: linkHeader || '(none)',
        });
      }
    } while (cursor);

    logger.info('[NinjaOneClient] Finished fetching devices', {
      tenantId: this.tenantId,
      org: params?.org,
      totalPages: pageNumber,
      totalDevices: devices.length,
    });

    return devices;
  }

  /**
   * Get devices for a specific organization with pagination support.
   * Uses the organization-specific endpoint which may have better pagination
   * behavior than the global /devices endpoint with org filter.
   */
  async getDevicesByOrganization(
    orgId: number,
    params?: { pageSize?: number }
  ): Promise<NinjaOneDevice[]> {
    const devices: NinjaOneDevice[] = [];
    let cursor: string | undefined;
    let pageNumber = 0;
    const pageSize = params?.pageSize || 100;

    do {
      pageNumber++;
      const queryParams: Record<string, string | number> = { pageSize };
      if (cursor) queryParams.after = cursor;

      logger.debug('[NinjaOneClient] Fetching org devices page', {
        tenantId: this.tenantId,
        orgId,
        page: pageNumber,
        cursor: cursor || '(none)',
        pageSize,
      });

      const response = await this.axiosInstance.get<NinjaOneDevice[]>(
        `/organization/${orgId}/devices`,
        { params: queryParams }
      );

      const pageDevices = response.data || [];
      devices.push(...pageDevices);

      // Check for pagination cursor in response headers (Link header)
      const linkHeader = response.headers['link'];

      logger.debug('[NinjaOneClient] Org devices page response', {
        tenantId: this.tenantId,
        orgId,
        page: pageNumber,
        devicesInPage: pageDevices.length,
        totalDevicesSoFar: devices.length,
        hasLinkHeader: !!linkHeader,
      });

      // Extract cursor from Link header
      cursor = this.extractCursorFromLink(linkHeader);

      // Safety check: if we got a full page but no cursor, log a warning
      if (pageDevices.length === pageSize && !cursor) {
        logger.warn('[NinjaOneClient] Full page received but no pagination cursor - possible data truncation', {
          tenantId: this.tenantId,
          orgId,
          page: pageNumber,
          devicesInPage: pageDevices.length,
          totalDevices: devices.length,
          linkHeader: linkHeader || '(none)',
        });
      }
    } while (cursor);

    logger.info('[NinjaOneClient] Finished fetching devices for organization', {
      tenantId: this.tenantId,
      orgId,
      totalPages: pageNumber,
      totalDevices: devices.length,
    });

    return devices;
  }

  /**
   * Get device by ID with detailed information
   */
  async getDevice(deviceId: number): Promise<NinjaOneDeviceDetail> {
    const response = await this.axiosInstance.get<NinjaOneDeviceDetail>(
      `/device/${deviceId}`
    );
    return response.data;
  }

  /**
   * Get device activities
   */
  async getDeviceActivities(
    deviceId: number,
    params?: NinjaOneActivityQueryParams
  ): Promise<NinjaOneActivity[]> {
    const activities: NinjaOneActivity[] = [];
    let cursor: string | undefined = params?.after;

    do {
      const queryParams: Record<string, string | number | undefined> = {
        ...params,
        pageSize: params?.pageSize || 100,
      };

      if (cursor) queryParams.after = cursor;

      const response = await this.axiosInstance.get<NinjaOneActivity[]>(
        `/device/${deviceId}/activities`,
        { params: queryParams }
      );

      activities.push(...response.data);

      // Check for pagination cursor in response headers
      const linkHeader = response.headers['link'];
      cursor = this.extractCursorFromLink(linkHeader);
    } while (cursor);

    return activities;
  }

  // ============ Alerts API ============

  /**
   * Get all active alerts
   */
  async getAlerts(params?: NinjaOneAlertQueryParams): Promise<NinjaOneAlert[]> {
    const alerts: NinjaOneAlert[] = [];
    let cursor: string | undefined = params?.after;

    do {
      const queryParams: Record<string, string | number | undefined> = {
        pageSize: params?.pageSize || 100,
        sourceType: params?.sourceType,
        deviceFilter: params?.deviceFilter,
        lang: params?.lang,
      };

      if (cursor) queryParams.after = cursor;

      const response = await this.axiosInstance.get<NinjaOneAlert[]>('/alerts', {
        params: queryParams,
      });

      alerts.push(...response.data);

      // Check for pagination cursor in response headers
      const linkHeader = response.headers['link'];
      cursor = this.extractCursorFromLink(linkHeader);
    } while (cursor);

    return alerts;
  }

  /**
   * Get alerts for a specific device
   */
  async getDeviceAlerts(deviceId: number): Promise<NinjaOneAlert[]> {
    const response = await this.axiosInstance.get<NinjaOneAlert[]>(
      `/device/${deviceId}/alerts`
    );
    return response.data;
  }

  /**
   * Reset/acknowledge an alert
   */
  async resetAlert(alertUid: string): Promise<void> {
    await this.axiosInstance.post(`/alert/${alertUid}/reset`);
  }

  // ============ Activities API ============

  /**
   * Get activities with optional filters
   */
  async getActivities(params?: NinjaOneActivityQueryParams): Promise<NinjaOneActivity[]> {
    const activities: NinjaOneActivity[] = [];
    let cursor: string | undefined = params?.after;

    do {
      const queryParams: Record<string, string | number | undefined> = {
        ...params,
        pageSize: params?.pageSize || 100,
      };

      if (cursor) queryParams.after = cursor;

      const response = await this.axiosInstance.get<NinjaOneActivity[]>('/activities', {
        params: queryParams,
      });

      activities.push(...response.data);

      // Check for pagination cursor in response headers
      const linkHeader = response.headers['link'];
      cursor = this.extractCursorFromLink(linkHeader);
    } while (cursor);

    return activities;
  }

  // ============ Patch Management API ============

  /**
   * Get patch status for a device
   */
  async getDevicePatchStatus(deviceId: number): Promise<NinjaOneDevicePatchStatus> {
    const response = await this.axiosInstance.get<NinjaOneDevicePatchStatus>(
      `/device/${deviceId}/os-patches`
    );
    return response.data;
  }

  // ============ Remote Access API ============

  /**
   * Get remote access link for a device (Device Link)
   */
  async getDeviceLink(
    deviceId: number,
    linkType: 'SPLASHTOP' | 'TEAMVIEWER' | 'VNC' | 'RDP' | 'SHELL' = 'SPLASHTOP'
  ): Promise<NinjaOneDeviceLink> {
    const response = await this.axiosInstance.get<NinjaOneDeviceLink>(
      `/device/${deviceId}/link`,
      { params: { type: linkType } }
    );
    return response.data;
  }

  /**
   * Get all available remote access links for a device
   */
  async getDeviceLinks(deviceId: number): Promise<NinjaOneDeviceLink[]> {
    const response = await this.axiosInstance.get<NinjaOneDeviceLink[]>(
      `/device/${deviceId}/links`
    );
    return response.data;
  }

  // ============ Device Control API ============

  /**
   * Reboot a device
   * NinjaOne API: POST /v2/device/{id}/control/reboot
   */
  async rebootDevice(deviceId: number): Promise<void> {
    await this.axiosInstance.post(`/device/${deviceId}/control/reboot`);
    logger.info('[NinjaOneClient] Reboot command sent', {
      tenantId: this.tenantId,
      deviceId,
    });
  }

  /**
   * Run a script on a device
   * NinjaOne API: POST /v2/device/{id}/script/run
   * @param deviceId The device ID
   * @param scriptId The script ID to run
   * @param parameters Optional script parameters
   * @returns Job ID for tracking the script execution
   */
  async runScript(
    deviceId: number,
    scriptId: string,
    parameters?: Record<string, string>
  ): Promise<{ jobId: string }> {
    const response = await this.axiosInstance.post<{ jobUid: string }>(
      `/device/${deviceId}/script/run`,
      {
        id: scriptId,
        parameters,
      }
    );

    logger.info('[NinjaOneClient] Script execution queued', {
      tenantId: this.tenantId,
      deviceId,
      scriptId,
      jobId: response.data.jobUid,
    });

    return { jobId: response.data.jobUid };
  }

  // ============ Software Inventory API ============

  /**
   * Get software inventory for a device
   */
  async getDeviceSoftware(deviceId: number): Promise<unknown[]> {
    const response = await this.axiosInstance.get<unknown[]>(
      `/device/${deviceId}/software`
    );
    return response.data;
  }

  // ============ Webhook API ============

  /**
   * Configure webhook endpoint for receiving activity notifications
   * NinjaOne API: PUT /v2/webhook
   */
  async configureWebhook(config: WebhookConfiguration): Promise<void> {
    await this.axiosInstance.put('/webhook', config);
    logger.info('[NinjaOneClient] Webhook configured successfully', {
      tenantId: this.tenantId,
      url: config.url,
    });
  }

  /**
   * Remove webhook configuration
   * NinjaOne API: DELETE /v2/webhook
   */
  async removeWebhook(): Promise<void> {
    await this.axiosInstance.delete('/webhook');
    logger.info('[NinjaOneClient] Webhook removed successfully', {
      tenantId: this.tenantId,
    });
  }

  // ============ Utility Methods ============

  /**
   * Extract cursor from Link header for pagination
   * NinjaOne uses standard RFC 5988 Link headers with format:
   * <https://api.ninjarmm.com/v2/devices?after=CURSOR&pageSize=100>; rel="next"
   */
  private extractCursorFromLink(linkHeader: string | undefined): string | undefined {
    if (!linkHeader) {
      return undefined;
    }

    // Log the raw header for debugging pagination issues
    logger.debug('[NinjaOneClient] Pagination Link header received', {
      linkHeader,
      tenantId: this.tenantId,
    });

    // Try multiple regex patterns to handle different Link header formats
    // Pattern 1: Standard format with quotes - <url>; rel="next"
    let matches = linkHeader.match(/<[^>]*[?&]after=([^&>]+)[^>]*>;\s*rel="next"/i);

    // Pattern 2: Without quotes - <url>; rel=next
    if (!matches) {
      matches = linkHeader.match(/<[^>]*[?&]after=([^&>]+)[^>]*>;\s*rel=next/i);
    }

    // Pattern 3: Single quotes - <url>; rel='next'
    if (!matches) {
      matches = linkHeader.match(/<[^>]*[?&]after=([^&>]+)[^>]*>;\s*rel='next'/i);
    }

    const cursor = matches?.[1];

    if (cursor) {
      logger.debug('[NinjaOneClient] Extracted pagination cursor', {
        cursor,
        tenantId: this.tenantId,
      });
    } else if (linkHeader) {
      // We had a Link header but couldn't extract cursor - this is suspicious
      logger.warn('[NinjaOneClient] Link header present but could not extract cursor', {
        linkHeader,
        tenantId: this.tenantId,
      });
    }

    return cursor;
  }

  /**
   * Perform a health check / test connection
   */
  async testConnection(): Promise<boolean> {
    try {
      // Try to get organizations as a simple health check
      await this.axiosInstance.get('/organizations', { params: { pageSize: 1 } });
      return true;
    } catch (error) {
      logger.error('[NinjaOneClient] Connection test failed:', extractErrorInfo(error));
      return false;
    }
  }
}

/**
 * Factory function to create a NinjaOne client for a tenant
 * Reads stored credentials to get the correct instance URL
 */
export async function createNinjaOneClient(
  tenantId: string,
  region?: NinjaOneRegion
): Promise<NinjaOneClient> {
  // Try to load stored credentials to get the correct instance URL
  let instanceUrl: string | undefined;

  try {
    const secretProvider = await getSecretProviderInstance();
    const credentialsJson = await secretProvider.getTenantSecret(
      tenantId,
      NINJAONE_CREDENTIALS_SECRET
    );

    if (credentialsJson) {
      const credentials = JSON.parse(credentialsJson) as NinjaOneOAuthCredentials;
      instanceUrl = credentials.instance_url;
    }
  } catch (error) {
    // If we can't load credentials, fall back to region-based URL
    logger.warn('[NinjaOneClient] Could not load stored credentials for instance URL', extractErrorInfo(error));
  }

  return new NinjaOneClient({ tenantId, region, instanceUrl });
}

/**
 * Get OAuth authorization URL for NinjaOne
 */
export async function getNinjaOneAuthUrl(
  tenantId: string,
  region: NinjaOneRegion = 'US',
  redirectUri: string
): Promise<string> {
  const { clientId } = await resolveNinjaOneClientCredentials(tenantId);

  if (!clientId) {
    throw new Error('NinjaOne client ID not configured. Please set NINJAONE_CLIENT_ID environment variable or configure the secret.');
  }

  const instanceUrl = NINJAONE_REGIONS[region];
  const state = Buffer.from(JSON.stringify({ tenantId, region })).toString('base64url');

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    state,
    scope: 'monitoring management control offline_access',
  });

  return `${instanceUrl}/oauth/authorize?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeNinjaOneCode(
  code: string,
  tenantId: string,
  region: NinjaOneRegion,
  redirectUri: string
): Promise<NinjaOneOAuthCredentials> {
  const { clientId, clientSecret } = await resolveNinjaOneClientCredentials(tenantId);

  if (!clientId || !clientSecret) {
    throw new Error('NinjaOne client credentials not configured. Please set NINJAONE_CLIENT_ID and NINJAONE_CLIENT_SECRET environment variables or configure the secrets.');
  }

  const instanceUrl = NINJAONE_REGIONS[region];
  const tokenUrl = `${instanceUrl}/oauth/token`;

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await axios.post<NinjaOneOAuthTokenResponse>(
    tokenUrl,
    params.toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: DEFAULT_TIMEOUT,
    }
  );

  const { access_token, refresh_token, expires_in } = response.data;

  const credentials: NinjaOneOAuthCredentials = {
    access_token,
    refresh_token,
    expires_at: Date.now() + expires_in * 1000,
    instance_url: instanceUrl,
  };

  // Save credentials to secret storage
  const secretProvider = await getSecretProviderInstance();
  await secretProvider.setTenantSecret(
    tenantId,
    NINJAONE_CREDENTIALS_SECRET,
    JSON.stringify(credentials)
  );

  logger.info('[NinjaOneClient] Successfully stored credentials', { tenantId, region });

  return credentials;
}

/**
 * Disconnect NinjaOne integration (remove stored credentials)
 */
export async function disconnectNinjaOne(tenantId: string): Promise<void> {
  const secretProvider = await getSecretProviderInstance();
  await secretProvider.deleteTenantSecret(tenantId, NINJAONE_CREDENTIALS_SECRET);
  logger.info('[NinjaOneClient] Disconnected NinjaOne integration', { tenantId });
}
