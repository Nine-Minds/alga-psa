/**
 * Alga PSA Desktop Agent
 *
 * Main entry point for the desktop agent that handles:
 * - WebRTC remote desktop connections
 * - Screen capture and streaming
 * - Input control (mouse/keyboard)
 * - File transfer
 * - Auto-updates
 */

export * from './updater';
export * from './streaming';

// Agent version
export const AGENT_VERSION = '1.0.0';

// Agent configuration interface
export interface AgentConfig {
  serverUrl: string;
  tenant: string;
  agentId: string;
  connectionToken: string;
  enableAutoUpdate?: boolean;
  updateCheckInterval?: number;
}

// Re-export key types
export type { UpdateManifest, UpdateCheckerConfig } from './updater';
export type {
  QualityLevel,
  NetworkStats,
  EncoderStats,
  AdaptiveBitrateConfig,
  QualityChangeEvent,
} from './streaming';
