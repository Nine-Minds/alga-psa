/**
 * Datto RMM REST API (v2) response shapes, from the published OpenAPI spec.
 *
 * Everything is optional/nullable on purpose: Datto omits fields freely, and
 * the spec types date fields as strings although the live API returns epoch
 * milliseconds, so timestamp fields accept either.
 */

/** Epoch milliseconds in practice; the spec says string. */
export type DattoTimestamp = number | string | null;

export interface DattoPageDetails {
  count?: number | null;
  totalCount?: number | null;
  prevPageUrl?: string | null;
  nextPageUrl?: string | null;
}

export interface DattoDevicesStatus {
  numberOfDevices?: number | null;
  numberOfOnlineDevices?: number | null;
  numberOfOfflineDevices?: number | null;
  numberOfOnDemandDevices?: number | null;
  numberOfManagedDevices?: number | null;
}

export interface DattoAccount {
  id?: number;
  uid?: string;
  name?: string | null;
  currency?: string | null;
  descriptor?: Record<string, unknown> | null;
  devicesStatus?: DattoDevicesStatus | null;
}

export interface DattoSite {
  id?: number;
  uid: string;
  accountUid?: string | null;
  name?: string | null;
  description?: string | null;
  notes?: string | null;
  onDemand?: boolean | null;
  splashtopAutoInstall?: boolean | null;
  proxySettings?: Record<string, unknown> | null;
  devicesStatus?: DattoDevicesStatus | null;
  autotaskCompanyName?: string | null;
  autotaskCompanyId?: string | null;
  portalUrl?: string | null;
}

export interface DattoDeviceType {
  category?: string | null;
  type?: string | null;
}

export interface DattoAntivirus {
  antivirusProduct?: string | null;
  antivirusStatus?: string | null;
}

export interface DattoPatchManagement {
  patchStatus?: string | null;
  patchesApprovedPending?: number | null;
  patchesNotApproved?: number | null;
  patchesInstalled?: number | null;
}

export interface DattoDevice {
  id?: number;
  uid: string;
  siteId?: number | null;
  siteUid?: string | null;
  siteName?: string | null;
  deviceType?: DattoDeviceType | null;
  hostname?: string | null;
  intIpAddress?: string | null;
  extIpAddress?: string | null;
  operatingSystem?: string | null;
  lastLoggedInUser?: string | null;
  domain?: string | null;
  cagVersion?: string | null;
  displayVersion?: string | null;
  description?: string | null;
  a64Bit?: boolean | null;
  rebootRequired?: boolean | null;
  online?: boolean | null;
  suspended?: boolean | null;
  deleted?: boolean | null;
  lastSeen?: DattoTimestamp;
  lastReboot?: DattoTimestamp;
  lastAuditDate?: DattoTimestamp;
  creationDate?: DattoTimestamp;
  snmpEnabled?: boolean | null;
  deviceClass?: string | null;
  portalUrl?: string | null;
  warrantyDate?: string | null;
  antivirus?: DattoAntivirus | null;
  patchManagement?: DattoPatchManagement | null;
  softwareStatus?: string | null;
  webRemoteUrl?: string | null;
  networkProbe?: boolean | null;
  onboardedViaNetworkMonitor?: boolean | null;
  /** udf1..udf300; present on the live API. */
  udf?: Record<string, string | null> | null;
}

export interface DattoNetworkInterface {
  instance?: string | null;
  ipv4?: string | null;
  ipv6?: string | null;
  macAddress?: string | null;
  type?: string | null;
}

export interface DattoBios {
  instance?: string | null;
  releaseDate?: string | null;
  serialNumber?: string | null;
  smBiosVersion?: string | null;
}

export interface DattoBaseBoard {
  manufacturer?: string | null;
  product?: string | null;
}

export interface DattoSystemInfo {
  manufacturer?: string | null;
  model?: string | null;
  totalPhysicalMemory?: number | null;
  username?: string | null;
  dotNetVersion?: string | null;
  totalCpuCores?: number | null;
}

export interface DattoProcessor {
  name?: string | null;
}

export interface DattoPhysicalMemory {
  module?: string | null;
  /** Bytes. */
  size?: number | null;
  type?: string | null;
  speed?: string | null;
  serialNumber?: string | null;
  partNumber?: string | null;
  bank?: string | null;
}

export interface DattoLogicalDisk {
  description?: string | null;
  diskIdentifier?: string | null;
  /** Bytes. */
  freespace?: number | null;
  /** Bytes. */
  size?: number | null;
}

export interface DattoDeviceAudit {
  portalUrl?: string | null;
  webRemoteUrl?: string | null;
  systemInfo?: DattoSystemInfo | null;
  nics?: DattoNetworkInterface[] | null;
  bios?: DattoBios | null;
  baseBoard?: DattoBaseBoard | null;
  displays?: Array<{ instance?: string | null; screenHeight?: number | null; screenWidth?: number | null }> | null;
  logicalDisks?: DattoLogicalDisk[] | null;
  mobileInfo?: Array<Record<string, unknown>> | null;
  processors?: DattoProcessor[] | null;
  videoBoards?: Array<{ displayAdapter?: string | null }> | null;
  attachedDevices?: Array<Record<string, unknown>> | null;
  snmpInfo?: Record<string, unknown> | null;
  physicalMemory?: DattoPhysicalMemory[] | null;
}

export interface DattoPrinterAudit {
  portalUrl?: string | null;
  snmpInfo?: Record<string, unknown> | null;
  printerMarkerSupplies?: Array<Record<string, unknown>> | null;
  printer?: { printedPageCount?: number | null } | null;
  systemInfo?: { manufacturer?: string | null; model?: string | null } | null;
  nics?: DattoNetworkInterface[] | null;
}

/** Loose: ESXi hosts are rare and only used for make/model/serial/memory. */
export interface DattoEsxiHostAudit {
  portalUrl?: string | null;
  systemInfo?: {
    manufacturer?: string | null;
    model?: string | null;
    name?: string | null;
    numberOfSnapshots?: number | null;
    serviceTag?: string | null;
  } | null;
  guests?: Array<Record<string, unknown>> | null;
  processors?: Array<{ frequency?: number | null; name?: string | null; numberOfCores?: number | null }> | null;
  nics?: Array<Record<string, unknown>> | null;
  physicalMemory?: DattoPhysicalMemory[] | null;
  datastores?: Array<Record<string, unknown>> | null;
}

export interface DattoSoftware {
  name?: string | null;
  version?: string | null;
}

export interface DattoAlertContext {
  /** Alert type discriminator, e.g. 'perf_disk_usage_ctx'. */
  '@class'?: string | null;
  [key: string]: unknown;
}

export interface DattoAlertMonitorInfo {
  sendsEmails?: boolean | null;
  createsTicket?: boolean | null;
  [key: string]: unknown;
}

export interface DattoAlertSourceInfo {
  deviceUid?: string | null;
  deviceName?: string | null;
  siteUid?: string | null;
  siteName?: string | null;
}

export interface DattoResponseAction {
  actionTime?: DattoTimestamp;
  actionType?: string | null;
  description?: string | null;
  actionReference?: string | null;
  actionReferenceInt?: string | null;
}

export interface DattoAlert {
  alertUid: string;
  /** Critical, High, Moderate, Low, Information, or Unknown. */
  priority?: string | null;
  diagnostics?: string | null;
  resolved?: boolean | null;
  resolvedBy?: string | null;
  resolvedOn?: DattoTimestamp;
  muted?: boolean | null;
  ticketNumber?: string | null;
  /** Epoch milliseconds in practice. */
  timestamp?: DattoTimestamp;
  alertMonitorInfo?: DattoAlertMonitorInfo | null;
  alertContext?: DattoAlertContext | null;
  alertSourceInfo?: DattoAlertSourceInfo | null;
  responseActions?: DattoResponseAction[] | null;
  autoresolveMins?: number | null;
}

export interface DattoComponentVariable {
  name?: string | null;
  defaultVal?: string | null;
  type?: string | null;
  direction?: boolean | null;
  description?: string | null;
  variablesIdx?: number | null;
}

export interface DattoComponent {
  id?: number;
  uid: string;
  name?: string | null;
  description?: string | null;
  categoryCode?: string | null;
  credentialsRequired?: boolean | null;
  variables?: DattoComponentVariable[] | null;
}

export interface DattoJob {
  id?: number;
  uid?: string;
  name?: string | null;
  dateCreated?: DattoTimestamp;
  /** 'active' or 'completed'. */
  status?: string | null;
}

export interface DattoJobComponentVariable {
  name: string;
  value: string;
}

export interface DattoJobComponent {
  uid?: string;
  name?: string | null;
  variables?: DattoJobComponentVariable[] | null;
}

export interface DattoCreateQuickJobResponse {
  job: DattoJob;
  jobComponents?: DattoJobComponent[] | null;
}

export interface DattoJobComponentResult {
  componentUid?: string | null;
  componentName?: string | null;
  componentStatus?: string | null;
  numberOfWarnings?: number | null;
  hasStdOut?: boolean | null;
  hasStdErr?: boolean | null;
}

export interface DattoJobResults {
  jobUid?: string | null;
  deviceUid?: string | null;
  ranOn?: DattoTimestamp;
  jobDeploymentStatus?: string | null;
  componentResults?: DattoJobComponentResult[] | null;
}

export interface DattoJobStdData {
  componentUid?: string | null;
  componentName?: string | null;
  stdData?: string | null;
}

export interface DattoRequestRate {
  slidingTimeWindowSizeSeconds?: number | null;
  accountUid?: string | null;
  accountCount?: number | null;
  accountRateLimit?: number | null;
  accountCutOffRatio?: number | null;
  accountWriteRateLimit?: number | null;
  accountWriteCount?: number | null;
  operationWriteStatus?: Record<string, { limit?: number | null; count?: number | null }> | null;
}
