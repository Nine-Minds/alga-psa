/**
 * NinjaOne API Interfaces
 *
 * Type definitions for NinjaOne Public API v2 responses and requests.
 * Based on NinjaOne API documentation at https://app.ninjarmm.com/apidocs-beta/
 */

// OAuth Types
export interface NinjaOneOAuthTokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export interface NinjaOneOAuthCredentials {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix timestamp
  instance_url: string;
}

// Organization/Client
export interface NinjaOneOrganization {
  id: number;
  name: string;
  description?: string;
  nodeApprovalMode?: 'AUTOMATIC' | 'MANUAL' | 'REJECT';
  tags?: string[];
  fields?: Record<string, unknown>;
  userData?: Record<string, unknown>;
  locations?: NinjaOneLocation[];
}

export interface NinjaOneLocation {
  id: number;
  name: string;
  address?: string;
  description?: string;
  userData?: Record<string, unknown>;
}

// Device/Node
export interface NinjaOneDevice {
  id: number;
  organizationId: number;
  locationId?: number;
  nodeClass: NinjaOneNodeClass;
  nodeRoleId?: number;
  rolePolicyId?: number;
  policyId?: number;
  approvalStatus?: 'PENDING' | 'APPROVED';
  offline: boolean;
  displayName?: string;
  systemName?: string;
  dnsName?: string;
  netbiosName?: string;
  created: string; // ISO timestamp
  lastContact?: string; // ISO timestamp
  lastUpdate?: string; // ISO timestamp
  userData?: Record<string, unknown>;
  tags?: string[];
  fields?: Record<string, unknown>;
  // System info
  system?: NinjaOneSystemInfo;
  os?: NinjaOneOSInfo;
  // References
  references?: {
    organization?: NinjaOneOrganization;
    location?: NinjaOneLocation;
    rolePolicy?: unknown;
    policy?: unknown;
  };
}

export type NinjaOneNodeClass =
  | 'WINDOWS_WORKSTATION'
  | 'WINDOWS_SERVER'
  | 'MAC'
  | 'LINUX_WORKSTATION'
  | 'LINUX_SERVER'
  | 'VMWARE_VM_HOST'
  | 'VMWARE_VM_GUEST'
  | 'HYPERV_VMM_HOST'
  | 'HYPERV_VMM_GUEST'
  | 'CLOUD_MONITOR_TARGET'
  | 'NMS';

export interface NinjaOneSystemInfo {
  name?: string;
  manufacturer?: string;
  model?: string;
  biosSerialNumber?: string;
  serialNumber?: string;
  domain?: string;
  chassisType?: string;
  memory?: {
    capacity: number;
  };
}

export interface NinjaOneOSInfo {
  name?: string;
  manufacturer?: string;
  architecture?: string;
  version?: string;
  buildNumber?: string;
  releaseId?: string;
  servicePack?: string;
  productType?: string;
  lastBootTime?: string;
  locale?: string;
  language?: string;
  timezone?: {
    name?: string;
    offset?: number;
  };
  installDate?: string;
  needsReboot?: boolean;
}

// Detailed Device Info (from GET /device/{id})
export interface NinjaOneDeviceDetail extends NinjaOneDevice {
  // Network
  publicIP?: string;
  // Processor info
  processors?: NinjaOneProcessor[];
  // Volumes/Disks
  volumes?: NinjaOneVolume[];
  // Network interfaces
  networkInterfaces?: NinjaOneNetworkInterface[];
  // Software
  software?: NinjaOneSoftware[];
  // Last logged on user
  lastLoggedInUser?: string;
  // Antivirus
  antivirus?: NinjaOneAntivirus[];
}

export interface NinjaOneProcessor {
  name?: string;
  architecture?: string;
  clockSpeed?: number;
  cores?: number;
  logicalCores?: number;
}

export interface NinjaOneVolume {
  name?: string;
  label?: string;
  deviceType?: string;
  fileSystem?: string;
  autoMount?: boolean;
  compressed?: boolean;
  capacity?: number;
  freeSpace?: number;
  serialNumber?: string;
}

export interface NinjaOneNetworkInterface {
  name?: string;
  speed?: number;
  macAddress?: string;
  ipAddresses?: string[];
  gateway?: string;
  dns?: string[];
  dhcp?: boolean;
  type?: string;
}

export interface NinjaOneSoftware {
  name?: string;
  version?: string;
  publisher?: string;
  installDate?: string;
  location?: string;
  size?: number;
}

export interface NinjaOneAntivirus {
  name?: string;
  state?: string;
  productState?: string;
  definitionStatus?: string;
  definitionsUpdated?: string;
}

// Alerts
export interface NinjaOneAlert {
  uid: string;
  deviceId: number;
  severity: NinjaOneAlertSeverity;
  priority: NinjaOneAlertPriority;
  message: string;
  createTime: string; // ISO timestamp
  updateTime?: string;
  sourceType: NinjaOneAlertSourceType;
  sourceConfigUid?: string;
  sourceName?: string;
  activityTime?: string;
  data?: Record<string, unknown>;
  device?: {
    id: number;
    systemName?: string;
    displayName?: string;
    organizationId?: number;
    nodeClass?: NinjaOneNodeClass;
  };
}

export type NinjaOneAlertSeverity = 'CRITICAL' | 'MAJOR' | 'MODERATE' | 'MINOR' | 'NONE';
export type NinjaOneAlertPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
export type NinjaOneAlertSourceType =
  | 'CONDITION'
  | 'CONDITION_DEVICE_STATE'
  | 'CONDITION_ACTIONSET'
  | 'ANTIVIRUS'
  | 'AGENT'
  | 'SCRIPTED_CONDITION'
  | 'PATCH'
  | 'CLOUDMONITOR'
  | 'NMS';

// Activities (Webhook Events)
export interface NinjaOneActivity {
  id: number;
  activityTime: string;
  deviceId?: number;
  seriesUid?: string;
  sourceConfigUid?: string;
  sourceName?: string;
  subject?: string;
  userId?: number;
  message?: string;
  type: NinjaOneActivityType;
  statusCode?: string;
  status?: string;
  activityResult?: string;
  data?: Record<string, unknown>;
  device?: {
    id: number;
    systemName?: string;
    displayName?: string;
    organizationId?: number;
  };
}

// Activity types used by webhooks
export type NinjaOneActivityType =
  // Device lifecycle
  | 'NODE_CREATED'
  | 'NODE_UPDATED'
  | 'NODE_DELETED'
  | 'NODE_APPROVED'
  | 'NODE_APPROVAL_REJECTED'
  | 'NODE_MANUALLY_APPROVED'
  | 'NODE_REJECTED'
  | 'NODE_ROLE_CHANGED'
  // Alerts/Conditions
  | 'CONDITION_TRIGGERED'
  | 'CONDITION_RESET'
  | 'CONDITION_ACTIONSET_TRIGGERED'
  | 'CONDITION_ACTIONSET_RESET'
  | 'SCRIPTED_CONDITION_TRIGGERED'
  | 'SCRIPTED_CONDITION_RESET'
  // Scripts
  | 'SCRIPT_RUN'
  | 'SCRIPT_COMPLETED'
  | 'SCRIPT_FAILED'
  // Patches
  | 'PATCH_INSTALLED'
  | 'PATCH_FAILED'
  | 'PATCH_SCAN_COMPLETED'
  // Antivirus
  | 'ANTIVIRUS_THREAT_DETECTED'
  | 'ANTIVIRUS_SCAN_COMPLETED'
  | 'ANTIVIRUS_THREAT_REMOVED'
  // User activity
  | 'USER_LOGON'
  | 'USER_LOGOFF'
  | 'USER_LOGGED_IN'
  | 'USER_LOGGED_OUT'
  // System status
  | 'SYSTEM_SHUTDOWN'
  | 'SYSTEM_STARTUP'
  | 'SYSTEM_REBOOTED'
  // Software
  | 'SOFTWARE_INSTALLED'
  | 'SOFTWARE_UNINSTALLED'
  // Hardware changes
  | 'CPU_ADDED'
  | 'CPU_REMOVED'
  | 'MEMORY_ADDED'
  | 'MEMORY_REMOVED'
  | 'DISK_DRIVE_ADDED'
  | 'DISK_DRIVE_REMOVED'
  | 'NETWORK_INTERFACE_ADDED'
  | 'NETWORK_INTERFACE_REMOVED'
  // Agent
  | 'AGENT_INSTALLED'
  | 'AGENT_UNINSTALLED'
  | 'AGENT_UPDATED'
  // Remote
  | 'REMOTE_SESSION_STARTED'
  | 'REMOTE_SESSION_ENDED'
  // Many more activity types exist...
  | string; // Allow other types

// Webhook Payload
export interface NinjaOneWebhookPayload {
  id?: number;
  activityId?: number;
  activityTime?: string;
  activityType: NinjaOneActivityType;
  statusCode?: string;
  status?: string; // TRIGGERED, RESET, etc.
  type?: string; // CONDITION, ACTIVITY, etc.
  sourceConfigUid?: string;
  sourceName?: string;
  message?: string;
  subject?: string;
  userId?: number;
  psaTicketId?: string;
  // Device info - can be at root or nested
  deviceId?: number;
  organizationId: number;
  locationId?: number;
  device?: {
    id: number;
    systemName?: string;
    displayName?: string;
    organizationId?: number;
    locationId?: number;
    nodeClass?: NinjaOneNodeClass;
  };
  // Alert-specific fields
  severity?: NinjaOneAlertSeverity;
  priority?: NinjaOneAlertPriority;
  // Result
  activityResult?: string;
  data?: Record<string, unknown>;
}

// Patches
export interface NinjaOnePatch {
  id: string;
  name: string;
  kbNumber?: string;
  severity?: 'CRITICAL' | 'IMPORTANT' | 'MODERATE' | 'LOW' | 'UNRATED';
  status?: 'APPROVED' | 'REJECTED' | 'MANUAL' | 'NOT_APPROVED';
  category?: string;
  installedOn?: string;
  timestamp?: string;
}

export interface NinjaOneDevicePatchStatus {
  deviceId: number;
  pending: number;
  failed: number;
  installed: number;
  patches?: NinjaOnePatch[];
}

// Device Link (Remote Access)
export interface NinjaOneDeviceLink {
  url: string;
  type: 'SPLASHTOP' | 'TEAMVIEWER' | 'VNC' | 'RDP' | 'SHELL';
}

// Ticketing (NinjaOne's PSA ticketing)
export interface NinjaOneTicket {
  id: number;
  nodeId?: number;
  clientId?: number;
  assignedAppUserId?: number;
  requestorUid?: string;
  subject?: string;
  description?: string;
  status?: {
    name: string;
    statusId: number;
    statusType: string;
  };
  priority?: {
    name: string;
    priorityId: number;
  };
  type?: {
    name: string;
    typeId: number;
  };
  source?: string;
  createTime?: string;
  lastUpdated?: string;
  tags?: string[];
  cc?: string[];
  requester?: {
    name?: string;
    email?: string;
  };
}

// API List Responses
export interface NinjaOnePaginatedResponse<T> {
  results: T[];
  pageSize: number;
  cursor?: string;
}

export interface NinjaOneOrganizationsResponse {
  organizations: NinjaOneOrganization[];
}

export interface NinjaOneDevicesResponse {
  devices: NinjaOneDevice[];
  cursor?: string;
}

export interface NinjaOneAlertsResponse {
  alerts: NinjaOneAlert[];
  cursor?: string;
}

// API Error
export interface NinjaOneApiError {
  error: string;
  error_description?: string;
  resultCode?: string;
  errorMessage?: string;
  incidentId?: string;
}

// API Query Parameters
export interface NinjaOneDeviceQueryParams {
  df?: string; // Device filter
  pageSize?: number;
  after?: string; // Cursor
  org?: number; // Organization ID
  // Various filters
  nodeClass?: NinjaOneNodeClass;
  offline?: boolean;
}

export interface NinjaOneAlertQueryParams {
  sourceType?: NinjaOneAlertSourceType;
  deviceFilter?: string;
  lang?: string;
  pageSize?: number;
  after?: string;
}

export interface NinjaOneActivityQueryParams {
  df?: string; // Device filter
  class?: string;
  after?: string; // Cursor or timestamp
  before?: string;
  pageSize?: number;
  activityType?: NinjaOneActivityType;
  sourceConfigUid?: string;
  seriesUid?: string;
  status?: string;
  user?: number;
  olderThan?: number; // Activity ID
  newerThan?: number;
  lang?: string;
  tz?: string;
}

// Mapping helpers
export function mapNodeClassToAssetType(nodeClass: NinjaOneNodeClass): string {
  switch (nodeClass) {
    case 'WINDOWS_WORKSTATION':
    case 'MAC':
    case 'LINUX_WORKSTATION':
      return 'workstation';
    case 'WINDOWS_SERVER':
    case 'LINUX_SERVER':
    case 'VMWARE_VM_HOST':
    case 'VMWARE_VM_GUEST':
    case 'HYPERV_VMM_HOST':
    case 'HYPERV_VMM_GUEST':
      return 'server';
    case 'NMS':
    case 'CLOUD_MONITOR_TARGET':
      return 'network_device';
    default:
      return 'unknown';
  }
}

export function mapAlertSeverity(severity: NinjaOneAlertSeverity): string {
  switch (severity) {
    case 'CRITICAL':
      return 'critical';
    case 'MAJOR':
      return 'major';
    case 'MODERATE':
      return 'moderate';
    case 'MINOR':
      return 'minor';
    case 'NONE':
    default:
      return 'none';
  }
}

export function mapAlertPriority(priority: NinjaOneAlertPriority): string {
  switch (priority) {
    case 'CRITICAL':
      return 'critical';
    case 'HIGH':
      return 'high';
    case 'MEDIUM':
      return 'medium';
    case 'LOW':
      return 'low';
    case 'NONE':
    default:
      return 'none';
  }
}

/**
 * Derive priority from severity when priority is not provided
 * Maps NinjaOne severity levels to priority levels
 */
export function derivePriorityFromSeverity(severity: NinjaOneAlertSeverity): string {
  switch (severity) {
    case 'CRITICAL':
      return 'critical';
    case 'MAJOR':
      return 'high';
    case 'MODERATE':
      return 'medium';
    case 'MINOR':
      return 'low';
    case 'NONE':
    default:
      return 'none';
  }
}

// Webhook Configuration (for PUT /v2/webhook)
export interface WebhookConfiguration {
  /** The URL to receive webhook notifications */
  url: string;
  /** Activity filters to control which events are sent */
  activities?: {
    /** Filter by specific status codes (e.g., TRIGGERED, RESET, NODE_CREATED) */
    statusCode?: string[];
    /** Filter by activity types (e.g., CONDITION, SYSTEM, PATCH_MANAGEMENT) */
    activityType?: string[];
  };
  /** References to expand in webhook payloads */
  expand?: ('device' | 'organization')[];
  /** Custom HTTP headers to include with webhook requests (e.g., for authentication) */
  headers?: Array<{ name: string; value: string }>;
  /** Filter by specific organization IDs */
  organizationIds?: number[];
}

// Default status codes for webhook subscription
export const NINJAONE_WEBHOOK_STATUS_CODES = [
  // Device lifecycle
  'NODE_CREATED',
  'NODE_UPDATED',
  'NODE_DELETED',
  'NODE_MANUALLY_APPROVED',
  'NODE_AUTOMATICALLY_APPROVED',
  'NODE_REGISTRATION_REJECTED',
  // Alert conditions
  'TRIGGERED',
  'RESET',
  'ACKNOWLEDGED',
  // System events
  'SYSTEM_REBOOTED',
  'USER_LOGGED_IN',
  'USER_LOGGED_OUT',
  // Hardware changes
  'CPU_ADDED',
  'CPU_REMOVED',
  'MEMORY_ADDED',
  'MEMORY_REMOVED',
  'DISK_DRIVE_ADDED',
  'DISK_DRIVE_REMOVED',
  'DISK_VOLUME_ADDED',
  'DISK_VOLUME_REMOVED',
  'ADAPTER_ADDED',
  'ADAPTER_REMOVED',
  'ADAPTER_CONFIG_CHANGED',
  // Patch management
  'PATCH_MANAGEMENT_SCAN_STARTED',
  'PATCH_MANAGEMENT_SCAN_COMPLETED',
  'PATCH_MANAGEMENT_INSTALLED',
  'PATCH_MANAGEMENT_INSTALL_FAILED',
  // Software changes
  'SOFTWARE_ADDED',
  'SOFTWARE_REMOVED',
] as const;

// NinjaOne regional instance URLs
export const NINJAONE_REGIONS = {
  US: 'https://app.ninjarmm.com',
  US2: 'https://us2.ninjarmm.com',
  EU: 'https://eu.ninjarmm.com',
  OC: 'https://oc.ninjarmm.com',
  CA: 'https://ca.ninjarmm.com',
} as const;

export type NinjaOneRegion = keyof typeof NINJAONE_REGIONS;
