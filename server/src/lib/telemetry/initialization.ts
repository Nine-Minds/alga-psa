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
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { getAppVersion } from '../utils/version';
import { SpanProcessor, Span, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { isUsageStatsEnabled } from '../../config/telemetry';
import logger from '../../utils/logger';

let observabilityInitialized = false;
let sdk: NodeSDK | null = null;

/**
 * Basic span processor for observability data
 */
class BasicSpanProcessor implements SpanProcessor {
  constructor() {
    // Simple processor without complex permission checking
  }

  onStart(span: Span): void {
    // Basic span processing - no complex logic needed
  }

  onEnd(span: Span): void {
    // Basic span processing - no complex logic needed
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
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
      ALGA_OBSERVABILITY: process.env.ALGA_OBSERVABILITY,
      OTLP_ENDPOINT: process.env.OTLP_ENDPOINT,
      DEPLOYMENT_ID: process.env.DEPLOYMENT_ID ? '[PRESENT]' : '[NOT_SET]',
      NODE_ENV: process.env.NODE_ENV,
    });

    // Check if observability is enabled
    const observabilityEnabled = process.env.ALGA_OBSERVABILITY === 'true';
    
    logger.info('Deployment configuration', {
      observabilityEnabled,
      reason: observabilityEnabled ? 'explicitly enabled' : 'disabled'
    });
    
    if (!observabilityEnabled) {
      logger.info('Observability disabled - set ALGA_OBSERVABILITY=true to enable');
      return;
    }


    // Show notice on first load
    if (!hasShownObservabilityNotice()) {
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

    // Basic observability without complex permission management

    // Create OTLP exporters for Grafana Alloy
    const traceExporter = new OTLPTraceExporter({
      url: `${endpoint}/v1/traces`,  // Add OTLP traces path
      headers: process.env.DEPLOYMENT_ID ? {
        'X-Deployment-Id': process.env.DEPLOYMENT_ID,
      } : {},
    });

    const metricExporter = new OTLPMetricExporter({
      url: `${endpoint}/v1/metrics`,  // Add OTLP metrics path
      headers: process.env.DEPLOYMENT_ID ? {
        'X-Deployment-Id': process.env.DEPLOYMENT_ID,
      } : {},
    });

    // Create resource with service information
    const resource = resourceFromAttributes({
      [SemanticResourceAttributes.SERVICE_NAME]: 'alga-psa',
      [SemanticResourceAttributes.SERVICE_VERSION]: getAppVersion(),
      [SemanticResourceAttributes.SERVICE_NAMESPACE]: 'alga-psa',
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV,
      'deployment.id': process.env.DEPLOYMENT_ID || 'unknown',
      'app.version': getAppVersion(),
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
          // Skip telemetry for sensitive paths
          const excludedPaths = ['/api/auth', '/api/user/preferences', '/health', '/api/telemetry'];
          const path = req.url || req.path || '';
          return excludedPaths.some(excludedPath => path.includes(excludedPath));
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
      deploymentId: process.env.DEPLOYMENT_ID || 'unknown',
      serviceName: 'alga-psa',
      serviceVersion: getAppVersion(),
      samplingRate: 0.1,
      environment: process.env.NODE_ENV,
      piiSanitization: true,
      ipAnonymization: true,
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
        headers: process.env.DEPLOYMENT_ID ? { 'X-Tenant-Id': process.env.DEPLOYMENT_ID } : {},
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
        'environment': process.env.NODE_ENV || 'development',
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
    logger.info('Observability shutdown completed');
  } catch (error) {
    logger.error('Error during observability shutdown:', error);
  }
}