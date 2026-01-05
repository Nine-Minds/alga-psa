/**
 * Platform Report Service for cross-tenant reporting.
 *
 * This service extends the existing ReportEngine capabilities to support:
 * - Cross-tenant queries using admin connection
 * - Table/column allowlist validation for security
 * - CRUD operations for custom_reports table
 */

import { Knex } from 'knex';
import { getAdminConnection } from '@alga-psa/shared/db/admin';
import { withTransaction } from '@alga-psa/shared/db';
import { QueryBuilder } from 'server/src/lib/reports/builders/QueryBuilder';
import {
  ReportDefinition,
  ReportResult,
  ReportParameters,
  MetricDefinition,
  QueryDefinition,
  ReportExecutionError,
  ReportPermissionError,
  FormattingOptions,
  FormattedMetricValue,
} from 'server/src/lib/reports/core/types';
import {
  BLOCKED_TABLES,
  isTableAllowed,
  isColumnAllowed,
} from './blocklist';

/**
 * Custom report as stored in the database
 */
export interface CustomReport {
  tenant: string;
  report_id: string;
  name: string;
  description: string | null;
  category: string | null;
  report_definition: ReportDefinition;
  platform_access: boolean;
  display_config: Record<string, unknown> | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  is_active: boolean;
}

/**
 * Input for creating a new custom report
 */
export interface CreateReportInput {
  name: string;
  description?: string;
  category?: string;
  report_definition: ReportDefinition;
  platform_access?: boolean;
  display_config?: Record<string, unknown>;
}

/**
 * Input for updating an existing custom report
 */
export interface UpdateReportInput {
  name?: string;
  description?: string;
  category?: string;
  report_definition?: ReportDefinition;
  platform_access?: boolean;
  display_config?: Record<string, unknown>;
  is_active?: boolean;
}

export class PlatformReportService {
  private masterTenantId: string;

  constructor(masterTenantId: string) {
    this.masterTenantId = masterTenantId;
  }

  /**
   * List all custom reports for the master tenant
   */
  async listReports(options?: { category?: string; activeOnly?: boolean }): Promise<CustomReport[]> {
    const knex = await getAdminConnection();

    let query = knex('custom_reports')
      .where('tenant', this.masterTenantId)
      .select('*');

    if (options?.category) {
      query = query.where('category', options.category);
    }

    if (options?.activeOnly !== false) {
      query = query.where('is_active', true);
    }

    const rows = await query.orderBy('name');

    return rows.map(row => ({
      ...row,
      report_definition: typeof row.report_definition === 'string'
        ? JSON.parse(row.report_definition)
        : row.report_definition,
      display_config: row.display_config
        ? (typeof row.display_config === 'string' ? JSON.parse(row.display_config) : row.display_config)
        : null,
    }));
  }

  /**
   * Get a single custom report by ID
   */
  async getReport(reportId: string): Promise<CustomReport | null> {
    const knex = await getAdminConnection();

    const row = await knex('custom_reports')
      .where({
        tenant: this.masterTenantId,
        report_id: reportId,
      })
      .first();

    if (!row) return null;

    return {
      ...row,
      report_definition: typeof row.report_definition === 'string'
        ? JSON.parse(row.report_definition)
        : row.report_definition,
      display_config: row.display_config
        ? (typeof row.display_config === 'string' ? JSON.parse(row.display_config) : row.display_config)
        : null,
    };
  }

  /**
   * Create a new custom report
   */
  async createReport(input: CreateReportInput, createdBy?: string): Promise<CustomReport> {
    // Validate the report definition against allowlist
    this.validateReportDefinition(input.report_definition);

    const knex = await getAdminConnection();

    const [row] = await knex('custom_reports')
      .insert({
        tenant: this.masterTenantId,
        name: input.name,
        description: input.description || null,
        category: input.category || null,
        report_definition: JSON.stringify(input.report_definition),
        platform_access: input.platform_access ?? true,
        display_config: input.display_config ? JSON.stringify(input.display_config) : null,
        created_by: createdBy || null,
      })
      .returning('*');

    return {
      ...row,
      report_definition: input.report_definition,
      display_config: input.display_config || null,
    };
  }

  /**
   * Update an existing custom report
   */
  async updateReport(reportId: string, input: UpdateReportInput): Promise<CustomReport | null> {
    // If updating report definition, validate it
    if (input.report_definition) {
      this.validateReportDefinition(input.report_definition);
    }

    const knex = await getAdminConnection();

    const updateData: Record<string, unknown> = {
      updated_at: new Date(),
    };

    if (input.name !== undefined) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.category !== undefined) updateData.category = input.category;
    if (input.report_definition !== undefined) {
      updateData.report_definition = JSON.stringify(input.report_definition);
    }
    if (input.platform_access !== undefined) updateData.platform_access = input.platform_access;
    if (input.display_config !== undefined) {
      updateData.display_config = JSON.stringify(input.display_config);
    }
    if (input.is_active !== undefined) updateData.is_active = input.is_active;

    const [row] = await knex('custom_reports')
      .where({
        tenant: this.masterTenantId,
        report_id: reportId,
      })
      .update(updateData)
      .returning('*');

    if (!row) return null;

    return {
      ...row,
      report_definition: typeof row.report_definition === 'string'
        ? JSON.parse(row.report_definition)
        : row.report_definition,
      display_config: row.display_config
        ? (typeof row.display_config === 'string' ? JSON.parse(row.display_config) : row.display_config)
        : null,
    };
  }

  /**
   * Delete a custom report (soft delete by setting is_active = false)
   */
  async deleteReport(reportId: string): Promise<boolean> {
    const knex = await getAdminConnection();

    const count = await knex('custom_reports')
      .where({
        tenant: this.masterTenantId,
        report_id: reportId,
      })
      .update({
        is_active: false,
        updated_at: new Date(),
      });

    return count > 0;
  }

  /**
   * Execute a custom report and return results
   */
  async executeReport(
    reportId: string,
    parameters: ReportParameters = {}
  ): Promise<ReportResult> {
    const startTime = Date.now();

    // Get the report definition
    const report = await this.getReport(reportId);
    if (!report) {
      throw new ReportExecutionError(`Report not found: ${reportId}`, reportId);
    }

    if (!report.is_active) {
      throw new ReportExecutionError(`Report is inactive: ${reportId}`, reportId);
    }

    const definition = report.report_definition;

    // Validate the report definition against allowlist (in case it was modified)
    this.validateReportDefinition(definition);

    // Get admin connection for cross-tenant queries
    const knex = await getAdminConnection();

    // Enrich parameters (no tenant restriction for platform reports)
    const enrichedParameters = this.enrichParameters(parameters);

    // Execute report within transaction
    const result = await withTransaction(knex, async (trx) => {
      const metrics: Record<string, unknown> = {};

      // Execute each metric calculation
      for (const metric of definition.metrics) {
        try {
          const value = await this.executeMetric(trx, metric, enrichedParameters);
          metrics[metric.id] = this.formatMetricValue(value, metric.formatting);
        } catch (error) {
          console.error(`Error executing metric ${metric.id}:`, error);
          // Return error details so user can debug their query
          metrics[metric.id] = {
            error: true,
            message: error instanceof Error ? error.message : 'Unknown error',
            metricName: metric.name,
          };
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
        },
      } as ReportResult;
    });

    return result;
  }

  /**
   * Execute a single metric calculation
   */
  private async executeMetric(
    trx: Knex.Transaction,
    metric: MetricDefinition,
    parameters: ReportParameters
  ): Promise<unknown> {
    try {
      // Validate query definition against allowlist
      this.validateQueryDefinition(metric.query);

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
   * Validate a report definition against the security allowlist
   */
  private validateReportDefinition(definition: ReportDefinition): void {
    for (const metric of definition.metrics) {
      this.validateQueryDefinition(metric.query);
    }
  }

  /**
   * Validate a query definition against the security blocklist.
   * Uses blocklist approach: everything allowed except explicitly blocked.
   */
  private validateQueryDefinition(query: QueryDefinition): void {
    const table = query.table;

    // Handle raw SQL mode - validate the SQL for blocked tables
    if (table === 'raw_sql') {
      const rawSql = query.fields?.[0];
      if (!rawSql || typeof rawSql !== 'string') {
        throw new ReportPermissionError('Raw SQL mode requires SQL query in fields[0]');
      }

      // Only allow SELECT statements
      const trimmedSql = rawSql.trim().toLowerCase();
      if (!trimmedSql.startsWith('select')) {
        throw new ReportPermissionError('Raw SQL mode only allows SELECT statements');
      }

      // Extract table names from SQL and validate them
      // Match: FROM table_name, JOIN table_name, table_name.column
      const tableMatches = rawSql.matchAll(/(?:from|join)\s+([a-z_][a-z0-9_]*)/gi);
      for (const match of tableMatches) {
        const tableName = match[1].toLowerCase();
        if (!isTableAllowed(tableName)) {
          throw new ReportPermissionError(
            `Table '${tableName}' is blocked for platform reports`
          );
        }
      }

      // Check for blocked columns in SELECT clause and WHERE conditions
      for (const blockedTable of BLOCKED_TABLES) {
        if (rawSql.toLowerCase().includes(blockedTable.toLowerCase())) {
          throw new ReportPermissionError(
            `Reference to blocked table '${blockedTable}' detected in SQL`
          );
        }
      }

      return; // Skip normal validation for raw SQL
    }

    // Check table is not blocked
    if (!isTableAllowed(table)) {
      throw new ReportPermissionError(
        `Table '${table}' is blocked for platform reports`
      );
    }

    // Validate all fields against column blocklist
    for (const field of query.fields ?? []) {
      // Handle table.column format
      const fieldParts = field.split('.');
      const fieldTable = fieldParts.length > 1 ? fieldParts[0] : table;
      const columnName = fieldParts.length > 1 ? fieldParts[1] : field;

      // Skip SQL expressions (contain spaces, parentheses, or common SQL keywords)
      if (
        columnName.includes(' ') ||
        columnName.includes('(') ||
        columnName.includes('*') ||
        columnName.toLowerCase().includes('count') ||
        columnName.toLowerCase().includes('sum') ||
        columnName.toLowerCase().includes('avg')
      ) {
        continue;
      }

      // Validate the field's table is allowed (if different from main table)
      if (fieldTable !== table && !isTableAllowed(fieldTable)) {
        throw new ReportPermissionError(
          `Field references blocked table '${fieldTable}'`
        );
      }

      if (!isColumnAllowed(fieldTable, columnName)) {
        throw new ReportPermissionError(
          `Column '${columnName}' is blocked for security reasons`
        );
      }
    }

    // Validate join tables
    for (const join of query.joins ?? []) {
      if (!isTableAllowed(join.table)) {
        throw new ReportPermissionError(
          `Join table '${join.table}' is blocked for platform reports`
        );
      }
    }

    // Validate filter fields don't reference blocked columns
    for (const filter of query.filters ?? []) {
      const fieldParts = filter.field.split('.');
      const filterTable = fieldParts.length > 1 ? fieldParts[0] : table;
      const filterColumn = fieldParts.length > 1 ? fieldParts[1] : filter.field;

      if (!isTableAllowed(filterTable)) {
        throw new ReportPermissionError(
          `Filter references blocked table '${filterTable}'`
        );
      }

      if (!isColumnAllowed(filterTable, filterColumn)) {
        throw new ReportPermissionError(
          `Filter references blocked column '${filterColumn}'`
        );
      }
    }
  }

  /**
   * Enrich parameters with calculated date values
   */
  private enrichParameters(parameters: ReportParameters): ReportParameters {
    return {
      ...parameters,
      start_of_month: this.getStartOfMonth(),
      end_of_month: this.getEndOfMonth(),
      start_of_year: this.getStartOfYear(),
      end_of_year: this.getEndOfYear(),
      current_date: new Date().toISOString(),
    };
  }

  /**
   * Format a metric value according to its formatting options
   */
  private formatMetricValue(value: unknown, formatting?: FormattingOptions): unknown {
    if (!formatting || value === null || value === undefined) {
      return value;
    }

    try {
      switch (formatting.type) {
        case 'currency':
          return {
            raw: value,
            formatted: this.formatCurrency(value as number, formatting),
            type: 'currency',
          } as FormattedMetricValue;

        case 'number':
          return {
            raw: value,
            formatted: this.formatNumber(value as number, formatting),
            type: 'number',
          } as FormattedMetricValue;

        case 'percentage':
          return {
            raw: value,
            formatted: this.formatPercentage(value as number, formatting),
            type: 'percentage',
          } as FormattedMetricValue;

        case 'duration':
          return {
            raw: value,
            formatted: this.formatDuration(value as number, formatting),
            type: 'duration',
          } as FormattedMetricValue;

        case 'date':
          return {
            raw: value,
            formatted: this.formatDate(value as string | Date, formatting),
            type: 'date',
          } as FormattedMetricValue;

        default:
          return value;
      }
    } catch {
      return value;
    }
  }

  private formatCurrency(value: number, formatting: FormattingOptions): string {
    const amount = formatting.divisor ? value / formatting.divisor : value;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: formatting.currency || 'USD',
      minimumFractionDigits: formatting.decimals ?? 2,
      maximumFractionDigits: formatting.decimals ?? 2,
    }).format(amount);
  }

  private formatNumber(value: number, formatting: FormattingOptions): string {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: formatting.decimals || 0,
      maximumFractionDigits: formatting.decimals || 0,
    }).format(value);
  }

  private formatPercentage(value: number, formatting: FormattingOptions): string {
    return new Intl.NumberFormat('en-US', {
      style: 'percent',
      minimumFractionDigits: formatting.decimals || 1,
      maximumFractionDigits: formatting.decimals || 1,
    }).format(value);
  }

  private formatDuration(minutes: number, formatting: FormattingOptions): string {
    if (formatting.unit === 'hours') {
      const hours = minutes / 60;
      return `${hours.toFixed(formatting.decimals || 1)} hours`;
    } else if (formatting.unit === 'days') {
      const days = minutes / (60 * 24);
      return `${days.toFixed(formatting.decimals || 1)} days`;
    }
    return `${minutes} minutes`;
  }

  private formatDate(value: string | Date, formatting: FormattingOptions): string {
    const date = typeof value === 'string' ? new Date(value) : value;
    if (formatting.dateFormat) {
      return date.toLocaleString('en-US');
    }
    return date.toLocaleDateString('en-US');
  }

  private getStartOfMonth(): string {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  }

  private getEndOfMonth(): string {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
  }

  private getStartOfYear(): string {
    const now = new Date();
    return new Date(now.getFullYear(), 0, 1).toISOString();
  }

  private getEndOfYear(): string {
    const now = new Date();
    return new Date(now.getFullYear() + 1, 0, 1).toISOString();
  }
}
