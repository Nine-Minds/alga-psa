// Core ReportEngine for executing report definitions

import { createTenantKnex } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { 
  ReportDefinition, 
  ReportResult, 
  ReportParameters, 
  MetricDefinition,
  FormattingOptions,
  FormattedMetricValue,
  ReportExecutionError,
  ReportExecutionOptions
} from './types';
import { QueryBuilder } from '../builders/QueryBuilder';

export class ReportEngine {
  
  /**
   * Execute a report definition and return results
   */
  static async execute(
    definition: ReportDefinition,
    parameters: ReportParameters = {},
    options: ReportExecutionOptions = {}
  ): Promise<ReportResult> {
    const startTime = Date.now();
    
    try {
      // TODO: Add permission validation when implemented
      // await this.validateReportAccess(definition.id);
      
      // TODO: Add cache checking when implemented
      // if (!options.skipCache && definition.caching) {
      //   const cached = await ReportCache.get(definition, parameters);
      //   if (cached) {
      //     return cached;
      //   }
      // }
      
      // Get database connection with tenant context
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new ReportExecutionError(
          'Tenant context is required for report execution',
          definition.id
        );
      }
      
      // Add tenant and calculated parameters
      const enrichedParameters = this.enrichParameters(parameters, tenant);
      
      // Execute report within transaction
      const result = await withTransaction(knex, async (trx) => {
        const metrics: Record<string, any> = {};
        
        // Execute each metric calculation
        for (const metric of definition.metrics) {
          try {
            const value = await this.executeMetric(trx, metric, enrichedParameters);
            metrics[metric.id] = this.formatMetricValue(value, metric.formatting);
          } catch (error) {
            console.error(`Error executing metric ${metric.id}:`, error);
            // Continue with other metrics, setting this one to null
            metrics[metric.id] = null;
          }
        }
        
        const executionTime = Date.now() - startTime;
        
        return {
          reportId: definition.id,
          reportName: definition.name,
          executedAt: new Date().toISOString(),
          parameters: enrichedParameters,
          metrics,
          metadata: {
            version: definition.version,
            category: definition.category,
            executionTime,
            cacheHit: false,
            rowCount: undefined // Could be calculated if needed
          }
        } as ReportResult;
      });
      
      // TODO: Cache the result when caching is implemented
      // if (definition.caching) {
      //   await ReportCache.set(definition, parameters, result);
      // }
      
      return result;
      
    } catch (error) {
      const executionTime = Date.now() - startTime;
      console.error(`Report execution failed for ${definition.id} after ${executionTime}ms:`, error);
      
      throw new ReportExecutionError(
        `Failed to execute report ${definition.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        definition.id,
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }
  
  /**
   * Execute a single metric calculation
   */
  private static async executeMetric(
    trx: any,
    metric: MetricDefinition,
    parameters: ReportParameters
  ): Promise<any> {
    
    try {
      // Validate query definition
      QueryBuilder.validateQueryDefinition(metric.query);
      
      // Build and execute the query
      const query = QueryBuilder.build(trx, metric.query, parameters);
      const result = await query;
      
      // Handle different result types
      if (metric.query.aggregation) {
        // For aggregation queries, return the aggregated value
        return result[0]?.[metric.query.aggregation] || 0;
      } else if (result && result.length > 0) {
        // For non-aggregation queries, return the result array or first result
        return metric.query.limit === 1 ? result[0] : result;
      } else {
        // No results
        return metric.query.aggregation ? 0 : [];
      }
      
    } catch (error) {
      throw new ReportExecutionError(
        `Failed to execute metric ${metric.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        undefined,
        metric.id,
        error instanceof Error ? error : undefined
      );
    }
  }
  
  /**
   * Format a metric value according to its formatting options
   */
  private static formatMetricValue(value: any, formatting?: FormattingOptions): any {
    if (!formatting || value === null || value === undefined) {
      return value;
    }
    
    try {
      switch (formatting.type) {
        case 'currency':
          return {
            raw: value,
            formatted: this.formatCurrency(value, formatting),
            type: 'currency'
          } as FormattedMetricValue;
        
        case 'number':
          return {
            raw: value,
            formatted: this.formatNumber(value, formatting),
            type: 'number'
          } as FormattedMetricValue;
        
        case 'percentage':
          return {
            raw: value,
            formatted: this.formatPercentage(value, formatting),
            type: 'percentage'
          } as FormattedMetricValue;
        
        case 'duration':
          return {
            raw: value,
            formatted: this.formatDuration(value, formatting),
            type: 'duration'
          } as FormattedMetricValue;
        
        case 'date':
          return {
            raw: value,
            formatted: this.formatDate(value, formatting),
            type: 'date'
          } as FormattedMetricValue;
        
        default:
          return value;
      }
    } catch (error) {
      console.error(`Error formatting value ${value} with options:`, formatting, error);
      return value; // Return raw value if formatting fails
    }
  }
  
  /**
   * Format a value as currency
   */
  private static formatCurrency(value: number, formatting: FormattingOptions): string {
    const amount = formatting.divisor ? value / formatting.divisor : value;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: formatting.currency || 'USD',
      minimumFractionDigits: formatting.decimals ?? 2,
      maximumFractionDigits: formatting.decimals ?? 2
    }).format(amount);
  }
  
  /**
   * Format a value as a number
   */
  private static formatNumber(value: number, formatting: FormattingOptions): string {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: formatting.decimals || 0,
      maximumFractionDigits: formatting.decimals || 0
    }).format(value);
  }
  
  /**
   * Format a value as a percentage
   */
  private static formatPercentage(value: number, formatting: FormattingOptions): string {
    return new Intl.NumberFormat('en-US', {
      style: 'percent',
      minimumFractionDigits: formatting.decimals || 1,
      maximumFractionDigits: formatting.decimals || 1
    }).format(value);
  }
  
  /**
   * Format a duration value
   */
  private static formatDuration(minutes: number, formatting: FormattingOptions): string {
    if (formatting.unit === 'hours') {
      const hours = minutes / 60;
      return `${hours.toFixed(formatting.decimals || 1)} hours`;
    } else if (formatting.unit === 'days') {
      const days = minutes / (60 * 24);
      return `${days.toFixed(formatting.decimals || 1)} days`;
    }
    return `${minutes} minutes`;
  }
  
  /**
   * Format a date value
   */
  private static formatDate(value: string | Date, formatting: FormattingOptions): string {
    const date = typeof value === 'string' ? new Date(value) : value;
    
    if (formatting.dateFormat) {
      // For now, use toLocaleString with basic options
      // Could be enhanced with a proper date formatting library
      return date.toLocaleString('en-US');
    }
    
    return date.toLocaleDateString('en-US');
  }
  
  /**
   * Enrich parameters with tenant and calculated values
   */
  private static enrichParameters(parameters: ReportParameters, tenant: string): ReportParameters {
    return {
      ...parameters,
      tenant,
      start_of_month: this.getStartOfMonth(),
      end_of_month: this.getEndOfMonth(),
      start_of_year: this.getStartOfYear(),
      end_of_year: this.getEndOfYear(),
      current_date: new Date().toISOString()
    };
  }
  
  /**
   * Get start of current month
   */
  private static getStartOfMonth(): string {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  }
  
  /**
   * Get end of current month (start of next month)
   */
  private static getEndOfMonth(): string {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
  }
  
  /**
   * Get start of current year
   */
  private static getStartOfYear(): string {
    const now = new Date();
    return new Date(now.getFullYear(), 0, 1).toISOString();
  }
  
  /**
   * Get end of current year (start of next year)
   */
  private static getEndOfYear(): string {
    const now = new Date();
    return new Date(now.getFullYear() + 1, 0, 1).toISOString();
  }
}
