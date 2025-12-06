/**
 * TURN Server Credential Generation
 *
 * Generates time-limited credentials for TURN server authentication.
 * Uses HMAC-SHA1 with a shared secret following the REST API for TURN
 * server authentication (RFC 7635).
 */

import crypto from 'crypto';

/**
 * ICE server configuration for WebRTC connections
 */
export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
  credentialType?: 'password';
}

/**
 * Configuration for TURN credential generation
 */
export interface TurnConfig {
  /** TURN server hostname or IP */
  turnHost: string;
  /** STUN port (default: 3478) */
  stunPort?: number;
  /** TURN UDP port (default: 3478) */
  turnUdpPort?: number;
  /** TURN TCP port (default: 3478) */
  turnTcpPort?: number;
  /** TURN TLS port (default: 5349) */
  turnTlsPort?: number;
  /** Shared secret for HMAC credential generation */
  staticSecret: string;
  /** Time-to-live for credentials in seconds (default: 86400 / 24 hours) */
  ttl?: number;
}

/**
 * Generated TURN credentials with ICE server configuration
 */
export interface TurnCredentials {
  /** List of ICE server configurations */
  iceServers: IceServer[];
  /** Unix timestamp when credentials expire */
  expiresAt: number;
}

/**
 * Default configuration values
 */
const DEFAULT_TTL = 24 * 3600; // 24 hours
const DEFAULT_STUN_PORT = 3478;
const DEFAULT_TURN_UDP_PORT = 3478;
const DEFAULT_TURN_TCP_PORT = 3478;
const DEFAULT_TURN_TLS_PORT = 5349;

/**
 * Get TURN configuration from environment variables
 */
export function getTurnConfigFromEnv(): TurnConfig | null {
  const turnHost = process.env.TURN_SERVER_HOST;
  const staticSecret = process.env.TURN_STATIC_SECRET;

  if (!turnHost || !staticSecret) {
    return null;
  }

  return {
    turnHost,
    staticSecret,
    stunPort: parseInt(process.env.TURN_STUN_PORT || String(DEFAULT_STUN_PORT), 10),
    turnUdpPort: parseInt(process.env.TURN_UDP_PORT || String(DEFAULT_TURN_UDP_PORT), 10),
    turnTcpPort: parseInt(process.env.TURN_TCP_PORT || String(DEFAULT_TURN_TCP_PORT), 10),
    turnTlsPort: parseInt(process.env.TURN_TLS_PORT || String(DEFAULT_TURN_TLS_PORT), 10),
    ttl: parseInt(process.env.TURN_CREDENTIAL_TTL || String(DEFAULT_TTL), 10),
  };
}

/**
 * Generate TURN credentials for a session
 *
 * Uses the REST API authentication mechanism where:
 * - username = timestamp:sessionId
 * - credential = HMAC-SHA1(secret, username)
 *
 * @param sessionId - Unique session identifier to include in credentials
 * @param config - TURN server configuration
 * @returns TURN credentials with ICE server configuration
 */
export function generateTurnCredentials(
  sessionId: string,
  config: TurnConfig
): TurnCredentials {
  const ttl = config.ttl ?? DEFAULT_TTL;
  const timestamp = Math.floor(Date.now() / 1000) + ttl;
  const username = `${timestamp}:${sessionId}`;

  // Generate HMAC-SHA1 credential
  const hmac = crypto.createHmac('sha1', config.staticSecret);
  hmac.update(username);
  const credential = hmac.digest('base64');

  // Build ICE server URLs
  const stunPort = config.stunPort ?? DEFAULT_STUN_PORT;
  const turnUdpPort = config.turnUdpPort ?? DEFAULT_TURN_UDP_PORT;
  const turnTcpPort = config.turnTcpPort ?? DEFAULT_TURN_TCP_PORT;
  const turnTlsPort = config.turnTlsPort ?? DEFAULT_TURN_TLS_PORT;

  const iceServers: IceServer[] = [
    // STUN server (no credentials needed)
    {
      urls: `stun:${config.turnHost}:${stunPort}`,
    },
    // TURN servers with credentials
    {
      urls: [
        `turn:${config.turnHost}:${turnUdpPort}?transport=udp`,
        `turn:${config.turnHost}:${turnTcpPort}?transport=tcp`,
        `turns:${config.turnHost}:${turnTlsPort}?transport=tcp`,
      ],
      username,
      credential,
      credentialType: 'password',
    },
  ];

  return {
    iceServers,
    expiresAt: timestamp,
  };
}

/**
 * Generate ICE servers configuration for a session
 *
 * Falls back to public STUN servers if TURN is not configured.
 *
 * @param sessionId - Unique session identifier
 * @returns Array of ICE server configurations
 */
export function getIceServersForSession(sessionId: string): IceServer[] {
  const turnConfig = getTurnConfigFromEnv();

  if (turnConfig) {
    return generateTurnCredentials(sessionId, turnConfig).iceServers;
  }

  // Fallback to public STUN servers when TURN is not configured
  // Note: These won't work for symmetric NAT scenarios
  return [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ];
}

/**
 * Check if TURN server is configured
 */
export function isTurnConfigured(): boolean {
  return getTurnConfigFromEnv() !== null;
}

/**
 * Validate TURN configuration
 *
 * @param config - TURN configuration to validate
 * @returns Array of validation errors, empty if valid
 */
export function validateTurnConfig(config: TurnConfig): string[] {
  const errors: string[] = [];

  if (!config.turnHost || config.turnHost.trim() === '') {
    errors.push('TURN server host is required');
  }

  if (!config.staticSecret || config.staticSecret.length < 16) {
    errors.push('TURN static secret must be at least 16 characters');
  }

  if (config.ttl && (config.ttl < 60 || config.ttl > 86400 * 7)) {
    errors.push('TTL must be between 60 seconds and 7 days');
  }

  const ports = [config.stunPort, config.turnUdpPort, config.turnTcpPort, config.turnTlsPort];
  for (const port of ports) {
    if (port && (port < 1 || port > 65535)) {
      errors.push(`Invalid port number: ${port}`);
    }
  }

  return errors;
}
