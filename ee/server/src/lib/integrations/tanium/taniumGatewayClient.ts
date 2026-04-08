import axios, { AxiosInstance } from 'axios';
import logger from '@alga-psa/core/logger';

export interface TaniumGatewayClientOptions {
  gatewayUrl: string;
  apiToken: string;
  assetApiUrl?: string;
}

export interface TaniumComputerGroup {
  id: string;
  name: string;
}

export interface TaniumEndpointRecord {
  id: string;
  name: string;
  computerGroupId?: string | null;
  serialNumber?: string | null;
  lastSeen?: string | null;
  online?: boolean | null;
  osName?: string | null;
  osVersion?: string | null;
  currentUser?: string | null;
  ipAddress?: string | null;
  metadata?: Record<string, unknown>;
}

function ensureHttpUrl(url: string): string {
  const trimmed = String(url || '').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/+$/, '');
  return `https://${trimmed.replace(/\/+$/, '')}`;
}

export class TaniumGatewayClient {
  private readonly gateway: AxiosInstance;
  private readonly assetApi: AxiosInstance | null;

  constructor(options: TaniumGatewayClientOptions) {
    const gatewayUrl = ensureHttpUrl(options.gatewayUrl);
    if (!gatewayUrl) {
      throw new Error('Tanium Gateway URL is required.');
    }

    this.gateway = axios.create({
      baseURL: gatewayUrl,
      timeout: 45_000,
      headers: {
        Authorization: `Bearer ${options.apiToken}`,
        'Content-Type': 'application/json',
      },
    });

    const normalizedAssetApiUrl = ensureHttpUrl(options.assetApiUrl || '');
    this.assetApi = normalizedAssetApiUrl
      ? axios.create({
          baseURL: normalizedAssetApiUrl,
          timeout: 45_000,
          headers: {
            Authorization: `Bearer ${options.apiToken}`,
            'Content-Type': 'application/json',
          },
        })
      : null;
  }

  private async query<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const response = await this.gateway.post('/graphql', { query, variables });
    if (response.data?.errors?.length) {
      const message = String(response.data.errors[0]?.message || 'Tanium Gateway query failed');
      throw new Error(message);
    }
    return response.data?.data as T;
  }

  async testConnection(): Promise<void> {
    await this.query<{ __typename: string }>('query TaniumPing { __typename }');
  }

  async listComputerGroups(): Promise<TaniumComputerGroup[]> {
    const query = `
      query TaniumComputerGroups($first: Int!, $after: String) {
        computerGroups(first: $first, after: $after) {
          edges {
            cursor
            node {
              id
              name
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

    let hasNextPage = true;
    let after: string | null = null;
    const groups: TaniumComputerGroup[] = [];

    while (hasNextPage) {
      const data = await this.query<{
        computerGroups?: {
          edges?: Array<{ node?: { id?: string; name?: string } | null }>;
          pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
        };
      }>(query, { first: 250, after });

      const edges = data?.computerGroups?.edges || [];
      for (const edge of edges) {
        const node = edge?.node;
        if (!node?.id) continue;
        groups.push({
          id: String(node.id),
          name: String(node.name || node.id),
        });
      }

      hasNextPage = Boolean(data?.computerGroups?.pageInfo?.hasNextPage);
      after = data?.computerGroups?.pageInfo?.endCursor || null;
      if (!after) {
        hasNextPage = false;
      }
    }

    return groups;
  }

  async listEndpoints(input?: { computerGroupId?: string | null }): Promise<TaniumEndpointRecord[]> {
    const query = `
      query TaniumEndpoints($first: Int!, $after: String) {
        endpoints(first: $first, after: $after) {
          edges {
            cursor
            node {
              id
              name
              serialNumber
              lastSeen
              online
              ipAddress
              os {
                name
                version
              }
              users {
                name
              }
              computerGroup {
                id
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

    let hasNextPage = true;
    let after: string | null = null;
    const endpoints: TaniumEndpointRecord[] = [];

    while (hasNextPage) {
      const data = await this.query<{
        endpoints?: {
          edges?: Array<{
            node?: {
              id?: string;
              name?: string;
              serialNumber?: string | null;
              lastSeen?: string | null;
              online?: boolean | null;
              ipAddress?: string | null;
              os?: { name?: string | null; version?: string | null } | null;
              users?: Array<{ name?: string | null }> | null;
              computerGroup?: { id?: string | null } | null;
            } | null;
          }>;
          pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
        };
      }>(query, { first: 250, after });

      const edges = data?.endpoints?.edges || [];
      for (const edge of edges) {
        const node = edge?.node;
        if (!node?.id) continue;
        const computerGroupId = node.computerGroup?.id ? String(node.computerGroup.id) : null;
        if (input?.computerGroupId && computerGroupId !== input.computerGroupId) {
          continue;
        }

        endpoints.push({
          id: String(node.id),
          name: String(node.name || node.id),
          computerGroupId,
          serialNumber: node.serialNumber ?? null,
          lastSeen: node.lastSeen ?? null,
          online: typeof node.online === 'boolean' ? node.online : null,
          osName: node.os?.name ?? null,
          osVersion: node.os?.version ?? null,
          currentUser: node.users?.[0]?.name ?? null,
          ipAddress: node.ipAddress ?? null,
          metadata: node as unknown as Record<string, unknown>,
        });
      }

      hasNextPage = Boolean(data?.endpoints?.pageInfo?.hasNextPage);
      after = data?.endpoints?.pageInfo?.endCursor || null;
      if (!after) {
        hasNextPage = false;
      }
    }

    return endpoints;
  }

  async listAgedOutAssetFallback(input?: { computerGroupId?: string | null }): Promise<TaniumEndpointRecord[]> {
    if (!this.assetApi) return [];

    try {
      const response = await this.assetApi.get('/v2/assets', {
        params: input?.computerGroupId ? { computerGroupId: input.computerGroupId } : undefined,
      });
      const rows = Array.isArray(response.data?.data) ? response.data.data : [];

      return rows
        .map((row: any) => {
          const id = String(row?.id || row?.assetId || '');
          if (!id) return null;
          return {
            id,
            name: String(row?.name || row?.hostname || id),
            computerGroupId: row?.computerGroupId ? String(row.computerGroupId) : input?.computerGroupId ?? null,
            serialNumber: row?.serialNumber ?? null,
            lastSeen: row?.lastSeen ?? null,
            online: typeof row?.online === 'boolean' ? row.online : null,
            osName: row?.osName ?? null,
            osVersion: row?.osVersion ?? null,
            currentUser: row?.currentUser ?? null,
            ipAddress: row?.ipAddress ?? null,
            metadata: row,
          } satisfies TaniumEndpointRecord;
        })
        .filter((row): row is TaniumEndpointRecord => row !== null);
    } catch (error) {
      logger.warn('Tanium Asset API fallback request failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}

export function normalizeTaniumGatewayUrl(url: string): string {
  return ensureHttpUrl(url);
}
