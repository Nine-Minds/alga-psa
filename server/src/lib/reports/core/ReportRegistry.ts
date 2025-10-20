// Report Registry for managing report definitions

import { ReportDefinition, ReportRegistry as IReportRegistry, ReportValidationError } from './types';

// Import report definitions
import { billingOverviewReport } from '../definitions/billing/overview';
import {
  contractRevenueReport,
  contractExpirationReport,
  contractBucketUsageReport,
  contractProfitabilityReport
} from '../definitions/contracts';

export class ReportRegistry {
  private static registry: IReportRegistry = {};
  private static initialized = false;
  
  /**
   * Initialize the report registry with all available reports
   */
  static initialize(): void {
    if (this.initialized) {
      return;
    }

    // Register billing reports
    this.register(billingOverviewReport);

    // Register contract reports
    this.register(contractRevenueReport);
    this.register(contractExpirationReport);
    this.register(contractBucketUsageReport);
    this.register(contractProfitabilityReport);

    // TODO: Register other report categories as they're implemented
    // this.register(operationsReports);
    // this.register(financialReports);

    this.initialized = true;
    console.log(`Report registry initialized with ${Object.keys(this.registry).length} reports`);
  }
  
  /**
   * Register a report definition
   */
  static register(definition: ReportDefinition): void {
    this.validateDefinition(definition);
    this.registry[definition.id] = definition;
  }
  
  /**
   * Get a report definition by ID
   */
  static get(reportId: string): ReportDefinition | null {
    this.initialize(); // Ensure registry is initialized
    return this.registry[reportId] || null;
  }
  
  /**
   * Get all report definitions
   */
  static getAll(): IReportRegistry {
    this.initialize(); // Ensure registry is initialized
    return { ...this.registry };
  }
  
  /**
   * Get report definitions by category
   */
  static getByCategory(category: string): ReportDefinition[] {
    this.initialize(); // Ensure registry is initialized
    return Object.values(this.registry).filter(report => report.category === category);
  }
  
  /**
   * Check if a report exists
   */
  static exists(reportId: string): boolean {
    this.initialize(); // Ensure registry is initialized
    return reportId in this.registry;
  }
  
  /**
   * List all available report IDs
   */
  static listReportIds(): string[] {
    this.initialize(); // Ensure registry is initialized
    return Object.keys(this.registry);
  }
  
  /**
   * Validate a report definition
   */
  private static validateDefinition(definition: ReportDefinition): void {
    if (!definition.id) {
      throw new ReportValidationError('Report definition must have an ID');
    }
    
    if (!definition.name) {
      throw new ReportValidationError('Report definition must have a name', definition.id);
    }
    
    if (!definition.category) {
      throw new ReportValidationError('Report definition must have a category', definition.id);
    }
    
    if (!definition.version) {
      throw new ReportValidationError('Report definition must have a version', definition.id);
    }
    
    if (!definition.metrics || definition.metrics.length === 0) {
      throw new ReportValidationError('Report definition must have at least one metric', definition.id);
    }
    
    // Validate metrics
    for (const metric of definition.metrics) {
      if (!metric.id) {
        throw new ReportValidationError(`Metric must have an ID`, definition.id);
      }
      
      if (!metric.name) {
        throw new ReportValidationError(`Metric ${metric.id} must have a name`, definition.id);
      }
      
      if (!metric.type) {
        throw new ReportValidationError(`Metric ${metric.id} must have a type`, definition.id);
      }
      
      if (!metric.query) {
        throw new ReportValidationError(`Metric ${metric.id} must have a query`, definition.id);
      }
      
      if (!metric.query.table) {
        throw new ReportValidationError(`Metric ${metric.id} query must specify a table`, definition.id);
      }
    }
    
    // Check for duplicate report ID
    if (this.registry[definition.id]) {
      throw new ReportValidationError(`Report with ID ${definition.id} already exists`);
    }
    
    // Validate permissions
    if (!definition.permissions) {
      throw new ReportValidationError('Report definition must specify permissions', definition.id);
    }
    
    if (!definition.permissions.roles || definition.permissions.roles.length === 0) {
      throw new ReportValidationError('Report definition must specify required roles', definition.id);
    }
    
    if (!definition.permissions.resources || definition.permissions.resources.length === 0) {
      throw new ReportValidationError('Report definition must specify required resources', definition.id);
    }
  }
}