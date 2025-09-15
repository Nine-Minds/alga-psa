import { Knex } from 'knex';
import { IService, IServiceDependency, IServiceLevelAgreement } from '../../interfaces/service.interfaces';

export class ServiceCatalogService {
  constructor(private knex: Knex) {}

  /**
   * Create a new service in the catalog
   */
  async createService(serviceData: Omit<IService, 'service_id' | 'created_date'>): Promise<string> {
    try {
      const [service] = await this.knex('services').insert({
        ...serviceData,
        created_date: new Date()
      }).returning('service_id');

      // Create initial service dependencies if provided
      if (serviceData.depends_on_services && serviceData.depends_on_services.length > 0) {
        await this.createServiceDependencies(service.service_id, serviceData.depends_on_services);
      }

      // Log service creation
      await this.logServiceEvent({
        service_id: service.service_id,
        event_type: 'service_created',
        details: {
          service_name: serviceData.service_name,
          service_category: serviceData.service_category,
          service_owner: serviceData.service_owner
        },
        performed_by: serviceData.created_by
      });

      return service.service_id;
    } catch (error) {
      console.error('Error creating service:', error);
      throw error;
    }
  }

  /**
   * Get service catalog with filtering and sorting
   */
  async getServiceCatalog(
    tenant: string,
    filters?: {
      status?: string[];
      category?: string[];
      type?: string[];
      owner?: string;
      search?: string;
    },
    pagination?: {
      page: number;
      limit: number;
    }
  ): Promise<{
    services: IService[];
    total: number;
    totalPages: number;
  }> {
    try {
      let query = this.knex('services')
        .where('tenant', tenant);

      // Apply filters
      if (filters?.status && filters.status.length > 0) {
        query = query.whereIn('status', filters.status);
      }

      if (filters?.category && filters.category.length > 0) {
        query = query.whereIn('service_category', filters.category);
      }

      if (filters?.type && filters.type.length > 0) {
        query = query.whereIn('service_type', filters.type);
      }

      if (filters?.owner) {
        query = query.where(function() {
          this.where('service_owner', filters.owner)
            .orWhere('technical_owner', filters.owner)
            .orWhere('business_owner', filters.owner);
        });
      }

      if (filters?.search) {
        query = query.where(function() {
          this.where('service_name', 'ilike', `%${filters.search}%`)
            .orWhere('description', 'ilike', `%${filters.search}%`)
            .orWhere('service_code', 'ilike', `%${filters.search}%`);
        });
      }

      // Get total count
      const totalResult = await query.clone().count('* as total').first();
      const total = parseInt(totalResult?.total as string) || 0;

      // Apply pagination
      if (pagination) {
        const offset = (pagination.page - 1) * pagination.limit;
        query = query.offset(offset).limit(pagination.limit);
      }

      // Execute query with sorting
      const services = await query
        .orderBy('service_name', 'asc')
        .select('*');

      const totalPages = pagination ? Math.ceil(total / pagination.limit) : 1;

      return {
        services,
        total,
        totalPages
      };
    } catch (error) {
      console.error('Error getting service catalog:', error);
      throw error;
    }
  }

  /**
   * Get service details with dependencies and SLAs
   */
  async getServiceDetails(serviceId: string): Promise<{
    service: IService;
    dependencies: IServiceDependency[];
    dependents: IServiceDependency[];
    slas: IServiceLevelAgreement[];
    performanceMetrics?: any;
  }> {
    try {
      const service = await this.knex('services')
        .where('service_id', serviceId)
        .first();

      if (!service) {
        throw new Error('Service not found');
      }

      // Get service dependencies (services this service depends on)
      const dependencies = await this.knex('service_dependencies')
        .join('services as dep_service', 'service_dependencies.depends_on_service_id', 'dep_service.service_id')
        .where('service_dependencies.service_id', serviceId)
        .select(
          'service_dependencies.*',
          'dep_service.service_name as dependency_name',
          'dep_service.status as dependency_status'
        );

      // Get dependents (services that depend on this service)
      const dependents = await this.knex('service_dependencies')
        .join('services as dependent_service', 'service_dependencies.service_id', 'dependent_service.service_id')
        .where('service_dependencies.depends_on_service_id', serviceId)
        .select(
          'service_dependencies.*',
          'dependent_service.service_name as dependent_name',
          'dependent_service.status as dependent_status'
        );

      // Get active SLAs for this service
      const slas = await this.knex('service_level_agreements')
        .where('service_id', serviceId)
        .where('status', 'active')
        .select('*');

      // Get recent performance metrics
      const performanceMetrics = await this.getServicePerformanceSummary(serviceId);

      return {
        service,
        dependencies,
        dependents,
        slas,
        performanceMetrics
      };
    } catch (error) {
      console.error('Error getting service details:', error);
      throw error;
    }
  }

  /**
   * Update service information
   */
  async updateService(
    serviceId: string,
    updateData: Partial<IService>,
    updatedBy: string
  ): Promise<void> {
    try {
      const existingService = await this.knex('services')
        .where('service_id', serviceId)
        .first();

      if (!existingService) {
        throw new Error('Service not found');
      }

      await this.knex('services')
        .where('service_id', serviceId)
        .update({
          ...updateData,
          updated_date: new Date(),
          updated_by: updatedBy
        });

      // Log service update
      await this.logServiceEvent({
        service_id: serviceId,
        event_type: 'service_updated',
        details: {
          updated_fields: Object.keys(updateData),
          previous_values: this.extractFields(existingService, Object.keys(updateData))
        },
        performed_by: updatedBy
      });

      // Update dependencies if provided
      if (updateData.depends_on_services) {
        await this.updateServiceDependencies(serviceId, updateData.depends_on_services);
      }
    } catch (error) {
      console.error('Error updating service:', error);
      throw error;
    }
  }

  /**
   * Retire a service
   */
  async retireService(
    serviceId: string,
    retirementReason: string,
    retiredBy: string
  ): Promise<void> {
    try {
      // Check for active dependencies
      const activeDependents = await this.knex('service_dependencies')
        .join('services', 'service_dependencies.service_id', 'services.service_id')
        .where('service_dependencies.depends_on_service_id', serviceId)
        .where('services.status', '!=', 'retired')
        .select('services.service_name');

      if (activeDependents.length > 0) {
        const dependentNames = activeDependents.map(d => d.service_name).join(', ');
        throw new Error(`Cannot retire service. Active services depend on it: ${dependentNames}`);
      }

      // Check for active SLAs
      const activeSlas = await this.knex('service_level_agreements')
        .where('service_id', serviceId)
        .where('status', 'active')
        .count('* as count')
        .first();

      if (parseInt(activeSlas?.count as string) > 0) {
        throw new Error('Cannot retire service with active SLAs. Please expire all SLAs first.');
      }

      // Retire the service
      await this.knex('services')
        .where('service_id', serviceId)
        .update({
          status: 'retired',
          retired_date: new Date(),
          retired_reason: retirementReason,
          updated_date: new Date(),
          updated_by: retiredBy
        });

      // Log service retirement
      await this.logServiceEvent({
        service_id: serviceId,
        event_type: 'service_retired',
        details: {
          retirement_reason: retirementReason
        },
        performed_by: retiredBy
      });
    } catch (error) {
      console.error('Error retiring service:', error);
      throw error;
    }
  }

  /**
   * Create service dependencies
   */
  async createServiceDependencies(
    serviceId: string,
    dependsOnServiceIds: string[]
  ): Promise<void> {
    try {
      // Remove existing dependencies
      await this.knex('service_dependencies')
        .where('service_id', serviceId)
        .del();

      // Add new dependencies
      if (dependsOnServiceIds.length > 0) {
        const dependencies = dependsOnServiceIds.map(depId => ({
          dependency_id: this.knex.raw('uuid_generate_v4()'),
          tenant: this.knex('services').where('service_id', serviceId).select('tenant').first(),
          service_id: serviceId,
          depends_on_service_id: depId,
          dependency_type: 'operational',
          impact_level: 'medium',
          created_date: new Date(),
          created_by: 'system'
        }));

        await this.knex('service_dependencies').insert(dependencies);
      }
    } catch (error) {
      console.error('Error creating service dependencies:', error);
      throw error;
    }
  }

  /**
   * Update service dependencies
   */
  async updateServiceDependencies(
    serviceId: string,
    dependsOnServiceIds: string[]
  ): Promise<void> {
    try {
      await this.createServiceDependencies(serviceId, dependsOnServiceIds);

      // Log dependency update
      await this.logServiceEvent({
        service_id: serviceId,
        event_type: 'dependencies_updated',
        details: {
          new_dependencies: dependsOnServiceIds
        },
        performed_by: 'system'
      });
    } catch (error) {
      console.error('Error updating service dependencies:', error);
      throw error;
    }
  }

  /**
   * Get service dependency map for visualization
   */
  async getServiceDependencyMap(tenant: string): Promise<{
    services: Array<{
      id: string;
      name: string;
      category: string;
      status: string;
      type: string;
    }>;
    dependencies: Array<{
      source: string;
      target: string;
      type: string;
      impact: string;
    }>;
  }> {
    try {
      // Get all active services
      const services = await this.knex('services')
        .where('tenant', tenant)
        .where('status', '!=', 'retired')
        .select('service_id', 'service_name', 'service_category', 'status', 'service_type');

      // Get all dependencies
      const dependencies = await this.knex('service_dependencies')
        .where('tenant', tenant)
        .select('service_id', 'depends_on_service_id', 'dependency_type', 'impact_level');

      return {
        services: services.map(s => ({
          id: s.service_id,
          name: s.service_name,
          category: s.service_category,
          status: s.status,
          type: s.service_type
        })),
        dependencies: dependencies.map(d => ({
          source: d.service_id,
          target: d.depends_on_service_id,
          type: d.dependency_type,
          impact: d.impact_level
        }))
      };
    } catch (error) {
      console.error('Error getting service dependency map:', error);
      throw error;
    }
  }

  /**
   * Search services by various criteria
   */
  async searchServices(
    tenant: string,
    searchTerm: string,
    options?: {
      includeRetired?: boolean;
      categories?: string[];
      types?: string[];
    }
  ): Promise<IService[]> {
    try {
      let query = this.knex('services')
        .where('tenant', tenant);

      if (!options?.includeRetired) {
        query = query.where('status', '!=', 'retired');
      }

      if (options?.categories && options.categories.length > 0) {
        query = query.whereIn('service_category', options.categories);
      }

      if (options?.types && options.types.length > 0) {
        query = query.whereIn('service_type', options.types);
      }

      // Full-text search across multiple fields
      query = query.where(function() {
        this.where('service_name', 'ilike', `%${searchTerm}%`)
          .orWhere('description', 'ilike', `%${searchTerm}%`)
          .orWhere('service_code', 'ilike', `%${searchTerm}%`)
          .orWhere('business_value', 'ilike', `%${searchTerm}%`);
      });

      return await query
        .orderBy('service_name', 'asc')
        .select('*');
    } catch (error) {
      console.error('Error searching services:', error);
      throw error;
    }
  }

  /**
   * Get service performance summary
   */
  async getServicePerformanceSummary(serviceId: string): Promise<any> {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const performanceData = await this.knex('service_performance_records')
        .where('service_id', serviceId)
        .where('measurement_date', '>=', thirtyDaysAgo)
        .select('*')
        .orderBy('measurement_date', 'desc');

      if (performanceData.length === 0) {
        return null;
      }

      // Calculate summary metrics
      const latestRecord = performanceData[0];
      const avgAvailability = performanceData.reduce((sum, record) => 
        sum + (record.availability_percentage || 0), 0) / performanceData.length;
      const avgResponseTime = performanceData.reduce((sum, record) => 
        sum + (record.avg_response_time || 0), 0) / performanceData.length;
      const totalIncidents = performanceData.reduce((sum, record) => 
        sum + (record.total_incidents || 0), 0);
      const avgCSAT = performanceData
        .filter(record => record.csat_score)
        .reduce((sum, record, _, filtered) => 
          sum + (record.csat_score / filtered.length), 0);

      return {
        current: {
          availability: latestRecord.availability_percentage,
          responseTime: latestRecord.avg_response_time,
          csatScore: latestRecord.csat_score,
          incidentCount: latestRecord.total_incidents
        },
        thirtyDayAverage: {
          availability: Math.round(avgAvailability * 100) / 100,
          responseTime: Math.round(avgResponseTime * 100) / 100,
          csatScore: Math.round(avgCSAT * 100) / 100,
          incidentCount: Math.round(totalIncidents / 30 * 100) / 100
        },
        trend: this.calculateTrend(performanceData)
      };
    } catch (error) {
      console.error('Error getting service performance summary:', error);
      return null;
    }
  }

  /**
   * Get services by category for dashboard
   */
  async getServicesByCategory(tenant: string): Promise<{
    [category: string]: {
      total: number;
      live: number;
      design: number;
      transition: number;
      retired: number;
    };
  }> {
    try {
      const services = await this.knex('services')
        .where('tenant', tenant)
        .select('service_category', 'status')
        .groupBy('service_category', 'status')
        .count('* as count');

      const result: any = {};

      services.forEach(item => {
        const category = item.service_category;
        const status = item.status;
        const count = parseInt(item.count as string);

        if (!result[category]) {
          result[category] = { total: 0, live: 0, design: 0, transition: 0, retired: 0 };
        }

        result[category][status] = count;
        result[category].total += count;
      });

      return result;
    } catch (error) {
      console.error('Error getting services by category:', error);
      throw error;
    }
  }

  /**
   * Validate service business rules
   */
  async validateServiceRules(serviceData: Partial<IService>): Promise<{
    valid: boolean;
    violations: string[];
  }> {
    const violations: string[] = [];

    try {
      // Check for duplicate service codes within tenant
      if (serviceData.service_code && serviceData.tenant) {
        const existingService = await this.knex('services')
          .where('tenant', serviceData.tenant)
          .where('service_code', serviceData.service_code);

        if (serviceData.service_id) {
          existingService.whereNot('service_id', serviceData.service_id);
        }

        const duplicate = await existingService.first();
        if (duplicate) {
          violations.push(`Service code '${serviceData.service_code}' already exists`);
        }
      }

      // Validate service owners exist
      if (serviceData.service_owner) {
        const ownerExists = await this.checkUserExists(serviceData.service_owner);
        if (!ownerExists) {
          violations.push('Service owner does not exist');
        }
      }

      if (serviceData.technical_owner) {
        const ownerExists = await this.checkUserExists(serviceData.technical_owner);
        if (!ownerExists) {
          violations.push('Technical owner does not exist');
        }
      }

      if (serviceData.business_owner) {
        const ownerExists = await this.checkUserExists(serviceData.business_owner);
        if (!ownerExists) {
          violations.push('Business owner does not exist');
        }
      }

      // Validate dependencies don't create cycles
      if (serviceData.depends_on_services && serviceData.service_id) {
        const wouldCreateCycle = await this.checkDependencyCycles(
          serviceData.service_id,
          serviceData.depends_on_services
        );
        if (wouldCreateCycle) {
          violations.push('Service dependencies would create a circular dependency');
        }
      }

      // Validate availability target
      if (serviceData.availability_target && 
          (serviceData.availability_target < 0 || serviceData.availability_target > 100)) {
        violations.push('Availability target must be between 0 and 100');
      }

      return {
        valid: violations.length === 0,
        violations
      };
    } catch (error) {
      console.error('Error validating service rules:', error);
      return {
        valid: false,
        violations: ['Error occurred during validation']
      };
    }
  }

  /**
   * Helper methods
   */
  private calculateTrend(performanceData: any[]): 'improving' | 'declining' | 'stable' {
    if (performanceData.length < 2) return 'stable';

    const recent = performanceData.slice(0, Math.ceil(performanceData.length / 2));
    const older = performanceData.slice(Math.ceil(performanceData.length / 2));

    const recentAvg = recent.reduce((sum, record) => 
      sum + (record.availability_percentage || 0), 0) / recent.length;
    const olderAvg = older.reduce((sum, record) => 
      sum + (record.availability_percentage || 0), 0) / older.length;

    const threshold = 1; // 1% threshold for determining trend
    if (recentAvg > olderAvg + threshold) return 'improving';
    if (recentAvg < olderAvg - threshold) return 'declining';
    return 'stable';
  }

  private extractFields(obj: any, fields: string[]): any {
    const result: any = {};
    fields.forEach(field => {
      if (obj[field] !== undefined) {
        result[field] = obj[field];
      }
    });
    return result;
  }

  private async logServiceEvent(eventData: {
    service_id: string;
    event_type: string;
    details: any;
    performed_by: string;
  }): Promise<void> {
    try {
      await this.knex('service_audit_log').insert({
        id: this.knex.raw('uuid_generate_v4()'),
        service_id: eventData.service_id,
        event_type: eventData.event_type,
        details: JSON.stringify(eventData.details),
        performed_by: eventData.performed_by,
        timestamp: new Date()
      });
    } catch (error) {
      // Log errors but don't fail the main operation
      console.error('Error logging service event:', error);
    }
  }

  private async checkUserExists(userId: string): Promise<boolean> {
    try {
      const user = await this.knex('users')
        .where('user_id', userId)
        .first();
      return !!user;
    } catch (error) {
      return false;
    }
  }

  private async checkDependencyCycles(
    serviceId: string,
    dependsOn: string[]
  ): Promise<boolean> {
    // Simple cycle detection - check if any dependency eventually depends on this service
    try {
      for (const depId of dependsOn) {
        if (await this.hasDependencyPath(depId, serviceId, new Set())) {
          return true;
        }
      }
      return false;
    } catch (error) {
      return false; // Assume no cycle if we can't check
    }
  }

  private async hasDependencyPath(
    fromServiceId: string,
    toServiceId: string,
    visited: Set<string>
  ): Promise<boolean> {
    if (visited.has(fromServiceId)) return false;
    if (fromServiceId === toServiceId) return true;

    visited.add(fromServiceId);

    const dependencies = await this.knex('service_dependencies')
      .where('service_id', fromServiceId)
      .select('depends_on_service_id');

    for (const dep of dependencies) {
      if (await this.hasDependencyPath(dep.depends_on_service_id, toServiceId, visited)) {
        return true;
      }
    }

    return false;
  }
}

export default ServiceCatalogService;