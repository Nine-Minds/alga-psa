# NinjaOne RMM Integration Plan

## Overview

This plan details the implementation of a comprehensive NinjaOne RMM integration for Alga PSA, enabling MSPs to synchronize device assets, receive real-time alerts, create tickets from RMM events, and initiate remote access sessions directly from the PSA interface.

### Core Features
- **Device Synchronization**: Bidirectional sync of devices/assets between NinjaOne and Alga PSA
- **Webhook Callbacks**: Real-time notifications when changes occur in NinjaOne
- **Asset-to-Ticket Linking**: Attach assets to tickets to track which device a ticket is for
- **Alert-to-Ticket Automation**: Receive alerts and automatically create tickets based on configurable rules
- **Remote Access**: Launch remote sessions to devices through NinjaOne from within Alga PSA
- **Patch Compliance Tracking**: Monitor and display patch status for managed devices
- **Software Inventory**: Sync and display installed software from RMM-managed devices

### NinjaOne API Capabilities (Reference)

| Category | Key Endpoints | Integration Use |
|----------|--------------|-----------------|
| **Devices** | `GET /devices`, `GET /device/{id}` | Core asset sync |
| **Alerts** | `GET /alerts`, `GET /device/{id}/alerts` | Ticket creation |
| **Webhooks** | `PUT /webhook` | Real-time sync |
| **Organizations** | `GET /organizations` | Client mapping |
| **Device Link** | `GET /device/{id}/dashboard-url` | Remote access |
| **Queries** | Health report, Software, Patches | Enhanced data |

**Webhook Event Types**: `NODE_CREATED`, `NODE_UPDATED`, `NODE_DELETED`, `TRIGGERED` (alerts), `RESET`, plus 200+ activity types including hardware changes, software changes, patch events, and antivirus alerts.

---

## Asset System Readiness Assessment

### Already Supported (No Changes Needed)
- Multi-tenant architecture with RLS policies
- Extension tables for asset types (workstation, server, network device, mobile, printer)
- Asset-to-ticket associations (`asset_ticket_associations`)
- External entity mapping table (`tenant_external_entity_mappings`)
- Asset history/audit trail
- Maintenance scheduling system

### Requires Enhancement
- Agent status tracking (online/offline, last seen)
- RMM alert storage and lifecycle management
- Remote access URL storage/retrieval
- Patch compliance fields
- Asset event types in EventBus

---

## Integration Settings UI Redesign

As integrations grow (QBO, Xero, Google Calendar, Microsoft Calendar, Email, and now NinjaOne), the current flat list within the Integrations tab becomes unwieldy. This plan includes a reorganization.

### Current Structure (SettingsPage.tsx)
```
Settings > Integrations Tab
├── QboIntegrationSettings (Card)
├── XeroIntegrationSettings (Card)
├── Inbound Email Integration (Card)
└── Calendar Integrations (Card)
```

### Proposed Structure
```
Settings > Integrations Tab
├── Integration Categories (Accordion or Sub-tabs)
│   ├── Accounting
│   │   ├── QuickBooks Online
│   │   └── Xero
│   ├── RMM & Endpoint Management
│   │   └── NinjaOne (NEW)
│   ├── Email & Communication
│   │   ├── Inbound Email
│   │   └── (Future: Outbound SMTP)
│   └── Calendar & Scheduling
│       ├── Google Calendar
│       └── Microsoft Calendar
└── (Future: PSA-to-PSA migrations)
```

### UI Implementation Tasks
- [x] Create `IntegrationCategory.tsx` component with collapsible sections
- [x] Create `IntegrationCard.tsx` reusable component extracting common patterns from QBO/Xero
- [x] Refactor `SettingsPage.tsx` Integrations tab to use category-based layout
- [x] Add category icons (accounting, RMM, email, calendar)
- [ ] Ensure responsive layout for mobile/tablet views

---

## Phased Implementation Plan

### Phase 0 – Database Schema & Foundation

#### Schema: RMM Integration Configuration
- [x] Create migration `YYYYMMDDHHMMSS_create_rmm_integration_tables.cjs`
- [x] Create `rmm_integrations` table:
  ```sql
  CREATE TABLE rmm_integrations (
    tenant UUID NOT NULL,
    integration_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_type TEXT NOT NULL DEFAULT 'ninjaone',
    display_name TEXT NOT NULL,
    api_instance TEXT NOT NULL,  -- 'app' | 'eu' | 'oc' | 'ca' (region)
    client_id TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    sync_enabled BOOLEAN DEFAULT true,
    sync_interval_minutes INTEGER DEFAULT 60,
    last_full_sync_at TIMESTAMPTZ,
    last_incremental_sync_at TIMESTAMPTZ,
    webhook_secret TEXT,
    webhook_registered_at TIMESTAMPTZ,
    settings JSONB DEFAULT '{}',  -- Additional config options
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT fk_tenant FOREIGN KEY (tenant) REFERENCES tenants(tenant)
  );
  CREATE INDEX idx_rmm_integrations_tenant ON rmm_integrations(tenant);
  ```
- [x] Create `rmm_organization_mappings` table for NinjaOne org → Alga client mapping:
  ```sql
  CREATE TABLE rmm_organization_mappings (
    tenant UUID NOT NULL,
    mapping_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_id UUID NOT NULL REFERENCES rmm_integrations(integration_id) ON DELETE CASCADE,
    external_org_id TEXT NOT NULL,  -- NinjaOne organization ID
    external_org_name TEXT,
    client_id UUID REFERENCES companies(company_id),  -- Alga client
    auto_sync_devices BOOLEAN DEFAULT true,
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant, integration_id, external_org_id)
  );
  ```
- [x] Create `rmm_alerts` table:
  ```sql
  CREATE TABLE rmm_alerts (
    tenant UUID NOT NULL,
    alert_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_id UUID REFERENCES rmm_integrations(integration_id) ON DELETE CASCADE,
    external_alert_id TEXT NOT NULL,
    external_device_id TEXT NOT NULL,
    asset_id UUID REFERENCES assets(asset_id) ON DELETE SET NULL,
    severity TEXT NOT NULL,  -- NONE, MINOR, MODERATE, MAJOR, CRITICAL
    priority TEXT,  -- NONE, LOW, MEDIUM, HIGH
    activity_type TEXT NOT NULL,
    status_code TEXT NOT NULL,
    message TEXT,
    source_data JSONB,  -- Full webhook payload
    triggered_at TIMESTAMPTZ NOT NULL,
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by UUID REFERENCES users(user_id),
    resolved_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES users(user_id),
    ticket_id UUID REFERENCES tickets(ticket_id) ON DELETE SET NULL,
    auto_ticket_created BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant, integration_id, external_alert_id)
  );
  CREATE INDEX idx_rmm_alerts_asset ON rmm_alerts(asset_id);
  CREATE INDEX idx_rmm_alerts_ticket ON rmm_alerts(ticket_id);
  CREATE INDEX idx_rmm_alerts_status ON rmm_alerts(tenant, status_code, triggered_at DESC);
  ```
- [x] Create `rmm_alert_rules` table for alert-to-ticket automation:
  ```sql
  CREATE TABLE rmm_alert_rules (
    tenant UUID NOT NULL,
    rule_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_id UUID REFERENCES rmm_integrations(integration_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    priority_order INTEGER DEFAULT 0,
    conditions JSONB NOT NULL,  -- { severity: [...], activityTypes: [...], orgIds: [...] }
    actions JSONB NOT NULL,  -- { createTicket: true, ticketPriority: 'high', assignToChannel: '...' }
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
  ```

#### Schema: Asset Table Enhancements
- [x] Add RMM-specific columns to `assets` table:
  ```sql
  ALTER TABLE assets ADD COLUMN IF NOT EXISTS rmm_integration_id UUID REFERENCES rmm_integrations(integration_id) ON DELETE SET NULL;
  ALTER TABLE assets ADD COLUMN IF NOT EXISTS rmm_device_id TEXT;
  ALTER TABLE assets ADD COLUMN IF NOT EXISTS agent_status TEXT DEFAULT 'unknown';  -- online, offline, unknown
  ALTER TABLE assets ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
  ALTER TABLE assets ADD COLUMN IF NOT EXISTS remote_access_url TEXT;
  ALTER TABLE assets ADD COLUMN IF NOT EXISTS rmm_sync_status TEXT DEFAULT 'pending';  -- synced, pending, error
  ALTER TABLE assets ADD COLUMN IF NOT EXISTS rmm_last_synced_at TIMESTAMPTZ;

  CREATE INDEX idx_assets_rmm_device ON assets(rmm_integration_id, rmm_device_id);
  ```
- [x] Add patch/compliance columns to workstation and server extension tables:
  ```sql
  ALTER TABLE workstation_assets ADD COLUMN IF NOT EXISTS antivirus_status TEXT;
  ALTER TABLE workstation_assets ADD COLUMN IF NOT EXISTS antivirus_product TEXT;
  ALTER TABLE workstation_assets ADD COLUMN IF NOT EXISTS pending_os_patches INTEGER DEFAULT 0;
  ALTER TABLE workstation_assets ADD COLUMN IF NOT EXISTS pending_software_patches INTEGER DEFAULT 0;
  ALTER TABLE workstation_assets ADD COLUMN IF NOT EXISTS failed_patches INTEGER DEFAULT 0;
  ALTER TABLE workstation_assets ADD COLUMN IF NOT EXISTS last_patch_scan_at TIMESTAMPTZ;

  ALTER TABLE server_assets ADD COLUMN IF NOT EXISTS antivirus_status TEXT;
  ALTER TABLE server_assets ADD COLUMN IF NOT EXISTS antivirus_product TEXT;
  ALTER TABLE server_assets ADD COLUMN IF NOT EXISTS pending_os_patches INTEGER DEFAULT 0;
  ALTER TABLE server_assets ADD COLUMN IF NOT EXISTS pending_software_patches INTEGER DEFAULT 0;
  ALTER TABLE server_assets ADD COLUMN IF NOT EXISTS failed_patches INTEGER DEFAULT 0;
  ALTER TABLE server_assets ADD COLUMN IF NOT EXISTS last_patch_scan_at TIMESTAMPTZ;
  ```

#### Schema: Update External Entity Mappings Usage
- [x] Document usage of existing `tenant_external_entity_mappings` for device ID mapping:
  - `integration_type`: `'ninjaone'`
  - `alga_entity_type`: `'asset'`
  - `alga_entity_id`: Alga asset UUID
  - `external_entity_id`: NinjaOne device ID (string)
  - `external_realm_id`: NinjaOne organization ID (for scoping)

#### TypeScript Interfaces
- [x] Create `server/src/interfaces/rmm.interfaces.ts`:
  - `RmmIntegration`, `RmmOrganizationMapping`, `RmmAlert`, `RmmAlertRule`
  - `NinjaOneDevice`, `NinjaOneOrganization`, `NinjaOneAlert`
  - `RmmConnectionStatus`, `RmmSyncStatus`
- [x] Update `server/src/interfaces/asset.interfaces.tsx` with RMM fields

#### Event Bus Extensions
- [x] Add RMM event types to `server/src/lib/eventBus/events.ts`:
  ```typescript
  // RMM Integration Events
  RMM_DEVICE_SYNCED = 'rmm.device.synced',
  RMM_DEVICE_CREATED = 'rmm.device.created',
  RMM_DEVICE_UPDATED = 'rmm.device.updated',
  RMM_DEVICE_DELETED = 'rmm.device.deleted',
  RMM_ALERT_RECEIVED = 'rmm.alert.received',
  RMM_ALERT_ACKNOWLEDGED = 'rmm.alert.acknowledged',
  RMM_ALERT_RESOLVED = 'rmm.alert.resolved',
  RMM_SYNC_STARTED = 'rmm.sync.started',
  RMM_SYNC_COMPLETED = 'rmm.sync.completed',
  RMM_SYNC_FAILED = 'rmm.sync.failed',
  ```

---

### Phase 1 – NinjaOne API Client & OAuth

#### OAuth Flow Implementation
- [x] Create `server/src/app/api/integrations/ninjaone/connect/route.ts`:
  - Generate CSRF token using `crypto.randomBytes(16).toString('hex')`
  - Create state payload with tenant ID and CSRF token
  - Encode state as base64url
  - Determine correct NinjaOne instance URL based on region selection
  - Redirect to NinjaOne OAuth authorization endpoint
  - OAuth scopes: `monitoring`, `management`, `control` (as needed)
- [x] Create `server/src/app/api/integrations/ninjaone/callback/route.ts`:
  - Validate state parameter (decode, verify tenant, check CSRF)
  - Exchange authorization code for access/refresh tokens
  - Store tokens securely in tenant secrets via `secretProvider.setTenantSecret()`
  - Create or update `rmm_integrations` record
  - Redirect to settings page with success/error status params
- [x] Implement token refresh logic in API client

#### API Client
- [x] Create `server/src/lib/integrations/ninjaone/client.ts`:
  ```typescript
  class NinjaOneClient {
    constructor(tenantId: string, integrationId: string);

    // Token management
    private async getAccessToken(): Promise<string>;
    private async refreshTokenIfNeeded(): Promise<void>;

    // API methods
    async getOrganizations(): Promise<NinjaOneOrganization[]>;
    async getDevices(params?: DeviceQueryParams): Promise<NinjaOneDevice[]>;
    async getDeviceDetails(deviceId: number): Promise<NinjaOneDeviceDetailed>;
    async getDeviceAlerts(deviceId: number): Promise<NinjaOneAlert[]>;
    async getAlerts(params?: AlertQueryParams): Promise<NinjaOneAlert[]>;
    async getDeviceLink(deviceId: number): Promise<string>;  // Remote access URL
    async resetAlert(alertId: string): Promise<void>;

    // Webhook management
    async configureWebhook(webhookUrl: string, activities: string[]): Promise<void>;
    async removeWebhook(): Promise<void>;
  }
  ```
- [x] Create `server/src/lib/integrations/ninjaone/types.ts`:
  - NinjaOne API response types
  - Device, Organization, Alert, Activity types
  - Webhook payload types
- [x] Create `server/src/lib/integrations/ninjaone/endpoints.ts`:
  - API endpoint URL builders
  - Region-specific base URLs (app, eu, oc, ca)
- [x] Create `server/src/lib/integrations/ninjaone/errors.ts`:
  - Custom error classes for API errors
  - Rate limiting handling
  - Token expiration handling

#### Server Actions
- [x] Create `server/src/lib/actions/integrations/ninjaoneActions.ts`:
  ```typescript
  // Connection management
  export async function getNinjaOneConnectionStatus(): Promise<RmmConnectionStatus>;
  export async function disconnectNinjaOne(integrationId: string): Promise<{ success: boolean }>;
  export async function updateNinjaOneSettings(integrationId: string, settings: Partial<RmmIntegration>): Promise<void>;

  // Organization mapping
  export async function getNinjaOneOrganizations(integrationId: string): Promise<NinjaOneOrganization[]>;
  export async function getOrganizationMappings(integrationId: string): Promise<RmmOrganizationMapping[]>;
  export async function createOrganizationMapping(data: CreateOrgMappingRequest): Promise<RmmOrganizationMapping>;
  export async function updateOrganizationMapping(mappingId: string, data: UpdateOrgMappingRequest): Promise<void>;
  export async function deleteOrganizationMapping(mappingId: string): Promise<void>;

  // Sync operations
  export async function triggerFullSync(integrationId: string): Promise<{ jobId: string }>;
  export async function getSyncStatus(integrationId: string): Promise<RmmSyncStatus>;

  // Alert management
  export async function getActiveAlerts(integrationId: string, filters?: AlertFilters): Promise<RmmAlert[]>;
  export async function acknowledgeAlert(alertId: string): Promise<void>;
  export async function createTicketFromAlert(alertId: string, options?: CreateTicketOptions): Promise<{ ticketId: string }>;

  // Remote access
  export async function getRemoteAccessUrl(assetId: string): Promise<{ url: string; expiresAt: string }>;
  ```
- [x] Implement RBAC checks using existing `hasPermission()` pattern
- [x] Use `system_settings` or new `rmm_settings` resource for permissions

#### Credential Storage
- [x] Store credentials in tenant secrets:
  - Key: `ninjaone_credentials`
  - Value: JSON with `{ [integrationId]: { accessToken, refreshToken, expiresAt, instanceUrl } }`
- [x] Implement credential retrieval with automatic token refresh
- [x] Add credential validation on connection status check

---

### Phase 2 – Integration Settings UI

#### Reusable Integration Components
- [x] Create `server/src/components/settings/integrations/IntegrationCard.tsx`:
  - Reusable card component with status badge, connect/disconnect buttons
  - Props: `title`, `description`, `status`, `onConnect`, `onDisconnect`, `children`
  - Extract common patterns from `QboIntegrationSettings.tsx`
- [x] Create `server/src/components/settings/integrations/IntegrationCategory.tsx`:
  - Collapsible category container with icon and title
  - Props: `title`, `icon`, `defaultOpen`, `children`
- [x] Create `server/src/components/settings/integrations/ConnectionStatusBadge.tsx`:
  - Unified status badge component
  - States: connected, disconnected, error, syncing, expired

#### NinjaOne Settings Component
- [x] Create `server/src/components/settings/integrations/NinjaOneIntegrationSettings.tsx`:
  - Connection status display with last sync time
  - Connect button with region selector (North America, EMEA, APAC, Canada)
  - Disconnect confirmation modal
  - Sync settings (interval, auto-sync toggle)
  - Link to organization mapping
  - Link to alert rules configuration
- [x] Create `server/src/components/settings/integrations/NinjaOneDisconnectModal.tsx`:
  - Confirmation dialog following `QboDisconnectConfirmModal` pattern
  - Warning about data that will be affected
- [x] Create `server/src/components/settings/integrations/NinjaOneRegionSelector.tsx`:
  - Dropdown for selecting NinjaOne instance region
  - Display region-specific information

#### Organization Mapping UI
- [x] Create `server/src/components/settings/integrations/ninjaone/OrganizationMappingManager.tsx`:
  - List of NinjaOne organizations with mapping status
  - Dropdown to select corresponding Alga client for each org
  - Auto-sync toggle per organization
  - Bulk mapping actions
- [x] Create `server/src/components/settings/integrations/ninjaone/OrganizationMappingRow.tsx`:
  - Individual row component for org mapping
  - Status indicators (mapped, unmapped, sync error)

#### Alert Rules UI
- [x] Create `server/src/components/settings/integrations/ninjaone/AlertRulesManager.tsx`:
  - List of configured alert-to-ticket rules
  - Add/Edit/Delete rule actions
  - Rule priority ordering (drag-and-drop)
- [x] Create `server/src/components/settings/integrations/ninjaone/AlertRuleForm.tsx`:
  - Rule name and active toggle
  - Condition builder:
    - Severity filter (multi-select)
    - Activity type filter (multi-select with search)
    - Organization filter (optional)
  - Action configuration:
    - Create ticket toggle
    - Ticket priority mapping
    - Channel/team assignment
    - Notification settings

#### Settings Page Integration
- [x] Refactor `server/src/components/settings/general/SettingsPage.tsx`:
  - Implement category-based layout using `IntegrationCategory`
  - Add "RMM & Endpoint Management" category
  - Include `NinjaOneIntegrationSettings` in RMM category
  - Reorganize existing integrations into categories

---

### Phase 3 – Device Synchronization

#### Device Mapper
- [x] Create `server/src/lib/integrations/ninjaone/mappers/deviceMapper.ts`:
  ```typescript
  export function mapNinjaOneDeviceToAsset(
    device: NinjaOneDeviceDetailed,
    existingAsset?: Asset
  ): CreateAssetRequest | UpdateAssetRequest;

  export function determineAssetType(device: NinjaOneDevice): AssetType;
  // nodeClass mapping: WINDOWS_WORKSTATION → workstation, WINDOWS_SERVER → server, etc.

  export function mapDeviceHardware(device: NinjaOneDeviceDetailed): WorkstationExtension | ServerExtension;

  export function mapNetworkInterfaces(interfaces: NinjaOneNetworkInterface[]): NetworkInterfaceData[];
  ```
- [ ] Field mapping reference:
  | NinjaOne Field | Alga Asset Field |
  |----------------|------------------|
  | `id` | `rmm_device_id` |
  | `systemName` | `name` |
  | `nodeClass` | `asset_type` (mapped) |
  | `organizationId` | `client_id` (via org mapping) |
  | `offline` | `agent_status` |
  | `lastContact` | `last_seen_at` |
  | `system.manufacturer` | `attributes.manufacturer` |
  | `system.model` | `attributes.model` |
  | `os.name` + `os.version` | `os_type`, `os_version` |
  | `processors[0]` | `cpu_model`, `cpu_cores` |
  | `memory.capacity` | `ram_gb` |
  | `volumes[].capacity` | `storage_capacity` (sum) |

#### Sync Engine
- [x] Create `server/src/lib/integrations/ninjaone/sync/syncEngine.ts`:
  ```typescript
  export class NinjaOneSyncEngine {
    constructor(tenantId: string, integrationId: string);

    async runFullSync(): Promise<SyncResult>;
    async runIncrementalSync(since: Date): Promise<SyncResult>;
    async syncDevice(deviceId: number): Promise<Asset>;
    async syncOrganization(orgId: number): Promise<SyncResult>;

    private async createAsset(device: NinjaOneDevice): Promise<Asset>;
    private async updateAsset(asset: Asset, device: NinjaOneDevice): Promise<Asset>;
    private async handleDeletedDevice(deviceId: number): Promise<void>;
  }
  ```
- [x] Create `server/src/lib/integrations/ninjaone/sync/syncJob.ts`:
  - Background job for scheduled sync
  - Progress tracking and reporting
  - Error handling and retry logic
  - Emit events for sync lifecycle
- [x] Implement conflict resolution:
  - Last-write-wins for most fields
  - Preserve manual Alga edits for certain fields (notes, custom attributes)
  - Log conflicts for review

#### Initial Sync Flow
- [x] Create sync initiation endpoint/action
- [x] Implement pagination for large device sets (NinjaOne uses cursor-based pagination)
- [x] Track sync progress in `rmm_integrations.settings` JSONB
- [x] Create sync history/log table or use existing job tracking

#### Sync Scheduling
- [x] Implement configurable sync interval (default: 60 minutes)
- [x] Create cron job or Temporal workflow for scheduled sync
- [x] Add manual "Sync Now" button in UI
- [x] Implement sync locking to prevent concurrent syncs

---

### Phase 4 – Webhook Handler & Real-Time Sync

#### Webhook Endpoint
- [x] Create `server/src/app/api/webhooks/ninjaone/route.ts`:
  ```typescript
  export async function POST(request: Request) {
    // 1. Verify webhook signature (HMAC)
    // 2. Parse webhook payload
    // 3. Identify tenant from integration lookup
    // 4. Route to appropriate handler based on activityType
    // 5. Return 200 quickly, process async
  }
  ```
- [x] Implement webhook signature verification:
  - NinjaOne sends signature in header
  - Verify using stored webhook secret
- [x] Create `server/src/lib/integrations/ninjaone/webhooks/webhookHandler.ts`:
  ```typescript
  export async function handleNinjaOneWebhook(payload: NinjaOneWebhookPayload): Promise<void>;

  export async function handleDeviceEvent(payload: DeviceActivityPayload): Promise<void>;
  export async function handleAlertEvent(payload: AlertActivityPayload): Promise<void>;
  export async function handleSystemEvent(payload: SystemActivityPayload): Promise<void>;
  ```

#### Webhook Event Handlers
- [x] Device lifecycle events:
  - `NODE_CREATED`: Create new asset in Alga
  - `NODE_UPDATED`: Update existing asset
  - `NODE_DELETED`: Mark asset as inactive or delete
  - `NODE_MANUALLY_APPROVED`: Activate newly approved device
- [x] Hardware change events:
  - `CPU_ADDED`, `CPU_REMOVED`
  - `MEMORY_ADDED`, `MEMORY_REMOVED`
  - `DISK_DRIVE_ADDED`, `DISK_DRIVE_REMOVED`
  - Update extension table fields
- [x] Status events:
  - `SYSTEM_REBOOTED`: Update last_seen, log event
  - `USER_LOGGED_IN`, `USER_LOGGED_OUT`: Update last_login in extension
- [x] Alert events (CONDITION type with TRIGGERED/RESET status):
  - Create `rmm_alerts` record
  - Evaluate alert rules for auto-ticket creation
  - Emit `RMM_ALERT_RECEIVED` event

#### Webhook Registration
- [x] Add webhook configuration to connection flow
- [x] Create webhook URL with tenant-specific path or token
- [x] Register webhook with NinjaOne API on connection
- [x] Remove webhook on disconnect
- [x] Handle webhook secret rotation

#### Async Processing
- [x] Queue webhook payloads for async processing (avoid timeout)
- [x] Implement idempotency using external_alert_id/activity id
- [x] Add retry logic for transient failures
- [x] Create webhook processing log for debugging

---

### Phase 5 – Alert Integration & Ticket Creation

#### Alert Processing
- [x] Create `server/src/lib/integrations/ninjaone/alerts/alertProcessor.ts`:
  ```typescript
  export async function processAlert(
    tenantId: string,
    integrationId: string,
    alertPayload: NinjaOneAlertPayload
  ): Promise<RmmAlert>;

  export async function evaluateAlertRules(
    tenantId: string,
    alert: RmmAlert
  ): Promise<AlertRuleMatch | null>;

  export async function executeAlertActions(
    alert: RmmAlert,
    rule: RmmAlertRule
  ): Promise<void>;
  ```

#### Ticket Creation from Alerts
- [x] Create `server/src/lib/integrations/ninjaone/alerts/ticketCreator.ts`:
  ```typescript
  export async function createTicketFromAlert(
    alert: RmmAlert,
    options: CreateTicketFromAlertOptions
  ): Promise<Ticket>;
  ```
- [ ] Ticket content generation:
  - Title: `[NinjaOne Alert] {activityType} on {deviceName}`
  - Description: Alert details, device info, severity
  - Priority mapping: CRITICAL → urgent, MAJOR → high, MODERATE → medium, MINOR → low
  - Auto-link to asset via `asset_ticket_associations`
  - Include device context (client, location, IP, last user)
- [x] Update `rmm_alerts` with ticket reference

#### Alert Management UI
- [ ] Create `server/src/components/alerts/RmmAlertsPanel.tsx`:
  - List of active RMM alerts
  - Filter by severity, status, device
  - Acknowledge/resolve actions
  - Create ticket action
- [ ] Add alerts indicator to asset detail drawer
- [ ] Create alert detail modal/drawer

#### Alert Acknowledgment & Resolution
- [ ] Implement acknowledge action (updates local record)
- [ ] Implement resolve action (optionally resets in NinjaOne via API)
- [ ] Track who acknowledged/resolved
- [ ] Sync acknowledgment state bidirectionally (optional)

---

### Phase 6 – Remote Access Integration

#### Remote Access URL Retrieval
- [x] Implement `getRemoteAccessUrl` in NinjaOne client:
  - Call `GET /device/{id}/dashboard-url` endpoint
  - Parse and return the remote access URL
  - Handle cases where remote access is not available
- [ ] Cache URLs with short TTL (5-10 minutes)
- [x] Handle URL expiration gracefully

#### Remote Access UI
- [x] Add "Remote Connect" button to `AssetDetailDrawer.tsx`:
  - Only show for RMM-managed assets
  - Show loading state while fetching URL
  - Open URL in new tab/window
  - Handle errors (device offline, no remote access configured)
- [x] Create `server/src/components/assets/RemoteAccessButton.tsx`:
  - Props: `assetId`, `disabled`, `variant`
  - Handle click to fetch and open URL
  - Show tooltip with device status
- [x] Add remote access to asset actions menu
- [x] Log remote access attempts for audit trail

#### Remote Access from Ticket Context
- [x] Add remote access button to ticket detail when asset is linked
- [x] Show linked asset's remote access status
- [ ] Quick action in ticket actions menu

---

### Phase 7 – Enhanced Asset Display

#### Asset Card Enhancements
- [x] Update `AssetCard.tsx` to show RMM status:
  - Agent status indicator (online/offline badge)
  - Last seen timestamp
  - Sync status indicator
  - Patch compliance badge (if applicable)
- [x] Add RMM source indicator for synced assets
- [ ] Show alert count badge when active alerts exist

#### Asset Detail Drawer Enhancements
- [x] Add "RMM Status" section to detail drawer:
  - Agent status with last contact time
  - Sync status and last sync time
  - Link to NinjaOne dashboard
  - Remote access button
- [x] Add "Active Alerts" section:
  - List of unresolved alerts for this device
  - Quick actions (acknowledge, create ticket)
- [x] Add "Patch Status" section:
  - Pending patches count
  - Failed patches count
  - Last scan time
  - Link to detailed patch report
- [x] Add "Software Inventory" section:
  - List of installed software from RMM
  - Version information
  - Search functionality

#### Asset List Filters
- [x] Add RMM-related filters to asset list:
  - Agent status (online, offline, unknown)
  - RMM managed (yes, no)
  - [ ] Has active alerts (future)
  - [ ] Patch compliance status (future)
- [ ] Add bulk actions for RMM assets:
  - Trigger sync for selected
  - View in NinjaOne (bulk open)

---

### Phase 8 – Patch & Software Inventory Sync

#### Patch Status Sync
- [x] Create `ee/server/src/lib/integrations/ninjaone/sync/patchSync.ts`:
  - Fetch pending/failed patches from NinjaOne
  - Update extension table fields
  - Track patch scan timestamps
- [x] Add server actions for patch sync (`triggerPatchStatusSync`)
- [ ] Add patch status to device sync flow (auto-sync during device sync)
- [ ] Create scheduled patch status refresh (less frequent than device sync)

#### Software Inventory Sync
- [x] Create `ee/server/src/lib/integrations/ninjaone/sync/softwareSync.ts`:
  - Fetch installed software list
  - Store in extension table `installed_software` JSONB field
  - Track software changes in asset history
- [x] Implement software inventory UI component (`AssetSoftwareInventory.tsx`)
- [x] Add software search across assets (`searchSoftwareAcrossAssets`, `searchSoftware` action)

#### Compliance Dashboard
- [x] Create compliance summary widget for dashboard:
  - Devices online/offline count
  - Patches pending/failed count
  - Active alerts count
  - `NinjaOneComplianceDashboard.tsx` component
- [x] Add `getRmmComplianceSummary` server action
- [ ] Add compliance reporting (future)

#### Asset List RMM Filters
- [x] Add agent status filter (Online, Offline, Unknown)
- [x] Add RMM managed filter (Managed, Not Managed)
- [x] Display RMM filter pills in active filters bar

---

### Phase 9 – Testing & Documentation

#### Unit Tests
- [ ] Test NinjaOne API client methods
- [ ] Test device mapper transformations
- [ ] Test webhook signature verification
- [ ] Test alert rule evaluation
- [ ] Test ticket creation from alerts

#### Integration Tests
- [ ] Test OAuth flow (mock NinjaOne OAuth server)
- [ ] Test webhook endpoint with sample payloads
- [ ] Test full sync workflow
- [ ] Test alert-to-ticket flow

#### E2E Tests
- [ ] Test connection flow in UI
- [ ] Test organization mapping UI
- [ ] Test alert rules configuration
- [ ] Test remote access button functionality

#### Documentation
- [ ] Create user documentation for NinjaOne setup
- [ ] Document organization mapping best practices
- [ ] Document alert rule configuration
- [ ] Create troubleshooting guide
- [ ] Add API documentation for webhook endpoint

---

## File Structure Summary

```
server/src/
├── app/
│   └── api/
│       ├── integrations/
│       │   └── ninjaone/
│       │       ├── connect/route.ts
│       │       └── callback/route.ts
│       └── webhooks/
│           └── ninjaone/
│               └── route.ts
├── components/
│   └── settings/
│       └── integrations/
│           ├── IntegrationCard.tsx
│           ├── IntegrationCategory.tsx
│           ├── ConnectionStatusBadge.tsx
│           ├── NinjaOneIntegrationSettings.tsx
│           ├── NinjaOneDisconnectModal.tsx
│           ├── NinjaOneRegionSelector.tsx
│           └── ninjaone/
│               ├── OrganizationMappingManager.tsx
│               ├── OrganizationMappingRow.tsx
│               ├── AlertRulesManager.tsx
│               └── AlertRuleForm.tsx
├── lib/
│   ├── actions/
│   │   └── integrations/
│   │       └── ninjaoneActions.ts
│   └── integrations/
│       └── ninjaone/
│           ├── client.ts
│           ├── types.ts
│           ├── endpoints.ts
│           ├── errors.ts
│           ├── mappers/
│           │   └── deviceMapper.ts
│           ├── sync/
│           │   ├── syncEngine.ts
│           │   ├── syncJob.ts
│           │   ├── patchSync.ts
│           │   └── softwareSync.ts
│           ├── webhooks/
│           │   └── webhookHandler.ts
│           └── alerts/
│               ├── alertProcessor.ts
│               └── ticketCreator.ts
└── interfaces/
    └── rmm.interfaces.ts

server/migrations/
└── YYYYMMDDHHMMSS_create_rmm_integration_tables.cjs
```

---

## Dependencies & Prerequisites

### External
- NinjaOne API application registration (OAuth client ID/secret)
- Webhook endpoint accessible from NinjaOne servers (public URL or tunnel for dev)
- NinjaOne account with API access enabled

### Internal
- Existing `tenant_external_entity_mappings` table
- Existing `ISecretProvider` for credential storage
- Existing asset management system
- Existing ticket system
- EventBus for event publishing

---

## Acceptance Criteria

### Phase 1-2 (Connection & UI)
- [x] User can connect NinjaOne account via OAuth from settings
- [x] Connection status displays correctly (connected, disconnected, error)
- [x] User can disconnect NinjaOne integration
- [x] Settings page shows integrations in organized categories

### Phase 3 (Device Sync)
- [x] Initial sync imports all devices from mapped organizations
- [x] Devices are created with correct asset type based on nodeClass
- [x] Hardware details (CPU, RAM, storage) are populated in extension tables
- [x] Scheduled sync runs at configured interval
- [x] Manual "Sync Now" works correctly

### Phase 4 (Webhooks)
- [x] Webhook endpoint receives and validates NinjaOne callbacks
- [x] Device changes in NinjaOne reflect in Alga within seconds
- [x] New devices are created automatically
- [x] Deleted devices are handled appropriately

### Phase 5 (Alerts & Tickets)
- [x] Alerts from NinjaOne are stored in rmm_alerts table
- [x] Alert rules can be configured via UI
- [x] Tickets are auto-created based on matching rules
- [x] Tickets include device context and are linked to asset

### Phase 6 (Remote Access)
- [x] "Remote Connect" button appears on RMM-synced assets
- [x] Clicking button opens NinjaOne remote session in new tab
- [ ] Remote access works from asset detail and ticket context

### Phase 7-8 (Enhanced Display & Compliance)
- [x] Asset cards show agent status and alert indicators
- [x] Asset detail shows comprehensive RMM status
- [x] Patch compliance status is displayed (AssetPatchStatusSection)
- [x] Software inventory is viewable (AssetSoftwareInventory)
- [x] Compliance dashboard widget shows fleet health
- [x] Asset list supports RMM filters (agent status, managed/unmanaged)

---

## Future Considerations

### Additional RMM Platforms
This architecture is designed to support multiple RMM platforms. Future integrations could include:
- Datto RMM
- ConnectWise Automate
- Syncro
- Atera

The `rmm_integrations` table and `integration_type` field support this extensibility.

### Bidirectional Sync Enhancements
- Push Alga asset changes to NinjaOne custom fields
- Sync maintenance windows bidirectionally
- Push ticket status updates to NinjaOne

### Advanced Features
- Script execution from Alga PSA
- Patch deployment initiation
- Software deployment
- Device group management
