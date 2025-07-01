import { Knex } from 'knex';
import crypto from 'crypto';
import { TELEMETRY_CONFIG } from '../../config/telemetry';
import TelemetryPreferencesModel from '../models/telemetryPreferences';
import { getCurrentTenantId } from '../db';
import logger from '../../utils/logger';

export interface TelemetryContext {
  user_id_hash?: string;
  tenant_id_hash?: string;
  consent_categories: string[];
  consent_version: string;
  environment: string;
}

export class TelemetryPermissionManager {
  private knex: Knex;

  constructor(knex: Knex) {
    this.knex = knex;
  }

  /**
   * Check if telemetry collection is allowed for a specific category and user
   */
  async canCollectTelemetry(
    category: string,
    userId: string,
    tenantId?: string
  ): Promise<boolean> {
    try {
      // Telemetry is enabled by default (no legacy environment overrides)

      // User-level consent check
      const isEnabled = await TelemetryPreferencesModel.isCategoryEnabled(
        this.knex,
        userId,
        category
      );

      return isEnabled;
    } catch (error) {
      logger.error(`Error checking telemetry permission for user ${userId}, category ${category}:`, error);
      // Fail securely - deny telemetry on error
      return false;
    }
  }

  /**
   * Get telemetry context for a user with anonymized identifiers
   */
  async getTelemetryContext(
    userId: string,
    tenantId?: string
  ): Promise<TelemetryContext> {
    try {
      const resolvedTenantId = tenantId || await getCurrentTenantId();
      
      const enabledCategories = await TelemetryPreferencesModel.getEnabledCategories(
        this.knex,
        userId
      );

      const preferences = await TelemetryPreferencesModel.getTelemetryPreferences(
        this.knex,
        userId
      );

      return {
        user_id_hash: this.hashUserId(userId),
        tenant_id_hash: resolvedTenantId ? this.hashTenantId(resolvedTenantId) : undefined,
        consent_categories: enabledCategories,
        consent_version: preferences.consent_version,
        environment: process.env.NODE_ENV || 'development'
      };
    } catch (error) {
      logger.error(`Error getting telemetry context for user ${userId}:`, error);
      // Return minimal context on error
      return {
        consent_categories: [],
        consent_version: TELEMETRY_CONFIG.PRIVACY.CONSENT_VERSION,
        environment: process.env.NODE_ENV || 'development'
      };
    }
  }

  /**
   * Check if a request path should be excluded from telemetry
   */
  shouldExcludePath(path: string): boolean {
    return TELEMETRY_CONFIG.EXCLUDED_PATHS.some(excludedPath => 
      path.includes(excludedPath)
    );
  }

  /**
   * Sanitize error message to remove PII
   */
  sanitizeErrorMessage(message: string): string {
    if (!TELEMETRY_CONFIG.PRIVACY.SANITIZE_PII) {
      return message;
    }

    return message
      .replace(/email[:\s=]*[\w@.-]+/gi, 'email: [redacted]')
      .replace(/user[:\s=]*[\w@.-]+/gi, 'user: [redacted]')
      .replace(/token[:\s=]*[\w-]+/gi, 'token: [redacted]')
      .replace(/password[:\s=]*[\w-]+/gi, 'password: [redacted]')
      .replace(/key[:\s=]*[\w-]+/gi, 'key: [redacted]')
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[email-redacted]')
      .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[ssn-redacted]') // SSN pattern
      .replace(/\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, '[card-redacted]'); // Credit card pattern
  }

  /**
   * Sanitize error object for telemetry
   */
  sanitizeError(error: Error): Error {
    if (!TELEMETRY_CONFIG.PRIVACY.SANITIZE_PII) {
      return error;
    }

    const sanitized = new Error(this.sanitizeErrorMessage(error.message));
    sanitized.name = error.name;
    
    if (error.stack) {
      sanitized.stack = error.stack
        .replace(/email=[\w@.-]+/g, 'email=[redacted]')
        .replace(/user=[\w@.-]+/g, 'user=[redacted]')
        .replace(/token=[\w-]+/g, 'token=[redacted]');
    }

    return sanitized;
  }

  /**
   * Hash user ID for anonymous correlation
   */
  private hashUserId(userId: string): string {
    const salt = 'default-salt-change-in-production';
    return crypto
      .createHash('sha256')
      .update(userId + salt + 'user')
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Hash tenant ID for anonymous correlation
   */
  private hashTenantId(tenantId: string): string {
    const salt = 'default-salt-change-in-production';
    return crypto
      .createHash('sha256')
      .update(tenantId + salt + 'tenant')
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Check if user needs to be prompted for telemetry consent
   */
  async needsConsentPrompt(userId: string): Promise<boolean> {
    try {
      // Telemetry is enabled by default (no legacy environment overrides)

      const hasSetPreferences = await TelemetryPreferencesModel.hasSetPreferences(
        this.knex,
        userId
      );

      // Show consent prompt if user hasn't set preferences yet
      return !hasSetPreferences;
    } catch (error) {
      logger.error(`Error checking consent prompt for user ${userId}:`, error);
      return false; // Don't show prompt on error
    }
  }

  /**
   * Anonymize IP address for privacy compliance
   */
  anonymizeIpAddress(ip: string): string {
    if (!TELEMETRY_CONFIG.PRIVACY.ANONYMIZE_IPS) {
      return ip;
    }

    // IPv4: mask last octet
    if (ip.includes('.')) {
      const parts = ip.split('.');
      if (parts.length === 4) {
        return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
      }
    }

    // IPv6: mask last 64 bits
    if (ip.includes(':')) {
      const parts = ip.split(':');
      if (parts.length >= 4) {
        return parts.slice(0, 4).join(':') + '::';
      }
    }

    return '[anonymized]';
  }

  /**
   * Get sampling rate for telemetry based on configuration
   */
  getSamplingRate(): number {
    return 0.1;
  }

  /**
   * Determine if this request should be sampled based on sampling rate
   */
  shouldSample(): boolean {
    const samplingRate = this.getSamplingRate();
    return Math.random() < samplingRate;
  }
}

export default TelemetryPermissionManager;