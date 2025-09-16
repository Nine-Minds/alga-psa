/**
 * Observability Initialization Module
 * 
 * This module handles initialization for the simplified observability system.
 * It provides a clean interface for operational monitoring without complex telemetry.
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import logger from './simple-logger';
import { getAppVersion } from '../utils/version';

let observabilityInitialized = false;
let sdk: NodeSDK | null = null;

/**
 * Initialize OpenTelemetry observability for operational monitoring
 * 
 * This is for OPERATIONAL OBSERVABILITY only (performance, errors, traces)
 * Completely separate from PostHog usage analytics.
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
    
    if (!observabilityEnabled) {
      logger.info('Observability disabled - set ALGA_OBSERVABILITY=true to enable');
      return;
    }

    const endpoint = process.env.OTLP_ENDPOINT || 'http://localhost:4317';
    
    if (!endpoint) {
      logger.warn('OTLP endpoint not configured, skipping observability initialization');
      return;
    }

    // Create OTLP exporters with deployment ID headers
    const traceExporter = new OTLPTraceExporter({
      url: `${endpoint}/v1/traces`,
      headers: process.env.DEPLOYMENT_ID ? {
        'X-Deployment-Id': process.env.DEPLOYMENT_ID,
      } : {},
    });

    const metricExporter = new OTLPMetricExporter({
      url: `${endpoint}/v1/metrics`,
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
      environment: process.env.NODE_ENV || 'development',
    });

    // Configure instrumentations
    const instrumentations = getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { 
        enabled: false // Disable file system instrumentation
      },
      '@opentelemetry/instrumentation-pg': {
        enabled: true,
        enhancedDatabaseReporting: false
      },
      '@opentelemetry/instrumentation-http': {
        enabled: true,
        ignoreIncomingRequestHook: (req: any) => {
          const excludedPaths = ['/api/auth', '/api/user/preferences', '/health'];
          const path = req.url || req.path || '';
          return excludedPaths.some(excludedPath => path.includes(excludedPath));
        }
      }
    });

    // Create custom batch span processor
    const batchSpanProcessor = new BatchSpanProcessor(traceExporter, {
      scheduledDelayMillis: 5000,
      maxExportBatchSize: 50,
      exportTimeoutMillis: 30000,
      maxQueueSize: 2048
    });

    // Initialize SDK
    sdk = new NodeSDK({
      resource,
      spanProcessor: batchSpanProcessor,
      metricReader: new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: 10000, // Export every 10 seconds
      }),
      instrumentations,
    });

    // Start the SDK
    sdk.start();
    observabilityInitialized = true;

    logger.info('Observability initialized successfully', {
      endpoint,
      serviceName: 'alga-psa',
      environment: process.env.NODE_ENV,
    });

    // Register shutdown handler
    process.on('SIGTERM', async () => {
      await shutdownTelemetry();
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
 * Shutdown observability (for testing or graceful shutdown)
 */
export async function shutdownTelemetry(): Promise<void> {
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

// Alternative exports for compatibility
export const initializeObservability = initializeTelemetry;
export const isObservabilityInitialized = isTelemetryInitialized;
export const shutdownObservability = shutdownTelemetry;