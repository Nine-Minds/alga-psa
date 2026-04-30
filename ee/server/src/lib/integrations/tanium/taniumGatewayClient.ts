import axios, { AxiosInstance } from 'axios';
import logger from '@alga-psa/core/logger';
import type { RmmStorageInfo } from '@alga-psa/types';

const TANIUM_GATEWAY_ERROR_HINT = 'Check the Tanium API token, keep the token- prefix, verify the allowed IP/CIDR, and confirm Gateway access/permissions.';
const TANIUM_RBAC_ERROR_HINT = 'The Tanium API token may be authenticated but missing required Tanium permissions or content-set access.';

export interface TaniumGatewayClientOptions {
  gatewayUrl: string;
  apiToken: string;
  assetApiUrl?: string;
}

export interface TaniumComputerGroup {
  id: string;
  name: string;
}

export interface TaniumInstalledApplication {
  name: string;
  version?: string | null;
  uninstallable?: boolean | null;
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
  wanIpAddress?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  cpuModel?: string | null;
  cpuLogicalProcessors?: number | null;
  memoryTotalGb?: number | null;
  lastRebootAt?: string | null;
  diskUsage?: RmmStorageInfo[];
  installedApplications?: TaniumInstalledApplication[];
  metadata?: Record<string, unknown>;
}

export interface TaniumSensorColumn {
  name: string;
  values: Array<string | null>;
}

export interface TaniumEndpointCriticalityReading {
  endpointId: string;
  label: string | null;
  multiplier: number | null;
  columns: TaniumSensorColumn[];
  sourceUpdatedAt: string | null;
  isAvailable: boolean;
}

function ensureHttpUrl(url: string): string {
  const trimmed = String(url || '').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/+$/, '');
  return `https://${trimmed.replace(/\/+$/, '')}`;
}

function ensureTaniumApiToken(token: string): string {
  const trimmed = String(token || '').trim();
  if (!trimmed) {
    throw new Error('Tanium API token is required.');
  }

  if (!/^token-/i.test(trimmed)) {
    throw new Error('Tanium API token must include the token- prefix.');
  }

  return trimmed;
}

function normalizeCurrentUser(primaryUserName?: string | null, lastLoggedInUser?: string | null): string | null {
  const trimmedPrimaryUser = primaryUserName?.trim();
  if (trimmedPrimaryUser && !trimmedPrimaryUser.toLowerCase().startsWith('error:')) {
    return trimmedPrimaryUser;
  }

  const trimmedLastLoggedInUser = lastLoggedInUser?.trim();
  return trimmedLastLoggedInUser || null;
}

function parseSizeToGb(value?: string | null): number | null {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^([0-9]+(?:\.[0-9]+)?)\s*([KMGT]?)(?:B)?$/i);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = String(match[2] || 'G').toUpperCase();

  if (!Number.isFinite(amount)) return null;

  if (unit === 'T') return Number((amount * 1024).toFixed(2));
  if (unit === 'G') return Number(amount.toFixed(2));
  if (unit === 'M') return Number((amount / 1024).toFixed(2));
  if (unit === 'K') return Number((amount / (1024 * 1024)).toFixed(4));
  return Number((amount / (1024 * 1024 * 1024)).toFixed(6));
}

function parsePercentValue(value?: string | null): number | null {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^([0-9]+(?:\.[0-9]+)?)\s*%$/);
  if (!match) return null;

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTaniumDisks(disks?: Array<{
  name?: string | null;
  total?: string | null;
  free?: string | null;
  usedPercentage?: string | null;
}> | null): RmmStorageInfo[] {
  if (!Array.isArray(disks)) return [];

  return disks
    .map((disk) => {
      const name = String(disk?.name || '').trim();
      const totalGb = parseSizeToGb(disk?.total);
      const freeGb = parseSizeToGb(disk?.free);
      const utilizationPercent = parsePercentValue(disk?.usedPercentage);

      if (!name || totalGb === null || freeGb === null || utilizationPercent === null) {
        return null;
      }

      return {
        name,
        total_gb: totalGb,
        free_gb: freeGb,
        utilization_percent: utilizationPercent,
      } satisfies RmmStorageInfo;
    })
    .filter((disk): disk is RmmStorageInfo => disk !== null);
}

function computeUptimeSeconds(lastRebootAt?: string | null, now = Date.now()): number | null {
  if (!lastRebootAt) return null;
  const rebootMs = new Date(lastRebootAt).getTime();
  if (!Number.isFinite(rebootMs)) return null;

  const diffSeconds = Math.floor((now - rebootMs) / 1000);
  return diffSeconds >= 0 ? diffSeconds : null;
}

export class TaniumGatewayClient {
  private readonly gateway: AxiosInstance;
  private readonly assetApi: AxiosInstance | null;

  constructor(options: TaniumGatewayClientOptions) {
    const gatewayUrl = ensureHttpUrl(options.gatewayUrl);
    if (!gatewayUrl) {
      throw new Error('Tanium Gateway URL is required.');
    }

    const apiToken = ensureTaniumApiToken(options.apiToken);

    this.gateway = axios.create({
      baseURL: gatewayUrl,
      timeout: 45_000,
      maxRedirects: 0,
      headers: {
        session: apiToken,
        'Content-Type': 'application/json',
      },
    });

    const normalizedAssetApiUrl = ensureHttpUrl(options.assetApiUrl || '');
    this.assetApi = normalizedAssetApiUrl
      ? axios.create({
          baseURL: normalizedAssetApiUrl,
          timeout: 45_000,
          headers: {
            session: apiToken,
            'Content-Type': 'application/json',
          },
        })
      : null;
  }

  private formatGatewayError(error: unknown): Error {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const location = String(error.response?.headers?.location || '');
      const contentType = String(error.response?.headers?.['content-type'] || '');
      const responseBody = typeof error.response?.data === 'string' ? error.response.data : '';

      if (status === 302 || /openid-connect|\/login|\/auth/i.test(location)) {
        return new Error(`Tanium Gateway redirected to authentication. ${TANIUM_GATEWAY_ERROR_HINT}`);
      }

      if (status === 403) {
        return new Error(`Tanium Gateway rejected the configured API token. ${TANIUM_GATEWAY_ERROR_HINT}`);
      }

      if (status === 401) {
        return new Error(`Tanium Gateway returned 401 Unauthorized. ${TANIUM_RBAC_ERROR_HINT}`);
      }

      if (contentType.toLowerCase().includes('text/html') || /<!doctype html|<html/i.test(responseBody)) {
        return new Error(`Tanium Gateway returned an HTML login page instead of GraphQL JSON. ${TANIUM_GATEWAY_ERROR_HINT}`);
      }

      if (status) {
        return new Error(`Tanium Gateway request failed with status ${status}. ${TANIUM_GATEWAY_ERROR_HINT}`);
      }
    }

    if (error instanceof Error) {
      return error;
    }

    return new Error(`Tanium Gateway request failed. ${TANIUM_GATEWAY_ERROR_HINT}`);
  }

  private async query<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    try {
      const response = await this.gateway.post('/graphql', { query, variables });
      const payload = response.data;
      const contentType = String(response.headers?.['content-type'] || 'unknown');

      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error(
          `Tanium Gateway returned a non-GraphQL response (${contentType}). ${TANIUM_GATEWAY_ERROR_HINT}`
        );
      }

      if (Array.isArray((payload as any).errors) && (payload as any).errors.length > 0) {
        const message = String((payload as any).errors[0]?.message || 'Tanium Gateway query failed');
        throw new Error(message);
      }

      if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
        throw new Error(`Tanium Gateway returned an invalid GraphQL payload. ${TANIUM_GATEWAY_ERROR_HINT}`);
      }

      if ((payload as any).data == null) {
        throw new Error(`Tanium Gateway returned an empty GraphQL payload. ${TANIUM_GATEWAY_ERROR_HINT}`);
      }

      return (payload as any).data as T;
    } catch (error) {
      throw this.formatGatewayError(error);
    }
  }

  async testConnection(): Promise<void> {
    const data = await this.query<{
      computerGroups?: {
        edges?: Array<{ node?: { id?: string; name?: string } | null }>;
      };
    }>(
      `
        query TaniumConnectionProbe($first: Int!, $after: Cursor) {
          computerGroups(first: $first, after: $after) {
            edges {
              node {
                id
                name
              }
            }
          }
        }
      `,
      { first: 1, after: null }
    );

    if (!data?.computerGroups || !Array.isArray(data.computerGroups.edges)) {
      throw new Error(`Tanium Gateway connection probe failed to return computer groups. ${TANIUM_GATEWAY_ERROR_HINT}`);
    }
  }

  async listComputerGroups(): Promise<TaniumComputerGroup[]> {
    const query = `
      query TaniumComputerGroups($first: Int!, $after: Cursor) {
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

  private async listEndpointLastRebootTimes(input?: { computerGroupId?: string | null }): Promise<Map<string, string | null>> {
    const query = `
      query TaniumEndpointLastReboot($first: Int!, $after: Cursor, $filter: EndpointFieldFilter) {
        endpoints(first: $first, after: $after, filter: $filter) {
          edges {
            cursor
            node {
              id
              lastReboot: sensorReading(sensor: { name: "Last Reboot" }) {
                values
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

    const filter = input?.computerGroupId
      ? {
          memberOf: { id: String(input.computerGroupId) },
          op: 'EQ',
          negated: false,
          any: false,
        }
      : null;

    let hasNextPage = true;
    let after: string | null = null;
    const lastRebootByEndpointId = new Map<string, string | null>();

    while (hasNextPage) {
      const data = await this.query<{
        endpoints?: {
          edges?: Array<{
            node?: {
              id?: string;
              lastReboot?: { values?: Array<string | null> } | null;
            } | null;
          }>;
          pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
        };
      }>(query, { first: 250, after, filter });

      const edges = data?.endpoints?.edges || [];
      for (const edge of edges) {
        const node = edge?.node;
        if (!node?.id) continue;

        const lastRebootAt = String(node.lastReboot?.values?.[0] || '').trim() || null;
        lastRebootByEndpointId.set(String(node.id), lastRebootAt);
      }

      hasNextPage = Boolean(data?.endpoints?.pageInfo?.hasNextPage);
      after = data?.endpoints?.pageInfo?.endCursor || null;
      if (!after) {
        hasNextPage = false;
      }
    }

    return lastRebootByEndpointId;
  }

  async listEndpoints(input?: { computerGroupId?: string | null }): Promise<TaniumEndpointRecord[]> {
    const query = `
      query TaniumEndpoints($first: Int!, $after: Cursor, $filter: EndpointFieldFilter) {
        endpoints(first: $first, after: $after, filter: $filter) {
          edges {
            cursor
            node {
              id
              name
              serialNumber
              manufacturer
              model
              chassisType
              domainName
              eidLastSeen
              ipAddress
              ipAddresses
              macAddresses
              primaryUser {
                name
              }
              lastLoggedInUser
              reportingConsoleURL
              isVirtual
              isEncrypted
              os {
                name
                generation
                platform
              }
              memory {
                total
              }
              processor {
                cpu
                logicalProcessors
              }
              disks {
                name
                free
                total
                usedPercentage
              }
              discover {
                natIpAddress
              }
              networking {
                dnsServers
                adapters {
                  name
                  manufacturer
                  type
                  macAddress
                  speed
                  connectionId
                }
                wirelessAdapters {
                  ssid
                  state
                }
              }
              installedApplications {
                name
                version
                uninstallable
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
    const filter = input?.computerGroupId
      ? {
          memberOf: { id: String(input.computerGroupId) },
          op: 'EQ',
          negated: false,
          any: false,
        }
      : null;

    while (hasNextPage) {
      const data = await this.query<{
        endpoints?: {
          edges?: Array<{
            node?: {
              id?: string;
              name?: string;
              serialNumber?: string | null;
              manufacturer?: string | null;
              model?: string | null;
              chassisType?: string | null;
              domainName?: string | null;
              eidLastSeen?: string | null;
              ipAddress?: string | null;
              ipAddresses?: Array<string | null> | null;
              macAddresses?: Array<string | null> | null;
              primaryUser?: { name?: string | null } | null;
              lastLoggedInUser?: string | null;
              reportingConsoleURL?: string | null;
              isVirtual?: boolean | null;
              isEncrypted?: boolean | null;
              os?: { name?: string | null; generation?: string | null; platform?: string | null } | null;
              memory?: { total?: string | null } | null;
              processor?: { cpu?: string | null; logicalProcessors?: number | null } | null;
              disks?: Array<{
                name?: string | null;
                free?: string | null;
                total?: string | null;
                usedPercentage?: string | null;
              } | null> | null;
              discover?: { natIpAddress?: string | null } | null;
              networking?: {
                dnsServers?: Array<string | null> | null;
                adapters?: Array<Record<string, unknown> | null> | null;
                wirelessAdapters?: Array<Record<string, unknown> | null> | null;
              } | null;
              installedApplications?: Array<{
                name?: string | null;
                version?: string | null;
                uninstallable?: boolean | null;
              } | null> | null;
            } | null;
          }>;
          pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
        };
      }>(query, { first: 250, after, filter });

      const edges = data?.endpoints?.edges || [];
      for (const edge of edges) {
        const node = edge?.node;
        if (!node?.id) continue;

        const installedApplications = Array.isArray(node.installedApplications)
          ? node.installedApplications.reduce<TaniumInstalledApplication[]>((acc, application) => {
              const name = String(application?.name || '').trim();
              if (!name) return acc;

              acc.push({
                name,
                version: application?.version ?? null,
                uninstallable: typeof application?.uninstallable === 'boolean' ? application.uninstallable : null,
              });

              return acc;
            }, [])
          : [];

        const metadata: Record<string, unknown> = {
          manufacturer: node.manufacturer ?? null,
          model: node.model ?? null,
          chassisType: node.chassisType ?? null,
          domainName: node.domainName ?? null,
          reportingConsoleURL: node.reportingConsoleURL ?? null,
          isVirtual: node.isVirtual ?? null,
          isEncrypted: node.isEncrypted ?? null,
          ipAddresses: Array.isArray(node.ipAddresses)
            ? node.ipAddresses.map((value) => String(value || '').trim()).filter(Boolean)
            : [],
          macAddresses: Array.isArray(node.macAddresses)
            ? node.macAddresses.map((value) => String(value || '').trim()).filter(Boolean)
            : [],
          dnsServers: Array.isArray(node.networking?.dnsServers)
            ? node.networking?.dnsServers.map((value) => String(value || '').trim()).filter(Boolean)
            : [],
          networkAdapters: Array.isArray(node.networking?.adapters)
            ? node.networking?.adapters.filter((adapter): adapter is Record<string, unknown> => Boolean(adapter))
            : [],
          wirelessAdapters: Array.isArray(node.networking?.wirelessAdapters)
            ? node.networking?.wirelessAdapters.filter((adapter): adapter is Record<string, unknown> => Boolean(adapter))
            : [],
        };

        endpoints.push({
          id: String(node.id),
          name: String(node.name || node.id),
          computerGroupId: input?.computerGroupId ? String(input.computerGroupId) : null,
          serialNumber: node.serialNumber ?? null,
          lastSeen: node.eidLastSeen ?? null,
          online: null,
          osName: node.os?.name ?? null,
          osVersion: node.os?.generation ?? node.os?.platform ?? null,
          currentUser: normalizeCurrentUser(node.primaryUser?.name, node.lastLoggedInUser),
          ipAddress: node.ipAddress ?? null,
          wanIpAddress: node.discover?.natIpAddress ?? null,
          manufacturer: node.manufacturer ?? null,
          model: node.model ?? null,
          cpuModel: node.processor?.cpu ?? null,
          cpuLogicalProcessors: node.processor?.logicalProcessors ?? null,
          memoryTotalGb: parseSizeToGb(node.memory?.total),
          diskUsage: parseTaniumDisks(node.disks?.filter((disk): disk is NonNullable<typeof disk> => Boolean(disk)) || []),
          installedApplications,
          metadata,
        });
      }

      hasNextPage = Boolean(data?.endpoints?.pageInfo?.hasNextPage);
      after = data?.endpoints?.pageInfo?.endCursor || null;
      if (!after) {
        hasNextPage = false;
      }
    }

    try {
      const lastRebootByEndpointId = await this.listEndpointLastRebootTimes(input);
      for (const endpoint of endpoints) {
        endpoint.lastRebootAt = lastRebootByEndpointId.get(endpoint.id) ?? null;
        const uptimeSeconds = computeUptimeSeconds(endpoint.lastRebootAt);
        if (uptimeSeconds !== null) {
          endpoint.metadata = {
            ...(endpoint.metadata ?? {}),
            uptimeSeconds,
          };
        }
      }
    } catch (error) {
      logger.warn('Tanium Last Reboot sensor query failed; continuing without uptime enrichment', {
        error: error instanceof Error ? error.message : String(error),
        computerGroupId: input?.computerGroupId ?? null,
      });
    }

    return endpoints;
  }

  async getCriticalitySensorMetadata(): Promise<Array<{
    name: string;
    description: string | null;
    valueType: string | null;
    virtual: boolean | null;
    harvested: boolean | null;
    contentSetName: string | null;
    columns: Array<{ name: string; valueType: string | null; hidden: boolean | null }>;
  }>> {
    const data = await this.query<{
      sensors?: {
        edges?: Array<{
          node?: {
            name?: string;
            description?: string | null;
            valueType?: string | null;
            virtual?: boolean | null;
            harvested?: boolean | null;
            contentSetName?: string | null;
            columns?: Array<{ name?: string; valueType?: string | null; hidden?: boolean | null } | null> | null;
          } | null;
        }>;
      };
    }>(
      `
        query TaniumCriticalitySensorMetadata {
          sensors(
            first: 10
            filter: { path: "name", op: EQ, value: "Endpoint Criticality with Level" }
          ) {
            edges {
              node {
                name
                description
                valueType
                virtual
                harvested
                contentSetName
                columns {
                  name
                  valueType
                  hidden
                }
              }
            }
          }
        }
      `
    );

    return (data?.sensors?.edges || [])
      .map((edge) => edge?.node)
      .filter((node): node is NonNullable<typeof node> => Boolean(node?.name))
      .map((node) => ({
        name: String(node.name),
        description: node.description ?? null,
        valueType: node.valueType ?? null,
        virtual: typeof node.virtual === 'boolean' ? node.virtual : null,
        harvested: typeof node.harvested === 'boolean' ? node.harvested : null,
        contentSetName: node.contentSetName ?? null,
        columns: (node.columns || [])
          .filter((column): column is NonNullable<typeof column> => Boolean(column?.name))
          .map((column) => ({
            name: String(column.name),
            valueType: column.valueType ?? null,
            hidden: typeof column.hidden === 'boolean' ? column.hidden : null,
          })),
      }));
  }

  async listEndpointCriticalityReadings(input?: { computerGroupId?: string | null }): Promise<Map<string, TaniumEndpointCriticalityReading>> {
    const query = `
      query TaniumEndpointCriticality($first: Int!, $after: Cursor, $filter: EndpointFieldFilter) {
        endpoints(first: $first, after: $after, filter: $filter) {
          edges {
            node {
              id
              criticality: sensorReadings(sensors: [{ name: "Endpoint Criticality with Level" }]) {
                columns {
                  name
                  values
                }
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
    const filter = input?.computerGroupId
      ? { memberOf: { id: String(input.computerGroupId) }, op: 'EQ', negated: false, any: false }
      : null;

    const byEndpointId = new Map<string, TaniumEndpointCriticalityReading>();
    let hasNextPage = true;
    let after: string | null = null;

    while (hasNextPage) {
      const data = await this.query<{
        endpoints?: {
          edges?: Array<{
            node?: {
              id?: string;
              criticality?: {
                columns?: Array<{ name?: string | null; values?: Array<string | null> | null } | null> | null;
              } | null;
            } | null;
          }>;
          pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
        };
      }>(query, { first: 250, after, filter });

      for (const edge of data?.endpoints?.edges || []) {
        const node = edge?.node;
        if (!node?.id) continue;
        const endpointId = String(node.id);
        const columns = (node.criticality?.columns || [])
          .filter((column): column is NonNullable<typeof column> => Boolean(column?.name))
          .map((column) => ({
            name: String(column.name),
            values: Array.isArray(column.values) ? column.values.map((value) => value ?? null) : [],
          }));

        byEndpointId.set(endpointId, parseCriticalityFromColumns(endpointId, columns));
      }

      hasNextPage = Boolean(data?.endpoints?.pageInfo?.hasNextPage);
      after = data?.endpoints?.pageInfo?.endCursor || null;
      if (!after) hasNextPage = false;
    }

    return byEndpointId;
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

function parseCriticalityFromColumns(endpointId: string, columns: TaniumSensorColumn[]): TaniumEndpointCriticalityReading {
  const normalized = columns.reduce<Record<string, Array<string | null>>>((acc, column) => {
    acc[column.name.trim().toLowerCase()] = column.values;
    return acc;
  }, {});

  const textCandidates = [
    normalized.criticality_level?.[0],
    normalized.level?.[0],
    normalized.criticality_text?.[0],
    normalized.criticality?.[0],
  ];
  const labelRaw = textCandidates.find((value) => String(value || '').trim().length > 0) || null;
  const label = labelRaw ? String(labelRaw).trim() : null;

  const numericCandidates = [
    normalized.criticality_value?.[0],
    normalized.multiplier?.[0],
    normalized.criticality_multiplier?.[0],
  ];
  const numericRaw = numericCandidates.find((value) => String(value || '').trim().length > 0) || null;
  const numericParsed = numericRaw === null ? NaN : Number(numericRaw);
  const multiplier = Number.isFinite(numericParsed) ? numericParsed : labelToMultiplier(label);

  return {
    endpointId,
    label,
    multiplier,
    columns,
    sourceUpdatedAt: null,
    isAvailable: Boolean(label || Number.isFinite(multiplier as number)),
  };
}

function labelToMultiplier(label: string | null): number | null {
  if (!label) return null;
  switch (label.toLowerCase()) {
    case 'low':
      return 1;
    case 'medium':
      return 1.33;
    case 'high':
      return 1.67;
    case 'critical':
      return 2;
    default:
      return null;
  }
}
