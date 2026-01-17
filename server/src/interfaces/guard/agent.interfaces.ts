/**
 * Alga Guard - Agent Registration Interfaces
 *
 * Defines types for Endpoint Agent registration and configuration.
 * Agents run on customer workstations and execute WASM extensions
 * like the PII Scanner.
 */

/**
 * Operating system types supported by the endpoint agent
 */
export type AgentOS = 'windows' | 'macos' | 'linux';

/**
 * CPU architecture types supported by the endpoint agent
 */
export type AgentArch = 'x86_64' | 'aarch64';

/**
 * Agent status
 */
export type AgentStatus = 'active' | 'inactive' | 'offline' | 'error';

/**
 * Capabilities that an agent can support
 */
export interface AgentCapabilities {
  /** File system read access */
  fs_read: boolean;
  /** File system walk (directory traversal) */
  fs_walk: boolean;
  /** File metadata access */
  fs_metadata: boolean;
  /** Context storage access */
  context_read: boolean;
  /** Log emission */
  log_emit: boolean;
  /** Maximum concurrent WASM instances */
  max_concurrent_instances: number;
  /** Memory limit per instance in MB */
  memory_limit_mb: number;
}

/**
 * Default capabilities for a PII scanner agent
 */
export const DEFAULT_AGENT_CAPABILITIES: AgentCapabilities = {
  fs_read: true,
  fs_walk: true,
  fs_metadata: true,
  context_read: true,
  log_emit: true,
  max_concurrent_instances: 4,
  memory_limit_mb: 512,
};

/**
 * Allowed capabilities for PII Scanner extension
 * (F296: PII_SCANNER_CAPS)
 *
 * Security considerations:
 * - fs.read: Read file contents for PII detection
 * - fs.walk: Directory traversal for file discovery
 * - fs.metadata: Get file metadata (size, dates)
 * - context.read: Read scan context/configuration
 * - log.emit: Emit log messages for debugging
 *
 * DENIED capabilities:
 * - fs.write: No writing to prevent data modification
 * - fs.delete: No deletion to prevent data loss
 * - http.fetch: No network access to prevent exfiltration
 * - process.exec: No process execution for security
 */
export const PII_SCANNER_CAPS = {
  allowed: [
    'fs.read',
    'fs.walk',
    'fs.metadata',
    'context.read',
    'log.emit',
  ],
  denied: [
    'fs.write',
    'fs.delete',
    'http.fetch',
    'process.exec',
  ],
  memory_limit_mb: 512,
  timeout_ms: 300000, // 5 minutes
} as const;

/**
 * Agent registration request from endpoint agent
 * (F292: AgentRegistration struct)
 */
export interface IAgentRegistrationRequest {
  /** Unique agent ID (generated on first run, persisted locally) */
  agent_id: string;
  /** Hostname of the machine */
  hostname: string;
  /** Operating system */
  os: AgentOS;
  /** CPU architecture */
  arch: AgentArch;
  /** Agent version string */
  agent_version: string;
  /** Capabilities supported by this agent */
  capabilities: AgentCapabilities;
  /** Optional company ID if pre-configured */
  company_id?: string;
  /** Optional registration token for auth */
  registration_token?: string;
}

/**
 * Agent configuration returned on successful registration
 * (F295: AgentConfig)
 */
export interface IAgentConfig {
  /** Assigned tenant ID */
  tenant_id: string;
  /** Assigned company ID */
  company_id: string;
  /** Server-assigned agent ID (may differ from requested) */
  agent_id: string;
  /** Poll interval for extension updates (seconds) */
  poll_interval_seconds: number;
  /** Base URL for extension downloads */
  extension_base_url: string;
  /** List of installed extensions to fetch */
  installed_extensions: IAgentInstalledExtension[];
  /** Configuration for logging */
  logging: IAgentLoggingConfig;
  /** Scan paths configuration */
  scan_paths: IAgentScanPathsConfig;
}

/**
 * Installed extension info for the agent
 */
export interface IAgentInstalledExtension {
  /** Extension ID */
  extension_id: string;
  /** Extension version */
  version: string;
  /** Content hash for cache validation */
  content_hash: string;
  /** Download URL (signed, time-limited) */
  download_url: string;
}

/**
 * Logging configuration for the agent
 */
export interface IAgentLoggingConfig {
  /** Log level (debug, info, warn, error) */
  level: 'debug' | 'info' | 'warn' | 'error';
  /** Whether to send logs to server */
  remote_logging: boolean;
  /** Endpoint for remote logging */
  remote_logging_endpoint?: string;
  /** Max local log file size in MB */
  max_log_file_mb: number;
}

/**
 * Scan paths configuration sent to agent
 */
export interface IAgentScanPathsConfig {
  /** Default paths to scan based on OS */
  default_paths: string[];
  /** Global exclude patterns */
  exclude_patterns: string[];
}

/**
 * Database record for a registered agent
 */
export interface IGuardAgent {
  id: string;
  tenant: string;
  agent_id: string;
  company_id: string;
  hostname: string;
  os: AgentOS;
  arch: AgentArch;
  agent_version: string;
  capabilities: AgentCapabilities;
  status: AgentStatus;
  last_seen_at: Date;
  registered_at: Date;
  created_at: Date;
  updated_at: Date;
}

/**
 * Agent registration response
 */
export interface IAgentRegistrationResponse {
  success: boolean;
  config?: IAgentConfig;
  error?: string;
}

/**
 * Agent heartbeat request
 */
export interface IAgentHeartbeatRequest {
  agent_id: string;
  status: AgentStatus;
  running_extensions: string[];
  system_info?: {
    cpu_usage_percent?: number;
    memory_usage_mb?: number;
    disk_free_gb?: number;
  };
}

/**
 * Agent heartbeat response
 */
export interface IAgentHeartbeatResponse {
  success: boolean;
  /** Commands for agent to execute */
  pending_commands?: IAgentCommand[];
  /** Updated extension list if changed */
  extension_updates?: IAgentInstalledExtension[];
}

/**
 * Command to be executed by agent
 */
export interface IAgentCommand {
  command_id: string;
  type: 'trigger_scan' | 'update_extension' | 'restart' | 'uninstall_extension';
  payload: Record<string, unknown>;
}
