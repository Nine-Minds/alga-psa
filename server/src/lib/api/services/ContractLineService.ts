/**
 * Contract Line Service
 * Comprehensive service layer for contract line operations with validation, business logic, and API integration
 */

import { Knex } from 'knex';
import { BaseService, ServiceContext, ListResult } from './BaseService';
import { withTransaction } from '@shared/db';
import { IContractLine, IContractLineFixedConfig, IClientContractLine, IBucketUsage } from 'server/src/interfaces/billing.interfaces';
import { IContract, IContractLineMapping, IClientContract } from 'server/src/interfaces/contract.interfaces';
import { IContractLineServiceConfiguration } from 'server/src/interfaces/contractLineServiceConfiguration.interfaces';
import { IService } from 'server/src/interfaces/billing.interfaces';
import { v4 as uuidv4 } from 'uuid';

// Import existing models and actions for integration
import ContractLine from 'server/src/lib/models/contractLine';
import ContractLineFixedConfig from 'server/src/lib/models/contractLineFixedConfig';
import ContractLineMapping from 'server/src/lib/models/contractLineMapping';
import { ContractLineServiceConfigurationService } from 'server/src/lib/services/contractLineServiceConfigurationService';
import { publishEvent } from 'server/src/lib/eventBus/publishers';

// Import schema types for validation
import {
  CreateContractLineData,
  UpdateContractLineData,
  ContractLineResponse,
  ContractLineFilterData,
  CreateFixedContractLineConfigData,
  UpdateFixedContractLineConfigData,
  CreateContractData,
  UpdateContractData,
  ContractResponse,
  CreateClientContractLineData,
  UpdateClientContractLineData,
  ClientContractLineResponse,
  AddServiceToContractLineData,
  UpdateContractLineServiceData,
  CopyContractLineData,
  CreateContractLineTemplateData,
  ContractLineTemplateResponse,
  CreateContractLineFromTemplateData,
  ContractLineActivationData,
  ClientContractLineActivationData,
  BulkCreateContractLinesData,
  BulkUpdateContractLinesData,
  BulkDeleteContractLinesData,
  BulkAddServicesToContractLineData,
  BulkRemoveServicesFromContractLineData,
  ContractLineAnalyticsResponse,
  ContractAnalyticsResponse,
  BillingOverviewAnalytics,
  UsageMetricsResponse
} from '../schemas/contractLineSchemas';

import { ListOptions } from '../controllers/types';
import { generateResourceLinks, addHateoasLinks } from '../utils/responseHelpers';

export interface ContractLineServiceOptions {
  includeAnalytics?: boolean;
  includeServices?: boolean;
  includeUsage?: boolean;
  includeClients?: boolean;
}

export interface ContractLineTemplate {
  template_id: string;
  template_name: string;
  template_description?: string;
  contract_line_type: 'Fixed' | 'Hourly' | 'Usage' | 'Bucket';
  billing_frequency: string;
  default_services?: Array<{
    service_id: string;
    service_name: string;
    configuration_type: string;
    default_rate?: number;
    quantity: number;
  }>;
  is_public: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  tenant: string;
}

export class ContractLineService extends BaseService<IContractLine> {
  private contractLineServiceConfigService: ContractLineServiceConfigurationService;

  constructor() {
    super({
      tableName: 'contract_lines',
      primaryKey: 'contract_line_id',
      tenantColumn: 'tenant',
      searchableFields: ['contract_line_name', 'service_category'],
      defaultSort: 'contract_line_name',
      defaultOrder: 'asc'
    });
    this.contractLineServiceConfigService = new ContractLineServiceConfigurationService();
  }


  // ============================================================================
  // BASIC CRUD OPERATIONS WITH VALIDATION
  // ============================================================================

  /**
   * List contract lines with enhanced filtering and analytics
   */
  async list(
      options: ListOptions, 
      context: ServiceContext
    ): Promise<ListResult<IContractLine>> {
      const serviceOptions: ContractLineServiceOptions = {};
      const { knex } = await this.getKnex();
      
      const {
        page = 1,
        limit = 25,
        filters = {} as ContractLineFilterData,
        sort,
        order
      } = options;
  
      // Build enhanced query with analytics if requested
      let dataQuery = this.buildContractLineQuery(knex, context, serviceOptions);
      dataQuery = this.applyContractLineFilters(dataQuery, filters);
      dataQuery = this.applySorting(dataQuery, sort, order);
      dataQuery = this.applyPagination(dataQuery, page, limit);
  
      // Build count query
      let countQuery = this.buildBaseQuery(knex, context);
      countQuery = this.applyContractLineFilters(countQuery, filters);
  
      // Execute queries
      const [contractLines, [{ count }]] = await Promise.all([
        dataQuery,
        countQuery.count('* as count')
      ]);
  
      // Transform null to undefined for compatibility
      const transformedContractLines = contractLines.map((contractLine: any) => ({
        ...contractLine,
        service_category: contractLine.service_category || undefined
      }));
  
      return {
        data: transformedContractLines as IContractLine[],
        total: parseInt(count as string)
      };
    }
  
    // Extended list method for API use
    async listWithOptions(
      options: ListOptions, 
      context: ServiceContext, 
      serviceOptions: ContractLineServiceOptions = {}
    ): Promise<ListResult<ContractLineResponse>> {
      const { knex } = await this.getKnex();
      
      const {
        page = 1,
        limit = 25,
        filters = {} as ContractLineFilterData,
        sort,
        order
      } = options;
  
      // Build enhanced query with analytics if requested
      let dataQuery = this.buildContractLineQuery(knex, context, serviceOptions);
      dataQuery = this.applyContractLineFilters(dataQuery, filters);
      dataQuery = this.applySorting(dataQuery, sort, order);
      dataQuery = this.applyPagination(dataQuery, page, limit);
  
      // Build count query
      let countQuery = this.buildBaseQuery(knex, context);
      countQuery = this.applyContractLineFilters(countQuery, filters);
  
      // Execute queries
      const [contractLines, [{ count }]] = await Promise.all([
        dataQuery,
        countQuery.count('* as count')
      ]);
  
      // Transform null to undefined for compatibility
      const transformedContractLines = contractLines.map((contractLine: any) => ({
        ...contractLine,
        service_category: contractLine.service_category || undefined
      }));
  
      // Add HATEOAS links
      const contractLinesWithLinks = transformedContractLines.map((contractLine: any) => 
        addHateoasLinks(contractLine, this.generateContractLineLinks(contractLine.contract_line_id!, context))
      );
  
      return {
        data: contractLinesWithLinks as ContractLineResponse[],
        total: parseInt(count as string)
      };
    }



  /**
   * Get contract line by ID with related data
   */
  async getById(id: string, context: ServiceContext): Promise<IContractLine | null> {
      const { knex } = await this.getKnex();
      
      const query = this.buildBaseQuery(knex, context)
        .where('contract_line_id', id)
        .first();
  
      const contractLine = await query;
      
      if (!contractLine) {
        return null;
      }
  
      // Transform null to undefined for compatibility
      return {
        ...contractLine,
        service_category: contractLine.service_category || undefined
      } as IContractLine;
    }
  
    /**
     * Get contract line by ID with related data and options
     */
    async getByIdWithOptions(
        id: string, 
        context: ServiceContext, 
        options: ContractLineServiceOptions = {}
      ): Promise<ContractLineResponse | null> {
        const { knex } = await this.getKnex();
        
        const query = this.buildContractLineQuery(knex, context, options)
          .where('cl.contract_line_id', id)
          .first();
    
        const contractLine = await query;
        
        if (!contractLine) {
          return null;
        }
    
        // Transform null to undefined for compatibility
        const transformedContractLine = {
        ...contractLine,
          service_category: contractLine.service_category || undefined
        };
    
        // Add HATEOAS links
        return addHateoasLinks(transformedContractLine, this.generateContractLineLinks(id, context)) as ContractLineResponse;
      }



  /**
   * Create new contract line with validation and audit trail
   * Overloads for BaseService compatibility
   */
  async create(data: Partial<IContractLine>, context: ServiceContext): Promise<IContractLine>;
  async create(data: CreateContractLineData, context: ServiceContext): Promise<any>;
  async create(data: any, context: ServiceContext): Promise<any> {
      const { knex } = await this.getKnex();
      
      return withTransaction(knex, async (trx) => {
        const contractLineData = this.addCreateAuditFields(data, context);
        contractLineData.contract_line_id = uuidv4();
        
        // Create the base contract line record
        const [contractLine] = await trx('contract_lines').insert(contractLineData).returning('*');
        
        // Create default fixed config if contract line type is Fixed (handle base_rate if provided)
        if (data.contract_line_type === 'Fixed') {
          const fixedConfig = {
            contract_line_id: contractLineData.contract_line_id,
            base_rate: (data as any).base_rate || 0,
            enable_proration: false,
            billing_cycle_alignment: 'start' as const,
            tenant: context.tenant,
            created_at: new Date(),
            updated_at: new Date()
          };
          await trx('contract_line_fixed_configs').insert(fixedConfig);
        }
  
        // Publish event
        await publishEvent({
          eventType: 'CONTRACT_LINE_CREATED',
          payload: {
            tenantId: context.tenant,
            contractLineId: contractLine.contract_line_id,
            contractLineName: data.contract_line_name,
            contractLineType: data.contract_line_type,
            userId: context.userId,
            timestamp: new Date().toISOString()
          }
        });
  
        return this.getById(contractLine.contract_line_id, context);
      });
    }


  /**
   * Update contract line with validation
   */
  async update(id: string, data: Partial<IContractLine>, context: ServiceContext): Promise<IContractLine> {
      const { knex } = await this.getKnex();
      
      return withTransaction(knex, async (trx) => {
        // Check if contract line exists and get current state
        const existingContractLine = await this.getExistingContractLine(id, context, trx);
        
        // Prepare update data
        const updateData = this.addUpdateAuditFields(data, context);
        
        // Handle contract line type specific logic
        if (existingContractLine.contract_line_type === 'Hourly') {
          // Remove per-service fields for hourly contract lines
          delete updateData.hourly_rate;
          delete updateData.minimum_billable_time;
          delete updateData.round_up_to_nearest;
        }
        
        // Update the contract line
        const [updatedContractLine] = await trx('contract_lines')
          .where('contract_line_id', id)
          .where('tenant', context.tenant)
          .update(updateData)
          .returning('*');
        
        if (!updatedContractLine) {
          throw new Error('Contract line not found or permission denied');
        }
        
        // Transform null to undefined for compatibility
        return {
          ...updatedContractLine,
          service_category: updatedContractLine.service_category || undefined
        } as IContractLine;
      });
    }
  
    /**
     * Update contract line with enhanced features and response
     */
    async updateContractLine(
      id: string, 
      data: UpdateContractLineData, 
      context: ServiceContext
    ): Promise<ContractLineResponse> {
      const { knex } = await this.getKnex();
      
      return withTransaction(knex, async (trx) => {
        // Check if contract line exists and get current state
        const existingContractLine = await this.getExistingContractLine(id, context, trx);
        
        // Validate business rules
        await this.validateContractLineUpdate(id, data, existingContractLine, context, trx);
        
        // Prepare update data
        const updateData = this.addUpdateAuditFields(data, context);
        
        // Handle contract line type specific logic
        if (existingContractLine.contract_line_type === 'Hourly') {
          // Remove per-service fields for hourly contract lines
          delete updateData.hourly_rate;
          delete updateData.minimum_billable_time;
          delete updateData.round_up_to_nearest;
        }
        
        // Update the contract line
        const [updatedContractLine] = await trx('contract_lines')
          .where('contract_line_id', id)
          .where('tenant', context.tenant)
          .update(updateData)
          .returning('*');
        
        if (!updatedContractLine) {
          throw new Error('Contract line not found or permission denied');
        }
        
        // Transform null to undefined for compatibility
        const transformedContractLine = {
          ...updatedContractLine,
          service_category: updatedContractLine.service_category || undefined
        };
        
        return addHateoasLinks(transformedContractLine, this.generateContractLineLinks(id, context)) as ContractLineResponse;
      });
    }


  /**
   * Delete contract line with cascade checks
   */
  async delete(id: string, context: ServiceContext): Promise<void> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      // Check if contract line is in use
      const isInUse = await this.isContractLineInUse(id, context, trx);
      if (isInUse.inUse) {
        throw new Error(`Cannot delete contract line: ${isInUse.reason}`);
      }
      
      // Remove associated services first
      await this.removeAllServicesFromContractLine(id, context, trx);
      
      // Remove from any contracts
      await this.removeContractLineFromAllContracts(id, context, trx);
      
      // Delete the contract line
      const deletedCount = await trx('contract_lines')
        .where('contract_line_id', id)
        .where('tenant', context.tenant)
        .delete();
      
      if (deletedCount === 0) {
        throw new Error('Contract line not found or permission denied');
      }
    });
  }

  // ============================================================================
  // CONTRACT LINE CONFIGURATION MANAGEMENT
  // ============================================================================

  /**
   * Get fixed contract line configuration
   */
  async getFixedContractLineConfig(
    contractLineId: string, 
    context: ServiceContext
  ): Promise<IContractLineFixedConfig | null> {
    const { knex } = await this.getKnex();
    
    const config = await knex('contract_line_fixed_config')
      .where('contract_line_id', contractLineId)
      .where('tenant', context.tenant)
      .first();
    
    return config || null;
  }

  /**
   * Create or update fixed contract line configuration
   */
  async upsertFixedContractLineConfig(
    contractLineId: string,
    data: CreateFixedContractLineConfigData,
    context: ServiceContext
  ): Promise<IContractLineFixedConfig> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      // Verify contract line exists and is Fixed type
      const contractLine = await this.getExistingContractLine(contractLineId, context, trx);
      if (contractLine.contract_line_type !== 'Fixed') {
        throw new Error('Can only add fixed configuration to Fixed type contract lines');
      }
      
      // Upsert configuration
      const configData = {
        contract_line_id: contractLineId,
        ...data,
        tenant: context.tenant,
        updated_at: new Date()
      };
      
      const [config] = await trx('contract_line_fixed_config')
        .insert(configData)
        .onConflict(['contract_line_id', 'tenant'])
        .merge(configData)
        .returning('*');
      
      return config;
    });
  }

  /**
   * Get combined fixed contract line configuration (contract line-level + service-level)
   */
  async getCombinedFixedContractLineConfig(
    contractLineId: string,
    serviceId: string,
    context: ServiceContext
  ): Promise<any> {
    const { knex } = await this.getKnex();
    
    // Get contract line-level config
    const contractLineConfig = await this.getFixedContractLineConfig(contractLineId, context);
    
    // Get service-level config
    this.contractLineServiceConfigService = new ContractLineServiceConfigurationService(knex, context.tenant);
    const serviceConfig = await this.contractLineServiceConfigService.getConfigurationForService(contractLineId, serviceId);
    
    return {
      base_rate: contractLineConfig?.base_rate || null,
      enable_proration: contractLineConfig?.enable_proration || false,
      billing_cycle_alignment: contractLineConfig?.billing_cycle_alignment || 'start',
      config_id: serviceConfig?.config_id
    };
  }

  // ============================================================================
  // SERVICE MANAGEMENT
  // ============================================================================

  /**
   * Add service to contract line
   */
  async addServiceToContractLine(
      contractLineId: string,
      data: AddServiceToContractLineData,
      context: ServiceContext
    ): Promise<any> {
      const { knex } = await this.getKnex();
      
      return withTransaction(knex, async (trx) => {
        // Validate contract line exists
        const contractLine = await this.getExistingContractLine(contractLineId, context, trx);
        
        // Validate service exists
        const service = await this.getServiceById(data.service_id, context, trx);
        if (!service) {
          throw new Error('Service not found');
        }
        
        // Check if service already exists in contract line
        const existingConfig = await trx('contract_line_service_configuration')
          .where('contract_line_id', contractLineId)
          .where('service_id', data.service_id)
          .where('tenant', context.tenant)
          .first();
        
        if (existingConfig) {
          throw new Error('Service already exists in this contract line');
        }
        
        // Create service configuration
        this.contractLineServiceConfigService = new ContractLineServiceConfigurationService(trx, context.tenant);
        
        const baseConfigData = {
          contract_line_id: contractLineId,
          service_id: data.service_id,
          configuration_type: data.configuration_type || contractLine.contract_line_type,
          custom_rate: data.custom_rate,
          quantity: data.quantity || 1,
          tenant: context.tenant
        };
        
        const configId = await this.contractLineServiceConfigService.createConfiguration(
          baseConfigData,
          data.type_config || {}
        );
        
        // Return the created configuration
        return await this.contractLineServiceConfigService.getConfigurationWithDetails(configId);
      });
    }


  /**
   * Remove service from contract line
   */
  async removeServiceFromContractLine(
    contractLineId: string,
    serviceId: string,
    context: ServiceContext
  ): Promise<void> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      // Get configuration to delete
      const config = await trx('contract_line_service_configuration')
        .where('contract_line_id', contractLineId)
        .where('service_id', serviceId)
        .where('tenant', context.tenant)
        .first();
      
      if (!config) {
        throw new Error('Service configuration not found in contract line');
      }
      
      // Use service to delete configuration and related data
      this.contractLineServiceConfigService = new ContractLineServiceConfigurationService(trx, context.tenant);
      await this.contractLineServiceConfigService.deleteConfiguration(config.config_id);
    });
  }

  /**
   * Update service configuration in contract line
   */
  async updateContractLineService(
      contractLineId: string,
      serviceId: string,
      data: UpdateContractLineServiceData,
      context: ServiceContext
    ): Promise<any> {
      const { knex } = await this.getKnex();
      
      return withTransaction(knex, async (trx) => {
        // Get existing configuration
        const config = await trx('contract_line_service_configuration')
          .where('contract_line_id', contractLineId)
          .where('service_id', serviceId)
          .where('tenant', context.tenant)
          .first();
        
        if (!config) {
          throw new Error('Service configuration not found in contract line');
        }
        
        // Update service configuration
        this.contractLineServiceConfigService = new ContractLineServiceConfigurationService(trx, context.tenant);
        
        await this.contractLineServiceConfigService.updateConfiguration(
          config.config_id,
          data,
          data.type_config || {}
        );
        
        // Return updated configuration
        return await this.contractLineServiceConfigService.getConfigurationWithDetails(config.config_id);
      });
    }


  /**
   * Get all services in a contract line
   */
  async getContractLineServices(
    contractLineId: string,
    context: ServiceContext
  ): Promise<Array<any>> {
    const { knex } = await this.getKnex();
    
    const services = await knex('contract_line_service_configuration as psc')
      .join('services as s', function() {
        this.on('psc.service_id', '=', 's.service_id')
            .andOn('psc.tenant', '=', 's.tenant');
      })
      .where('psc.contract_line_id', contractLineId)
      .where('psc.tenant', context.tenant)
      .select(
        'psc.*',
        's.service_name',
        's.default_rate',
        's.unit_of_measure',
        's.billing_method'
      );
    
    // Add configuration details for each service
    const servicesWithConfig = await Promise.all(
      services.map(async (service) => {
        this.contractLineServiceConfigService = new ContractLineServiceConfigurationService(knex, context.tenant);
        const details = await this.contractLineServiceConfigService.getConfigurationWithDetails(service.config_id);
        return {
          service: {
            service_id: service.service_id,
            service_name: service.service_name,
            default_rate: service.default_rate,
            unit_of_measure: service.unit_of_measure,
            billing_method: service.billing_method
          },
          configuration: service,
          type_config: details.typeConfig,
          rate_tiers: details.rateTiers || []
        };
      })
    );
    
    return servicesWithConfig;
  }

  // ============================================================================
  // CONTRACT MANAGEMENT
  // ============================================================================

  /**
   * Create a new contract
   */
  async createContract(
    data: CreateContractData,
    context: ServiceContext
  ): Promise<ContractResponse> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      const { contract_description, ...rest } = data as any;
      const contractData = this.addCreateAuditFields(
        {
          contract_id: uuidv4(),
          ...rest,
          contract_description,
        },
        context
      );

      const [contract] = await trx('contracts').insert(contractData).returning('*');
      return addHateoasLinks(contract, this.generateContractLinks(contract.contract_id, context)) as ContractResponse;
    });
  }

  /**
   * Associate a contract line with a contract
   */
  async addContractLine(
    contractId: string,
    contractLineId: string,
    customRate: number | undefined,
    context: ServiceContext
  ): Promise<IContractLineMapping> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      await this.validateContractExists(contractId, context, trx);
      await this.getExistingContractLine(contractLineId, context, trx);
      
      const existing = await trx('contract_line_mappings')
        .where('contract_id', contractId)
        .where('contract_line_id', contractLineId)
        .where('tenant', context.tenant)
        .first();
      
      if (existing) {
        throw new Error('Contract line already associated with this contract');
      }
      
      const contractLineMapping = {
        contract_id: contractId,
        contract_line_id: contractLineId,
        custom_rate: customRate,
        tenant: context.tenant,
        created_at: new Date()
      };
      
      const [insertedMapping] = await trx('contract_line_mappings')
        .insert(contractLineMapping)
        .returning('*');
      
      return insertedMapping;
    });
  }

  /**
   * Remove a contract line from a contract
   */
  async removeContractLine(
    contractId: string,
    contractLineId: string,
    context: ServiceContext
  ): Promise<void> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      const clientAssignments = await trx('client_contract_lines')
        .where('contract_line_id', contractLineId)
        .where('client_contract_id', contractId)
        .where('tenant', context.tenant)
        .where('is_active', true);
      
      if (clientAssignments.length > 0) {
        throw new Error('Cannot remove contract line: it is currently assigned to clients');
      }
      
      const deletedCount = await trx('contract_line_mappings')
        .where('contract_id', contractId)
        .where('contract_line_id', contractLineId)
        .where('tenant', context.tenant)
        .delete();
      
      if (deletedCount === 0) {
        throw new Error('Contract line not found on contract');
      }
    });
  }

  // ============================================================================
  // COMPANY ASSIGNMENT OPERATIONS
  // ============================================================================

  /**
   * Assign contract line to client
   */
  async assignContractLineToClient(
    data: CreateClientContractLineData,
    context: ServiceContext
  ): Promise<ClientContractLineResponse> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      // Validate contract line exists and is active
      const contractLine = await this.getExistingContractLine(data.contract_line_id, context, trx);
      // Contract line existence check is sufficient - active contract lines are in the table
      
      // Validate client exists
      await this.validateClientExists(data.client_id, context, trx);
      
      // Check for overlapping assignments
      await this.validateNoOverlappingAssignments(data, context, trx);
      
      // Create assignment
      const assignmentData = this.addCreateAuditFields({
        client_contract_line_id: uuidv4(),
        ...data
      }, context);
      
      const [assignment] = await trx('client_contract_lines')
        .insert(assignmentData)
        .returning('*');
      
      return addHateoasLinks(assignment, this.generateClientContractLineLinks(assignment.client_contract_line_id, context)) as ClientContractLineResponse;
    });
  }

  /**
   * Unassign contract line from client
   */
  async unassignContractLineFromClient(
    clientContractLineId: string,
    context: ServiceContext
  ): Promise<void> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      // Check if there are pending invoices or active usage
      await this.validateSafeUnassignment(clientContractLineId, context, trx);
      
      // Soft delete by setting end_date and is_active = false
      const updateData = this.addUpdateAuditFields({
        end_date: new Date().toISOString(),
        is_active: false
      }, context);
      
      const result = await trx('client_contract_lines')
        .where('client_contract_line_id', clientContractLineId)
        .where('tenant', context.tenant)
        .update(updateData);
      
      if (result === 0) {
        throw new Error('Client contract line assignment not found');
      }
    });
  }

  // ============================================================================
  // CONTRACT LINE ACTIVATION AND LIFECYCLE
  // ============================================================================

  /**
   * Activate or deactivate contract line
   */
  async setContractLineActivation(
    contractLineId: string,
    data: ContractLineActivationData,
    context: ServiceContext
  ): Promise<ContractLineResponse> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      const contractLine = await this.getExistingContractLine(contractLineId, context, trx);
      
      // Validate deactivation is safe
      if (!data.is_active) {
        const usage = await this.isContractLineInUse(contractLineId, context, trx);
        if (usage.inUse && !data.reason) {
          throw new Error('Cannot deactivate contract line that is in use without providing a reason');
        }
      }
      
      // Update contract line activation status
      const updateData = this.addUpdateAuditFields({
        is_active: data.is_active
      }, context);
      
      const [updatedContractLine] = await trx('contract_lines')
        .where('contract_line_id', contractLineId)
        .where('tenant', context.tenant)
        .update(updateData)
        .returning('*');
      
      // If deactivating, also deactivate client assignments if requested
      if (!data.is_active && data.effective_date) {
        await trx('client_contract_lines')
          .where('contract_line_id', contractLineId)
          .where('tenant', context.tenant)
          .where('is_active', true)
          .update({
            is_active: false,
            end_date: data.effective_date,
            updated_at: new Date(),
            updated_by: context.userId
          });
      }
      
      return addHateoasLinks(updatedContractLine, this.generateContractLineLinks(contractLineId, context)) as ContractLineResponse;
    });
  }

  // ============================================================================
  // TEMPLATE AND COPYING OPERATIONS
  // ============================================================================

  /**
   * Copy existing contract line
   */
  async copyContractLine(
    data: CopyContractLineData,
    context: ServiceContext
  ): Promise<ContractLineResponse> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      // Get source contract line
      const sourceContractLine = await this.getExistingContractLine(data.source_contract_line_id, context, trx);
      
      // Create new contract line
      const newContractLineData = {
        ...sourceContractLine,
        contract_line_id: uuidv4(),
        contract_line_name: data.new_contract_line_name,
        is_custom: true,
        created_at: new Date(),
        updated_at: new Date(),
        created_by: context.userId,
        updated_by: context.userId
      };
      
      delete newContractLineData.tenant; // Will be set by addCreateAuditFields
      const auditedData = this.addCreateAuditFields(newContractLineData, context);
      
      const [newContractLine] = await trx('contract_lines').insert(auditedData).returning('*');
      
      // Copy services if requested
      if (data.copy_services) {
        await this.copyContractLineServices(data.source_contract_line_id, newContractLine.contract_line_id, data.modify_rates, context, trx);
      }
      
      // Copy configurations if requested
      if (data.copy_configurations) {
        await this.copyContractLineConfigurations(data.source_contract_line_id, newContractLine.contract_line_id, context, trx);
      }
      
      return addHateoasLinks(newContractLine, this.generateContractLineLinks(newContractLine.contract_line_id, context)) as ContractLineResponse;
    });
  }

  /**
   * Create contract line template
   */
  async createTemplate(
    data: CreateContractLineTemplateData,
    context: ServiceContext
  ): Promise<ContractLineTemplateResponse> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      const templateData = this.addCreateAuditFields({
        template_id: uuidv4(),
        ...data,
        created_by: context.userId
      }, context);
      
      const [template] = await trx('plan_templates').insert(templateData).returning('*');
      
      // Add default services if provided
      if (data.default_services && data.default_services.length > 0) {
        const serviceData = data.default_services.map(service => ({
          template_id: template.template_id,
          service_id: service.service_id,
          configuration_type: service.configuration_type,
          default_rate: service.default_rate,
          quantity: service.quantity || 1,
          tenant: context.tenant,
          created_at: new Date()
        }));
        
        await trx('template_services').insert(serviceData);
      }
      
      return template as ContractLineTemplateResponse;
    });
  }

  /**
   * Create contract line from template
   */
  async createFromTemplate(
    data: CreateContractLineFromTemplateData,
    context: ServiceContext
  ): Promise<ContractLineResponse> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      // Get template
      const template = await trx('plan_templates')
        .where('template_id', data.template_id)
        .where('tenant', context.tenant)
        .first();
      
      if (!template) {
        throw new Error('Template not found');
      }
      
      // Create contract line from template
      const contractLineData = this.addCreateAuditFields({
        contract_line_id: uuidv4(),
        contract_line_name: data.contract_line_name,
        contract_line_type: template.contract_line_type,
        billing_frequency: template.billing_frequency,
        is_custom: true
      }, context);
      
      const [newContractLine] = await trx('contract_lines').insert(contractLineData).returning('*');
      
      // Add template services
      const templateServices = await trx('template_services')
        .where('template_id', data.template_id)
        .where('tenant', context.tenant);
      
      for (const templateService of templateServices) {
        let rate = templateService.default_rate;
        
        // Apply rate modifications if specified
        if (data.modify_rates) {
          if (data.modify_rates.percentage_change) {
            rate = rate * (1 + data.modify_rates.percentage_change / 100);
          }
          if (data.modify_rates.fixed_adjustment) {
            rate = rate + data.modify_rates.fixed_adjustment;
          }
        }
        
        // Check for service overrides
        const override = data.override_services?.find(o => o.service_id === templateService.service_id);
        if (override) {
          rate = override.custom_rate || rate;
        }
        
        // Add service to contract line
        await this.addServiceToContractLine(newContractLine.contract_line_id, {
          service_id: templateService.service_id,
          configuration_type: templateService.configuration_type,
          custom_rate: rate,
          quantity: override?.quantity || templateService.quantity
        }, context);
      }
      
      return addHateoasLinks(newContractLine, this.generateContractLineLinks(newContractLine.contract_line_id, context)) as ContractLineResponse;
    });
  }

  // ============================================================================
  // USAGE TRACKING AND METERING
  // ============================================================================

  /**
   * Get usage metrics for a contract line
   */
  async getUsageMetrics(
    contractLineId: string,
    periodStart: Date,
    periodEnd: Date,
    context: ServiceContext
  ): Promise<UsageMetricsResponse> {
    const { knex } = await this.getKnex();
    
    // Get bucket usage data
    const bucketUsage = await knex('bucket_usage')
      .where('contract_line_id', contractLineId)
      .where('tenant', context.tenant)
      .whereBetween('period_start', [periodStart, periodEnd])
      .sum('minutes_used as total_usage')
      .sum('overage_minutes as overage_usage')
      .first();
    
    // Get time entries for billable usage
    const timeEntries = await knex('time_entries as te')
      .join('client_contract_lines as ccl', function() {
        this.on('te.client_id', '=', 'ccl.client_id')
            .andOn('te.tenant', '=', 'ccl.tenant');
      })
      .where('ccl.contract_line_id', contractLineId)
      .where('te.tenant', context.tenant)
      .whereBetween('te.start_time', [periodStart, periodEnd])
      .where('te.is_billable', true)
      .sum('te.duration as billable_minutes')
      .groupBy('te.service_id', 'te.user_id')
      .select('te.service_id', 'te.user_id', knex.raw('SUM(te.duration) as minutes'));
    
    // Calculate usage by service and user
    const usageByService: Record<string, number> = {};
    const usageByUser: Record<string, number> = {};
    
    timeEntries.forEach((entry: any) => {
      usageByService[entry.service_id] = (usageByService[entry.service_id] || 0) + entry.minutes;
      usageByUser[entry.user_id] = (usageByUser[entry.user_id] || 0) + entry.minutes;
    });
    
    // Calculate costs (simplified - would need rate information)
    const baseCost = 0; // Would calculate based on contract line rates
    const overageCost = (bucketUsage?.overage_usage || 0) * 1.5; // Example overage rate
    
    return {
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
      total_usage: (bucketUsage?.total_usage || 0) + Object.values(usageByService).reduce((a, b) => a + b, 0),
      billable_usage: Object.values(usageByService).reduce((a, b) => a + b, 0),
      overage_usage: bucketUsage?.overage_usage || 0,
      usage_by_service: usageByService,
      usage_by_user: usageByUser,
      cost_breakdown: {
        base_cost: baseCost,
        overage_cost: overageCost,
        total_cost: baseCost + overageCost
      }
    };
  }

  // ============================================================================
  // BULK OPERATIONS
  // ============================================================================

  /**
   * Bulk create contract lines
   */
  async bulkCreateContractLines(
      data: BulkCreateContractLinesData,
      context: ServiceContext
    ): Promise<ContractLineResponse[]> {
      const { knex } = await this.getKnex();

      return withTransaction(knex, async (trx) => {
        const results: ContractLineResponse[] = [];

        for (const contractLineData of data.contractLines) {
          // Validate each contract line
          await this.validateContractLineCreation(contractLineData, context, trx);
          
          // Create contract line
          const auditedData = this.addCreateAuditFields({
            contract_line_id: uuidv4(),
            ...contractLineData
          }, context);
          
          const [contractLine] = await trx('contract_lines').insert(auditedData).returning('*');
          results.push(addHateoasLinks(contractLine, this.generateContractLineLinks(contractLine.contract_line_id, context)) as ContractLineResponse);
        }
        
        return results;
      });
    }


  /**
   * Bulk update contract lines
   */
  async bulkUpdateContractLines(
      data: BulkUpdateContractLinesData,
      context: ServiceContext
    ): Promise<ContractLineResponse[]> {
      const { knex } = await this.getKnex();

      return withTransaction(knex, async (trx) => {
        const results: ContractLineResponse[] = [];

        for (const update of data.contractLines) {
          const updatedContractLine = await this.updateContractLine(update.contract_line_id, update.data, context);
          results.push(updatedContractLine);
        }
        
        return results;
      });
    }


  /**
   * Bulk delete contract lines
   */
  async bulkDeleteContractLines(
      data: BulkDeleteContractLinesData,
      context: ServiceContext
    ): Promise<void> {
      const { knex } = await this.getKnex();
      
      return withTransaction(knex, async (trx) => {
        for (const contractLineId of data.contract_line_ids) {
          await this.delete(contractLineId, context);
        }
      });
    }


  // ============================================================================
  // ANALYTICS AND REPORTING
  // ============================================================================

  /**
   * Get contract line analytics
   */
  async getContractLineAnalytics(
    contractLineId: string,
    context: ServiceContext
  ): Promise<ContractLineAnalyticsResponse> {
    const { knex } = await this.getKnex();
    
    // Get basic contract line info
    const contractLine = await this.getExistingContractLine(contractLineId, context);
    
    // Get client assignments
    const clientStats = await knex('client_contract_lines')
      .where('contract_line_id', contractLineId)
      .where('tenant', context.tenant)
      .select(
        knex.raw('COUNT(*) as total_clients'),
        knex.raw('COUNT(CASE WHEN is_active = true THEN 1 END) as active_clients')
      )
      .first();
    
    // Get revenue data (simplified)
    const revenueStats = {
      monthly: 0,
      quarterly: 0,
      yearly: 0,
      average_per_client: 0
    };
    
    // Get service usage stats
    const serviceStats = await knex('contract_line_service_configuration as psc')
      .join('services as s', 'psc.service_id', 's.service_id')
      .where('psc.contract_line_id', contractLineId)
      .where('psc.tenant', context.tenant)
      .select('s.service_name', 'psc.service_id')
      .count('* as usage_count');
    
    return {
      contract_line_id: contractLineId,
      contract_line_name: contractLine.contract_line_name,
      contract_line_type: contractLine.contract_line_type,
      total_clients: parseInt(clientStats?.total_clients || '0'),
      active_clients: parseInt(clientStats?.active_clients || '0'),
      revenue: revenueStats,
      usage_stats: {
        total_services: serviceStats.length,
        most_used_services: serviceStats.map((s: any) => ({
          service_id: s.service_id,
          service_name: s.service_name,
          usage_count: parseInt(s.usage_count)
        })),
        average_services_per_client: serviceStats.length / (parseInt(clientStats?.total_clients || '1'))
      },
      growth_metrics: {
        new_clients_this_month: 0,
        churn_rate: 0,
        revenue_growth_rate: 0
      }
    };
  }

  /**
   * Get billing overview analytics
   */
  async getBillingOverviewAnalytics(context: ServiceContext): Promise<BillingOverviewAnalytics> {
    const { knex } = await this.getKnex();
    
    // Get basic counts
    const [contractLineCount, contractCount, assignmentCount] = await Promise.all([
      knex('contract_lines').where('tenant', context.tenant).count('* as count').first(),
      knex('contracts').where('tenant', context.tenant).count('* as count').first(),
      knex('client_contract_lines').where('tenant', context.tenant).where('is_active', true).count('* as count').first()
    ]);
    
    // Get contract lines by type
    const contractLinesByType = await knex('contract_lines')
      .where('tenant', context.tenant)
      .groupBy('contract_line_type')
      .select('contract_line_type')
      .count('* as count');
    
    const contractLineTypeDistribution: Record<string, number> = {};
    contractLinesByType.forEach((item: any) => {
      contractLineTypeDistribution[item.contract_line_type] = parseInt(String(item.count));
    });
    
    // Get billing frequency distribution
    const frequencyDistribution = await knex('contract_lines')
      .where('tenant', context.tenant)
      .groupBy('billing_frequency')
      .select('billing_frequency')
      .count('* as count');
    
    const billingFrequencyDistribution: Record<string, number> = {};
    frequencyDistribution.forEach((item: any) => {
      billingFrequencyDistribution[item.billing_frequency] = parseInt(String(item.count));
    });
    
    return {
      total_contract_lines: parseInt(String(contractLineCount?.count || '0')),
      total_contracts: parseInt(String(contractCount?.count || '0')),
      total_assignments: parseInt(String(assignmentCount?.count || '0')),
      contract_lines_by_type: contractLineTypeDistribution,
      revenue_summary: {
        total_monthly_revenue: 0,
        average_revenue_per_contract_line: 0,
        top_revenue_contract_lines: []
      },
      usage_trends: {
        most_popular_contract_line_types: Object.entries(contractLineTypeDistribution).map(([type, count]) => ({
          contract_line_type: type as any,
          count,
          percentage: (count / parseInt(String(contractLineCount?.count || '1'))) * 100
        })),
        billing_frequency_distribution: billingFrequencyDistribution
      }
    };
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  private buildContractLineQuery(
    knex: Knex,
    context: ServiceContext,
    options: ContractLineServiceOptions
  ): Knex.QueryBuilder {
    let query = knex('contract_lines as cl')
      .where('cl.tenant', context.tenant);

    // Add analytics if requested
    if (options.includeAnalytics) {
      query = query
        .leftJoin('client_contract_lines as ccl', function() {
          this.on('cl.contract_line_id', '=', 'ccl.contract_line_id')
              .andOn('cl.tenant', '=', 'ccl.tenant')
              .andOn('ccl.is_active', '=', knex.raw('true'));
        })
        .groupBy('cl.contract_line_id')
        .select(
          'cl.*',
          knex.raw('COUNT(ccl.client_id) as clients_using_plan'),
          knex.raw('AVG(ccl.custom_rate) as average_monthly_revenue')
        );
    } else {
      query = query.select('cl.*');
    }

    // Add service count if requested
    if (options.includeServices) {
      query = query
        .leftJoin('contract_line_service_configuration as psc', function() {
          this.on('cl.contract_line_id', '=', 'psc.contract_line_id')
              .andOn('cl.tenant', '=', 'psc.tenant');
        })
        .select(knex.raw('COUNT(DISTINCT psc.service_id) as total_services'));
    }

    return query;
  }

  private applyContractLineFilters(
    query: Knex.QueryBuilder, 
    filters: ContractLineFilterData
  ): Knex.QueryBuilder {
    // Apply base filters
    query = this.applyFilters(query, filters);
    
    // Apply specific contract line filters
    if (filters.has_services !== undefined) {
      if (filters.has_services) {
        query = query.whereExists(function() {
          this.select(1)
              .from('contract_line_service_configuration as psc')
              .whereRaw('psc.contract_line_id = cl.contract_line_id')
              .whereRaw('psc.tenant = cl.tenant');
        });
      } else {
        query = query.whereNotExists(function() {
          this.select(1)
              .from('contract_line_service_configuration as psc')
              .whereRaw('psc.contract_line_id = cl.contract_line_id')
              .whereRaw('psc.tenant = cl.tenant');
        });
      }
    }

    if (filters.clients_count_min !== undefined) {
      query = query.havingRaw('COUNT(ccl.client_id) >= ?', [filters.clients_count_min]);
    }

    if (filters.clients_count_max !== undefined) {
      query = query.havingRaw('COUNT(ccl.client_id) <= ?', [filters.clients_count_max]);
    }
    
    return query;
  }

  private async validateContractLineCreation(
      data: CreateContractLineData,
      context: ServiceContext,
      trx?: Knex.Transaction
    ): Promise<void> {
      const { knex } = trx ? { knex: trx } : await this.getKnex();
      
      // Check for duplicate contract line names
      const existingContractLine = await knex('contract_lines')
        .where('contract_line_name', data.contract_line_name)
        .where('tenant', context.tenant)
        .first();
      
      if (existingContractLine) {
        throw new Error('A contract line with this name already exists');
      }
      
      // Validate contract line type specific requirements
      if (data.contract_line_type === 'Fixed') {
        const baseRate = (data as any).base_rate;
        if (baseRate !== undefined && baseRate < 0) {
          throw new Error('Base rate must be non-negative for Fixed contract lines');
        }
      }
      
      // Add more validation rules as needed
    }


  private async validateContractLineUpdate(
    contractLineId: string,
    data: UpdateContractLineData,
    existingContractLine: IContractLine,
    context: ServiceContext,
    trx: Knex.Transaction
  ): Promise<void> {
    // Check if contract line name conflicts (if changing)
    if (data.contract_line_name && data.contract_line_name !== existingContractLine.contract_line_name) {
      const conflictingContractLine = await trx('contract_lines')
        .where('contract_line_name', data.contract_line_name)
        .where('tenant', context.tenant)
        .whereNot('contract_line_id', contractLineId)
        .first();
      
      if (conflictingContractLine) {
        throw new Error('A contract line with this name already exists');
      }
    }
    
    // Validate contract line type changes are not allowed if contract line is in use
    if (data.contract_line_type && data.contract_line_type !== existingContractLine.contract_line_type) {
      const usage = await this.isContractLineInUse(contractLineId, context, trx);
      if (usage.inUse) {
        throw new Error('Cannot change contract line type when contract line is in use');
      }
    }
  }

  private async getExistingContractLine(
    contractLineId: string,
    context: ServiceContext,
    trx?: Knex.Transaction
  ): Promise<IContractLine> {
    const { knex } = trx ? { knex: trx } : await this.getKnex();
    
    const contractLine = await knex('contract_lines')
      .where('contract_line_id', contractLineId)
      .where('tenant', context.tenant)
      .first();
    
    if (!contractLine) {
      throw new Error('Contract Line not found');
    }
    
    return contractLine;
  }

  private async isContractLineInUse(
    contractLineId: string,
    context: ServiceContext,
    trx?: Knex.Transaction
  ): Promise<{ inUse: boolean; reason?: string }> {
    const { knex } = trx ? { knex: trx } : await this.getKnex();
    
    // Check client assignments
    const clientAssignments = await knex('client_contract_lines')
      .where('contract_line_id', contractLineId)
      .where('tenant', context.tenant)
      .where('is_active', true)
      .count('* as count')
      .first();
    
    const clientCount = parseInt(String(clientAssignments?.count || '0'));
    if (clientCount > 0) {
      return {
        inUse: true,
        reason: `Contract line is currently assigned to ${clientCount} ${clientCount === 1 ? 'client' : 'clients'}`
      };
    }
    
    // Check if contract line is in contracts that are assigned to clients
    const contractAssignments = await knex('contract_line_mappings as clm')
      .join('client_contracts as cc', 'clm.contract_id', 'cc.contract_id')
      .where('clm.contract_line_id', contractLineId)
      .where('clm.tenant', context.tenant)
      .where('cc.is_active', true)
      .count('* as count')
      .first();
    
    const contractCount = parseInt(String(contractAssignments?.count || '0'));
    if (contractCount > 0) {
      return {
        inUse: true,
        reason: `Contract line is in contracts assigned to ${contractCount} ${contractCount === 1 ? 'client' : 'clients'}`
      };
    }
    
    return { inUse: false };
  }

  private async removeAllServicesFromContractLine(
    contractLineId: string,
    context: ServiceContext,
    trx: Knex.Transaction
  ): Promise<void> {
    // Get all service configurations for the contract line
    const configs = await trx('contract_line_service_configuration')
      .where('contract_line_id', contractLineId)
      .where('tenant', context.tenant)
      .select('config_id');
    
    // Delete each configuration (which should cascade to type-specific configs)
    for (const config of configs) {
      this.contractLineServiceConfigService = new ContractLineServiceConfigurationService(trx, context.tenant);
      await this.contractLineServiceConfigService.deleteConfiguration(config.config_id);
    }
  }

  private async removeContractLineFromAllContracts(
    contractLineId: string,
    context: ServiceContext,
    trx: Knex.Transaction
  ): Promise<void> {
    await trx('contract_line_mappings')
      .where('contract_line_id', contractLineId)
      .where('tenant', context.tenant)
      .delete();
  }

  private async createFixedContractLineConfig(
    contractLineId: string,
    data: CreateFixedContractLineConfigData,
    context: ServiceContext,
    trx: Knex.Transaction
  ): Promise<IContractLineFixedConfig> {
    const configData = {
      contract_line_id: contractLineId,
      ...data,
      tenant: context.tenant,
      created_at: new Date(),
      updated_at: new Date()
    };
    
    const [config] = await trx('contract_line_fixed_config')
      .insert(configData)
      .returning('*');
    
    return config;
  }

  private async validateContractExists(
    contractId: string,
    context: ServiceContext,
    trx: Knex.Transaction
  ): Promise<void> {
    const contract = await trx('contracts')
      .where('contract_id', contractId)
      .where('tenant', context.tenant)
      .first();
    
    if (!contract) {
      throw new Error('Contract not found');
    }
  }

  private async validateClientExists(
    clientId: string,
    context: ServiceContext,
    trx: Knex.Transaction
  ): Promise<void> {
    const client = await trx('clients')
      .where('client_id', clientId)
      .where('tenant', context.tenant)
      .first();
    
    if (!client) {
      throw new Error('Client not found');
    }
  }

  private async validateNoOverlappingAssignments(
    data: CreateClientContractLineData,
    context: ServiceContext,
    trx: Knex.Transaction
  ): Promise<void> {
    const overlapping = await trx('client_contract_lines')
      .where('client_id', data.client_id)
      .where('contract_line_id', data.contract_line_id)
      .where('tenant', context.tenant)
      .where('is_active', true)
      .where(function() {
        this.whereNull('end_date')
            .orWhere('end_date', '>', data.start_date);
      })
      .first();
    
    if (overlapping) {
      throw new Error('Client already has an active assignment for this contract line in the specified period');
    }
  }

  private async validateSafeUnassignment(
      clientContractLineId: string,
      context: ServiceContext,
      trx: Knex.Transaction
    ): Promise<void> {
      // Check for pending invoices
      const pendingInvoices = await trx('invoices')
        .where('client_contract_line_id', clientContractLineId)
        .where('tenant', context.tenant)
        .where('status', 'pending')
        .count('* as count')
        .first();
      
      if (parseInt(String(pendingInvoices?.count || '0')) > 0) {
        throw new Error('Cannot unassign contract line: there are pending invoices');
      }
      
      // Check for active usage tracking
      const activeUsage = await trx('bucket_usage')
        .join('client_contract_lines as ccl', function() {
          this.on('bucket_usage.client_id', '=', 'ccl.client_id')
              .andOn('bucket_usage.tenant', '=', 'ccl.tenant');
        })
        .where('ccl.client_contract_line_id', clientContractLineId)
        .where('bucket_usage.period_end', '>', new Date())
        .count('* as count')
        .first();
      
      if (parseInt(String(activeUsage?.count || '0')) > 0) {
        throw new Error('Cannot unassign contract line: there is active usage tracking');
      }
    }


  private async getServiceById(
    serviceId: string,
    context: ServiceContext,
    trx: Knex.Transaction
  ): Promise<IService | null> {
    const service = await trx('services')
      .where('service_id', serviceId)
      .where('tenant', context.tenant)
      .first();
    
    return service || null;
  }

  private async copyContractLineServices(
    sourceContractLineId: string,
    targetContractLineId: string,
    modifyRates: CopyContractLineData['modify_rates'],
    context: ServiceContext,
    trx: Knex.Transaction
  ): Promise<void> {
    // Get source contract line services
    const sourceServices = await trx('contract_line_service_configuration')
      .where('contract_line_id', sourceContractLineId)
      .where('tenant', context.tenant);
    
    // Copy each service with modifications
    for (const sourceService of sourceServices) {
      let customRate = sourceService.custom_rate;
      
      // Apply rate modifications
      if (modifyRates && customRate) {
        if (modifyRates.percentage_change) {
          customRate = customRate * (1 + modifyRates.percentage_change / 100);
        }
        if (modifyRates.fixed_adjustment) {
          customRate = customRate + modifyRates.fixed_adjustment;
        }
      }
      
      // Create new service configuration
      await this.addServiceToContractLine(targetContractLineId, {
        service_id: sourceService.service_id,
        configuration_type: sourceService.configuration_type,
        custom_rate: customRate,
        quantity: sourceService.quantity
      }, context);
    }
  }

  private async copyContractLineConfigurations(
    sourceContractLineId: string,
    targetContractLineId: string,
    context: ServiceContext,
    trx: Knex.Transaction
  ): Promise<void> {
    // Copy fixed contract line configuration if exists
    const fixedConfig = await trx('contract_line_fixed_config')
      .where('contract_line_id', sourceContractLineId)
      .where('tenant', context.tenant)
      .first();
    
    if (fixedConfig) {
      await this.createFixedContractLineConfig(targetContractLineId, {
        base_rate: fixedConfig.base_rate,
        enable_proration: fixedConfig.enable_proration,
        billing_cycle_alignment: fixedConfig.billing_cycle_alignment
      }, context, trx);
    }
  }

  private generateContractLineLinks(contractLineId: string, context: ServiceContext): Record<string, { href: string; method: string; rel: string }> {
    const baseUrl = '/api/v1/contract-lines';
    return generateResourceLinks('contract-lines', contractLineId, baseUrl, ['read', 'update', 'delete']);
  }

  private generateContractLinks(contractId: string, context: ServiceContext): Record<string, { href: string; method: string; rel: string }> {
    const baseUrl = '/api/v1/contracts';
    return generateResourceLinks('contracts', contractId, baseUrl, ['read', 'update', 'delete']);
  }

  private generateClientContractLineLinks(clientContractLineId: string, context: ServiceContext): Record<string, { href: string; method: string; rel: string }> {
    const baseUrl = '/api/v1/client-contract-lines';
    return generateResourceLinks('client-contract-lines', clientContractLineId, baseUrl, ['read', 'update', 'delete']);
  }
}
