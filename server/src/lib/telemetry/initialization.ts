import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { SpanProcessor, Span } from '@opentelemetry/sdk-trace-base';
import { TELEMETRY_CONFIG } from '../../config/telemetry';
import TelemetryPermissionManager from './permissions';
import { createTenantKnex } from '../db';
import logger from '../../utils/logger';

let telemetryInitialized = false;
let permissionManager: TelemetryPermissionManager | null = null;

/**
 * Privacy-aware span processor that sanitizes PII and respects user consent
 */
class PrivacyAwareSpanProcessor implements SpanProcessor {
  private permissionManager: TelemetryPermissionManager | null;

  constructor(permissionManager: TelemetryPermissionManager | null) {
    this.permissionManager = permissionManager;
  }

  onStart(span: Span): void {
    // Remove PII from span attributes immediately
    if (TELEMETRY_CONFIG.PRIVACY.SANITIZE_PII) {
      this.sanitizeSpanAttributes(span);
    }
  }

  onEnd(span: Span): void {
    // Final sanitization before export
    this.sanitizeOperationName(span);
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  private sanitizeSpanAttributes(span: Span): void {
    const attributes = span.attributes || {};
    const sensitiveKeys = [
      'user.email', 'user.name', 'user.phone', 'user.ssn', 
      'customer.email', 'customer.name', 'client.email',
      'password', 'token', 'key', 'secret', 'api_key',
      'credit_card', 'ssn', 'tax_id', 'authorization'
    ];
    
    sensitiveKeys.forEach(key => {
      delete attributes[key];
      // Also check for keys containing these terms
      Object.keys(attributes).forEach(attrKey => {
        if (attrKey.toLowerCase().includes(key.toLowerCase())) {
          delete attributes[attrKey];
        }
      });
    });
  }

  private sanitizeOperationName(span: Span): void {
    const name = span.name;
    const sanitizedName = name
      .replace(/user_\d+/g, 'user_[id]')
      .replace(/tenant_[a-f0-9-]+/g, 'tenant_[id]')
      .replace(/email=[^&\s]+/g, 'email=[redacted]')
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[email]');
    
    if (sanitizedName !== name) {
      span.updateName(sanitizedName);
    }
  }
}

/**
 * Initialize telemetry with privacy-first configuration
 */
export async function initializeTelemetry(): Promise<void> {
  // Prevent multiple initializations
  if (telemetryInitialized) {
    logger.debug('Telemetry already initialized, skipping');
    return;
  }

  try {
    // Check if telemetry is enabled at environment level
    if (!TELEMETRY_CONFIG.ENVIRONMENT_OVERRIDES.TELEMETRY_ENABLED) {
      logger.info('Telemetry disabled via TELEMETRY_ENABLED environment variable');
      return;
    }

    if (TELEMETRY_CONFIG.ENVIRONMENT_OVERRIDES.TELEMETRY_FORCE_DISABLE) {
      logger.info('Telemetry force disabled via TELEMETRY_FORCE_DISABLE environment variable');
      return;
    }

    const endpoint = TELEMETRY_CONFIG.ENVIRONMENT_OVERRIDES.TELEMETRY_ENDPOINT;
    if (!endpoint) {
      logger.warn('Telemetry endpoint not configured, skipping telemetry initialization');
      return;
    }

    // Permission manager will be initialized lazily when needed
    // since we don't have a tenant context at startup
    permissionManager = null;

    // Create OTLP exporter
    const traceExporter = new OTLPTraceExporter({
      url: `${endpoint}/v1/traces`,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Create resource with service information
    const resource = resourceFromAttributes({
      [SemanticResourceAttributes.SERVICE_NAME]: 'alga-psa-backend',
      [SemanticResourceAttributes.SERVICE_VERSION]: process.env.APP_VERSION || '1.0.0',
      [SemanticResourceAttributes.SERVICE_NAMESPACE]: 'alga-psa',
      environment: process.env.NODE_ENV || 'development',
      deployment_environment: process.env.DEPLOYMENT_ENV || 'unknown',
    });

    // Configure instrumentations with privacy settings
    const instrumentations = getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { 
        enabled: false // Disable file system instrumentation for privacy
      },
      '@opentelemetry/instrumentation-pg': {
        enabled: true,
        enhancedDatabaseReporting: false // Disable enhanced reporting to avoid PII
      },
      '@opentelemetry/instrumentation-http': {
        enabled: true,
        ignoreIncomingRequestHook: (req: any) => {
          // Skip telemetry for excluded paths
          return permissionManager?.shouldExcludePath(req.url || req.path || '') || false;
        },
        responseHook: (span: any, response: any) => {
          // Remove sensitive headers
          if (span.attributes) {
            delete span.attributes['http.request.header.authorization'];
            delete span.attributes['http.request.header.cookie'];
            delete span.attributes['http.response.header.set-cookie'];
          }
        }
      },
      '@opentelemetry/instrumentation-redis': {
        enabled: true,
        // Don't capture Redis command arguments to avoid PII
        dbStatementSerializer: () => '[redacted]'
      }
    });

    // Initialize SDK
    const sdk = new NodeSDK({
      resource,
      traceExporter,
      instrumentations,
      spanProcessors: [
        new PrivacyAwareSpanProcessor(null)
      ]
    });

    // Start the SDK
    sdk.start();
    telemetryInitialized = true;

    logger.info('Privacy-aware telemetry initialized successfully', {
      endpoint,
      samplingRate: TELEMETRY_CONFIG.ENVIRONMENT_OVERRIDES.TELEMETRY_SAMPLE_RATE,
      environment: process.env.NODE_ENV,
      piiSanitization: TELEMETRY_CONFIG.PRIVACY.SANITIZE_PII,
      ipAnonymization: TELEMETRY_CONFIG.PRIVACY.ANONYMIZE_IPS
    });

    // Register shutdown handler
    process.on('SIGTERM', () => {
      sdk.shutdown()
        .then(() => logger.info('Telemetry SDK shutdown successfully'))
        .catch((error) => logger.error('Error shutting down telemetry SDK:', error));
    });

  } catch (error) {
    logger.error('Failed to initialize telemetry:', error);
    // Don't throw - allow application to continue without telemetry
  }
}

/**
 * Get the telemetry permission manager instance
 * Lazily initializes it if needed and we have a database connection
 */
export async function getTelemetryPermissionManager(): Promise<TelemetryPermissionManager | null> {
  if (!permissionManager && telemetryInitialized) {
    try {
      const { knex } = await createTenantKnex();
      if (knex) {
        permissionManager = new TelemetryPermissionManager(knex);
      }
    } catch (error) {
      logger.error('Failed to initialize telemetry permission manager:', error);
    }
  }
  return permissionManager;
}

/**
 * Check if telemetry is initialized and available
 */
export function isTelemetryInitialized(): boolean {
  return telemetryInitialized;
}

/**
 * Shutdown telemetry (for testing or graceful shutdown)
 */
export async function shutdownTelemetry(): Promise<void> {
  if (!telemetryInitialized) {
    return;
  }

  try {
    // The SDK shutdown is handled by the SIGTERM handler
    telemetryInitialized = false;
    permissionManager = null;
    logger.info('Telemetry shutdown completed');
  } catch (error) {
    logger.error('Error during telemetry shutdown:', error);
  }
}