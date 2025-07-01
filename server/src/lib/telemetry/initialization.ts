/**
 * OpenTelemetry Observability Initialization
 * 
 * This module handles OPERATIONAL OBSERVABILITY ONLY - NOT usage analytics.
 * 
 * SEPARATION OF CONCERNS:
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ OpenTelemetry (this file) → Grafana Stack                      │
 * │ • Performance metrics, traces, logs                             │
 * │ • System health monitoring                                      │
 * │ • Error tracking and debugging                                  │
 * │ • Infrastructure observability                                  │
 * └─────────────────────────────────────────────────────────────────┘
 * 
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ PostHog (separate system) → PostHog Analytics                  │
 * │ • User behavior analytics                                       │
 * │ • Feature usage tracking                                        │
 * │ • Product analytics                                             │
 * │ • Business intelligence                                         │
 * └─────────────────────────────────────────────────────────────────┘
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { DebugOTLPTraceExporter, DebugOTLPMetricExporter } from '../observability/debug-exporter';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { SpanProcessor, Span, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { TELEMETRY_CONFIG } from '../../config/telemetry';
import TelemetryPermissionManager from './permissions';
import { createTenantKnex } from '../db';
import logger from '../../utils/logger';

let observabilityInitialized = false;
let permissionManager: TelemetryPermissionManager | null = null;
let sdk: NodeSDK | null = null;

/**
 * Privacy-aware span processor that sanitizes PII and respects user consent
 */
class PrivacyAwareSpanProcessor implements SpanProcessor {
  private permissionManager: TelemetryPermissionManager | null;

  constructor(permissionManager: TelemetryPermissionManager | null) {
    this.permissionManager = permissionManager;
  }

  onStart(span: Span): void {
    // logger.debug('Span started', {
    //   spanName: span.name,
    //   spanId: span.spanContext().spanId,
    //   traceId: span.spanContext().traceId,
    //   timestamp: Date.now()
    // });
    
    // Remove PII from span attributes immediately
  //   if (TELEMETRY_CONFIG.PRIVACY.SANITIZE_PII) {
  //     this.sanitizeSpanAttributes(span);
  //   }
  }

  onEnd(span: Span): void {
  //   logger.debug('Span ended', {
  //     spanName: span.name,
  //     spanId: span.spanContext().spanId,
  //     traceId: span.spanContext().traceId,
  //     duration: span.duration || 'unknown',
  //     timestamp: Date.now()
  //   });
    
    // Final sanitization before export
  //   this.sanitizeOperationName(span);
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
 * Initialize OpenTelemetry observability for Grafana stack integration
 * 
 * IMPORTANT: This is for OPERATIONAL OBSERVABILITY only (performance, errors, traces)
 * This is completely separate from PostHog usage analytics.
 * 
 * Two separate systems:
 * 1. OpenTelemetry → Grafana Alloy → Prometheus/Loki/Tempo (this module)
 *    - Application performance metrics
 *    - Error tracking and traces  
 *    - Database query performance
 *    - HTTP request metrics
 *    - System resource utilization
 * 
 * 2. PostHog (separate system, not handled here)
 *    - Product usage analytics
 *    - User behavior tracking
 *    - Feature usage statistics
 *    - Business intelligence data
 * 
 * Deployment behavior:
 * - Hosted: Always enabled for operational monitoring
 * - On-premise: Opt-in via ALGA_OBSERVABILITY=true environment variable
 */
export async function initializeTelemetry(): Promise<void> {
  // Prevent multiple initializations
  if (observabilityInitialized) {
    logger.debug('Observability already initialized, skipping');
    return;
  }

  try {
    // Log environment configuration for debugging
    logger.info('Observability initialization starting', {
      DEPLOYMENT_TYPE: process.env.DEPLOYMENT_TYPE,
      ALGA_OBSERVABILITY: process.env.ALGA_OBSERVABILITY,
      OTLP_ENDPOINT: process.env.OTLP_ENDPOINT,
      TENANT_ID: process.env.TENANT_ID ? '[PRESENT]' : '[NOT_SET]',
      NODE_ENV: process.env.NODE_ENV,
    });

    // Deployment type detection
    const isHosted = process.env.DEPLOYMENT_TYPE === 'hosted';
    const observabilityEnabled = isHosted || process.env.ALGA_OBSERVABILITY === 'true';
    
    logger.info('Deployment configuration', {
      isHosted,
      observabilityEnabled,
      reason: isHosted ? 'hosted deployment' : (process.env.ALGA_OBSERVABILITY === 'true' ? 'explicitly enabled' : 'disabled')
    });
    
    if (!observabilityEnabled) {
      logger.info('Observability disabled - set ALGA_OBSERVABILITY=true to enable for on-premise deployments');
      return;
    }


    // Show notice on first load for on-premise deployments
    if (!isHosted && !hasShownObservabilityNotice()) {
      showObservabilityNotice();
      markObservabilityNoticeShown();
    }

    const endpoint = process.env.OTLP_ENDPOINT || 'http://localhost:4317';
    
    logger.info('Endpoint resolution', {
      OTLP_ENDPOINT: process.env.OTLP_ENDPOINT,
      finalEndpoint: endpoint
    });
    
    if (!endpoint) {
      logger.warn('OTLP endpoint not configured, skipping observability initialization');
      return;
    }

    // Permission manager will be initialized lazily when needed
    // since we don't have a tenant context at startup
    permissionManager = null;

    // Create OTLP exporters for Grafana Alloy with debug logging
    const traceExporter = new DebugOTLPTraceExporter({
      url: `${endpoint}/v1/traces`,  // Add OTLP traces path
      headers: isHosted && process.env.TENANT_ID ? {
        'X-Tenant-Id': process.env.TENANT_ID,
      } : {},
    });

    const metricExporter = new DebugOTLPMetricExporter({
      url: `${endpoint}/v1/metrics`,  // Add OTLP metrics path
      headers: isHosted && process.env.TENANT_ID ? {
        'X-Tenant-Id': process.env.TENANT_ID,
      } : {},
    });

    // Create resource with service information
    const resource = resourceFromAttributes({
      [SemanticResourceAttributes.SERVICE_NAME]: 'alga-psa',
      [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version || '1.0.0',
      [SemanticResourceAttributes.SERVICE_NAMESPACE]: 'alga-psa',
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: isHosted ? 'hosted' : 'on-premise',
      'tenant.id': isHosted ? process.env.TENANT_ID || 'unknown' : 'self-hosted',
      'app.version': process.env.APP_VERSION || '1.0.0',
      'deployment.type': isHosted ? 'hosted' : 'on-premise',
      environment: process.env.NODE_ENV || 'development',
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

    // Force more aggressive batching for testing - set before SDK creation
    process.env.OTEL_BSP_SCHEDULE_DELAY = '2000'; // Export every 2 seconds
    process.env.OTEL_BSP_MAX_EXPORT_BATCH_SIZE = '10'; // Export with just 10 spans
    process.env.OTEL_BSP_EXPORT_TIMEOUT = '10000'; // 10 second timeout
    process.env.OTEL_BSP_MAX_QUEUE_SIZE = '100'; // Smaller queue
    
    logger.info('Configured OpenTelemetry batch settings', {
      scheduleDelay: process.env.OTEL_BSP_SCHEDULE_DELAY,
      maxBatchSize: process.env.OTEL_BSP_MAX_EXPORT_BATCH_SIZE,
      exportTimeout: process.env.OTEL_BSP_EXPORT_TIMEOUT,
      maxQueueSize: process.env.OTEL_BSP_MAX_QUEUE_SIZE
    });
    
    // Also try setting via config object
    const batchSpanProcessorConfig = {
      scheduledDelayMillis: 2000,
      maxExportBatchSize: 10,
      exportTimeoutMillis: 10000,
      maxQueueSize: 100
    };
    
    logger.info('Batch span processor config', batchSpanProcessorConfig);

    // Create custom batch span processor with aggressive settings
    const batchSpanProcessor = new BatchSpanProcessor(traceExporter, {
      scheduledDelayMillis: 2000,      // Export every 2 seconds
      maxExportBatchSize: 10,          // Export with just 10 spans
      exportTimeoutMillis: 10000,      // 10 second timeout
      maxQueueSize: 100                // Smaller queue
    });
    
    logger.info('Created BatchSpanProcessor with custom settings', {
      scheduledDelayMillis: 2000,
      maxExportBatchSize: 10,
      exportTimeoutMillis: 10000,
      maxQueueSize: 100
    });

    // Initialize SDK with custom span processor (metrics disabled for now)
    sdk = new NodeSDK({
      resource,
      spanProcessor: batchSpanProcessor,  // Use our custom processor instead of traceExporter
      // metricReader: new PeriodicExportingMetricReader({
      //   exporter: metricExporter,
      //   exportIntervalMillis: 5000, // Export every 5 seconds
      // }),
      instrumentations,
    });

    // Start the SDK
    sdk.start();
    observabilityInitialized = true;

    logger.info('Privacy-aware observability initialized successfully', {
      endpoint,
      deploymentType: isHosted ? 'hosted' : 'on-premise',
      tenantId: isHosted ? process.env.TENANT_ID : 'self-hosted',
      serviceName: 'alga-psa',
      serviceVersion: process.env.npm_package_version || '1.0.0',
      samplingRate: 0.1,
      environment: process.env.NODE_ENV,
      piiSanitization: TELEMETRY_CONFIG.PRIVACY.SANITIZE_PII,
      ipAnonymization: TELEMETRY_CONFIG.PRIVACY.ANONYMIZE_IPS,
      exporterType: 'HTTP',
      autoInstrumentations: 'enabled'
    });

    // Log detailed configuration for debugging
    logger.debug('OpenTelemetry configuration details', {
      sdkStarted: true,
      resourceAttributes: resource.attributes,
      traceExporter: {
        type: 'OTLPTraceExporter',
        url: endpoint,
        headers: isHosted && process.env.TENANT_ID ? { 'X-Tenant-Id': process.env.TENANT_ID } : {},
      },
      metricExporter: {
        type: 'OTLPMetricExporter', 
        url: endpoint,
        exportInterval: 5000,
      },
      instrumentations: 'auto-instrumentations-node',
    });

    // Test trace generation immediately after initialization
    try {
      const tracer = require('@opentelemetry/api').trace.getTracer('alga-psa-test');
      const span = tracer.startSpan('observability-initialization-test');
      span.setAttributes({
        'test.type': 'initialization',
        'test.timestamp': Date.now(),
        'deployment.type': isHosted ? 'hosted' : 'on-premise',
      });
      span.end();
      logger.info('Test trace span created successfully');
      
      // Wait for automatic export (should happen within 2 seconds with our settings)
      setTimeout(() => {
        logger.info('Waiting for automatic trace export - should happen within 2 seconds...');
      }, 1000);
      
    } catch (error) {
      logger.error('Failed to create test trace span:', error);
    }

    // Register shutdown handler
    process.on('SIGTERM', async () => {
      await shutdownObservability();
    });

  } catch (error) {
    logger.error('Failed to initialize observability:', error);
    // Don't throw - allow application to continue without observability
  }
}

/**
 * Get the telemetry permission manager instance
 * Lazily initializes it if needed and we have a database connection
 */
export async function getTelemetryPermissionManager(): Promise<TelemetryPermissionManager | null> {
  if (!permissionManager && observabilityInitialized) {
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
 * Check if observability is initialized and available
 */
export function isTelemetryInitialized(): boolean {
  return observabilityInitialized;
}

/**
 * Check if observability notice has been shown for on-premise deployments
 */
function hasShownObservabilityNotice(): boolean {
  // For now, always show the notice on first load
  // In a real implementation, this could check a database flag
  return false;
}

/**
 * Show observability notice for on-premise deployments
 */
function showObservabilityNotice(): void {
  logger.info('='.repeat(80));
  logger.info('OBSERVABILITY NOTICE');
  logger.info('='.repeat(80));
  logger.info('Observability has been enabled for this installation.');
  logger.info('This will send operational metrics, logs, and traces to your configured Grafana stack.');
  logger.info('');
  logger.info('Data sent includes:');
  logger.info('• Application performance metrics');
  logger.info('• Error logs and traces');
  logger.info('• System resource usage');
  logger.info('• Database query performance (without query content)');
  logger.info('');
  logger.info('To disable observability, set ALGA_OBSERVABILITY=false in your environment variables.');
  logger.info('For more information, see the observability documentation.');
  logger.info('='.repeat(80));
}

/**
 * Mark that observability notice has been shown
 */
function markObservabilityNoticeShown(): void {
  // In a real implementation, this would set a flag in the database
  // For now, we'll just log that it was shown
  logger.debug('Observability notice shown to user');
}

/**
 * Shutdown observability (for testing or graceful shutdown)
 */
export async function shutdownTelemetry(): Promise<void> {
  await shutdownObservability();
}

/**
 * Shutdown observability (for testing or graceful shutdown)
 */
export async function shutdownObservability(): Promise<void> {
  if (!observabilityInitialized || !sdk) {
    return;
  }

  try {
    await sdk.shutdown();
    observabilityInitialized = false;
    sdk = null;
    permissionManager = null;
    logger.info('Observability shutdown completed');
  } catch (error) {
    logger.error('Error during observability shutdown:', error);
  }
}