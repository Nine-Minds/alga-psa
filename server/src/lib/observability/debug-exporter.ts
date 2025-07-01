/**
 * Debug wrapper for OTLP exporters to add detailed logging
 */

import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import logger from '../../utils/logger';

export class DebugOTLPTraceExporter extends OTLPTraceExporter {
  private configUrl: string;
  
  constructor(config: any) {
    super(config);
    this.configUrl = config.url;
    logger.info('DebugOTLPTraceExporter created', { 
      url: config.url, 
      headers: config.headers || {} 
    });
  }

  export(spans: any, resultCallback: any) {
    logger.info('🚀 TRACE EXPORT TRIGGERED!', {
      spanCount: spans.length,
      endpoint: this.configUrl || this.url,
      timestamp: Date.now()
    });
    
    logger.debug('Trace export details', {
      spans: spans.map((span: any) => ({
        name: span.name,
        traceId: span.spanContext?.traceId || 'unknown',
        spanId: span.spanContext?.spanId || 'unknown',
        startTime: span.startTime,
        endTime: span.endTime,
      })),
    });

    // Call parent export method with enhanced error handling
    const wrappedCallback = (result: any) => {
      if (result.code === 0) {
        logger.info('✅ TRACES EXPORTED SUCCESSFULLY!', {
          spanCount: spans.length,
          resultCode: result.code,
          endpoint: this.configUrl || this.url,
          timestamp: Date.now()
        });
      } else {
        logger.error('❌ TRACE EXPORT FAILED!', {
          spanCount: spans.length,
          resultCode: result.code,
          error: result.error?.message || result.error,
          endpoint: this.configUrl || this.url,
          timestamp: Date.now()
        });
      }
      resultCallback(result);
    };

    try {
      super.export(spans, wrappedCallback);
    } catch (error) {
      logger.error('Exception during trace export', {
        error: error.message,
        stack: error.stack,
        spanCount: spans.length,
        timestamp: Date.now()
      });
      resultCallback({ code: 1, error });
    }
  }
}

export class DebugOTLPMetricExporter extends OTLPMetricExporter {
  private configUrl: string;
  
  constructor(config: any) {
    super(config);
    this.configUrl = config.url;
    logger.info('DebugOTLPMetricExporter created', { 
      url: config.url, 
      headers: config.headers || {} 
    });
  }

  export(metrics: any, resultCallback: any) {
    logger.info('Exporting metrics', {
      metricCount: metrics.resourceMetrics?.length || 0,
      endpoint: this.configUrl || this.url,
      timestamp: Date.now()
    });

    // Call parent export method with enhanced error handling
    const wrappedCallback = (result: any) => {
      if (result.code === 0) {
        logger.info('Metrics exported successfully', {
          metricCount: metrics.resourceMetrics?.length || 0,
          resultCode: result.code,
          timestamp: Date.now()
        });
      } else {
        logger.error('Metric export failed', {
          metricCount: metrics.resourceMetrics?.length || 0,
          resultCode: result.code,
          error: result.error,
          endpoint: this.configUrl || this.url,
          timestamp: Date.now()
        });
      }
      resultCallback(result);
    };

    try {
      super.export(metrics, wrappedCallback);
    } catch (error) {
      logger.error('Exception during metric export', {
        error: error.message,
        stack: error.stack,
        metricCount: metrics.resourceMetrics?.length || 0,
        timestamp: Date.now()
      });
      resultCallback({ code: 1, error });
    }
  }
}