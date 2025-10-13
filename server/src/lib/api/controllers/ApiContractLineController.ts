/**
 * Contract Line API Controller V2
 * Handles HTTP requests for contract line-related operations
 */

import { NextRequest, NextResponse } from 'next/server';
import { ContractLineService, ContractLineServiceOptions } from '../services/ContractLineService';
import {
  // Core schemas
  createContractLineSchema,
  updateContractLineSchema,
  contractLineListQuerySchema,
  createFixedContractLineConfigSchema,
  updateFixedContractLineConfigSchema,

  // Service management schemas
  addServiceToContractLineSchema,
  updateContractLineServiceSchema,
  
  // Contract management schemas
  createContractSchema,
  updateContractSchema,
  contractListQuerySchema,
  addContractLineSchema,
  updateContractAssociationSchema,
  
  // Client assignment schemas
  createClientContractLineSchema,
  updateClientContractLineSchema,
  clientContractLineListQuerySchema,
  createClientContractSchema,
  updateClientContractSchema,
  
  // Template and copying schemas
  copyContractLineSchema,
  createContractLineTemplateSchema,
  createContractLineFromTemplateSchema,
  
  // Activation schemas
  contractLineActivationSchema,
  clientContractLineActivationSchema,

  // Bulk operation schemas
  bulkCreateContractLinesSchema,
  bulkUpdateContractLinesSchema,
  bulkDeleteContractLinesSchema,
  bulkAddServicesToContractLineSchema,
  bulkRemoveServicesFromContractLineSchema,
  bulkAssignContractLinesToClientSchema,
  bulkUnassignContractLinesFromClientSchema,
  
  // Type exports
  CreateContractLineData,
  UpdateContractLineData,
  ContractLineResponse,
  CreateFixedContractLineConfigData,
  UpdateFixedContractLineConfigData,
  AddServiceToContractLineData,
  UpdateContractLineServiceData,
  CreateContractData,
  UpdateContractData,
  AddContractLineData,
  UpdateContractAssociationData,
  CreateClientContractLineData,
  UpdateClientContractLineData,
  CreateClientContractData,
  UpdateClientContractData,
  CopyContractLineData,
  CreateContractLineTemplateData,
  CreateContractLineFromTemplateData,
  ContractLineActivationData,
  ClientContractLineActivationData,
  BulkCreateContractLinesData,
  BulkUpdateContractLinesData,
  BulkDeleteContractLinesData,
  BulkAddServicesToContractLineData,
  BulkRemoveServicesFromContractLineData,
  BulkAssignContractLinesToClientData,
  BulkUnassignContractLinesFromClientData
} from '../schemas/contractLineSchemas';
import { z } from 'zod';
import { createApiResponse, createErrorResponse } from '../utils/response';
import { getHateoasLinks } from '../utils/hateoas';
import { requireRequestContext } from '../utils/requestContext';

export class ApiContractLineController {
  private contractLineService: ContractLineService;

  constructor() {
    this.contractLineService = new ContractLineService();
  }

  /**
   * GET /api/v2/contract-lines - List contract lines
   */
  list() {
    return async (req: NextRequest): Promise<NextResponse> => {
      const query = Object.fromEntries(new URL(req.url).searchParams.entries());
      const context = requireRequestContext(req);
      
      // Validate query parameters
      const validation = contractLineListQuerySchema.safeParse(query);
      if (!validation.success) {
        return createErrorResponse('Invalid query parameters', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const { page, limit, sort, order, ...filters } = validation.data;
      
      // Extract service options
      const includeAnalytics = query.include_analytics === 'true';
      const includeServices = query.include_services === 'true';
      const includeUsage = query.include_usage === 'true';
      const includeClients = query.include_clients === 'true';

      const serviceOptions: ContractLineServiceOptions = {
        includeAnalytics,
        includeServices,
        includeUsage,
        includeClients
      };

      const listOptions = { 
        page: page ? parseInt(page) : 1, 
        limit: limit ? parseInt(limit) : 25, 
        sort: sort || 'contract_line_name', 
        order: (order || 'asc') as 'asc' | 'desc',
        filters
      };
      
      const result = await this.contractLineService.listWithOptions(listOptions, context, serviceOptions);

      // Add HATEOAS links to each contract line
      const contractLinesWithLinks = result.data.map(contractLine => ({
        ...contractLine,
        _links: getHateoasLinks('contract-line', contractLine.contract_line_id!)
      }));

      const response = createApiResponse({
        data: contractLinesWithLinks,
        pagination: {
          page: listOptions.page,
          limit: listOptions.limit,
          total: result.total,
          totalPages: Math.ceil(result.total / listOptions.limit)
        },
        _links: {
          self: { href: `/api/v2/contract-lines` },
          create: { href: `/api/v2/contract-lines`, method: 'POST' }
        }
      });

      return NextResponse.json(response);
    };
  }

  /**
   * GET /api/v2/contract-lines/{id} - Get contract line details
   */
  getById() {
    return async (req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const requestContext = requireRequestContext(req);
      const url = new URL(req.url);
      
      // Parse service options from query parameters
      const serviceOptions: ContractLineServiceOptions = {
        includeAnalytics: url.searchParams.get('include_analytics') === 'true',
        includeServices: url.searchParams.get('include_services') === 'true',
        includeUsage: url.searchParams.get('include_usage') === 'true',
        includeClients: url.searchParams.get('include_clients') === 'true'
      };
      
      const contractLine = await this.contractLineService.getByIdWithOptions(params.id, requestContext, serviceOptions);

      if (!contractLine) {
        return createErrorResponse('Contract Line not found', 404);
      }

      const response = createApiResponse({
        data: {
          ...contractLine,
          _links: getHateoasLinks('contract-line', contractLine.contract_line_id!)
        }
      });

      return NextResponse.json(response);
    };
  }

  /**
   * POST /api/v2/contract-lines - Create new contract line
   */
  create() {
    return async (req: NextRequest): Promise<NextResponse> => {
      const data = await req.json();
      const context = requireRequestContext(req);
      
      // Validate request body
      const validation = createContractLineSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const contractLine = await this.contractLineService.create(validation.data, context);

      const response = createApiResponse({
        data: {
          ...contractLine,
          _links: getHateoasLinks('contract-line', contractLine.contract_line_id!)
        }
      }, 201);

      return NextResponse.json(response);
    };
  }

  /**
   * PUT /api/v2/contract-lines/{id} - Update contract line
   */
  update() {
    return async (req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const data = await req.json();
      const requestContext = requireRequestContext(req);
      
      // Validate request body
      const validation = updateContractLineSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const contractLine = await this.contractLineService.update(params.id, validation.data, requestContext);

      const response = createApiResponse({
        data: {
          ...contractLine,
          _links: getHateoasLinks('contract-line', contractLine.contract_line_id!)
        }
      });

      return NextResponse.json(response);
    };
  }

  /**
   * DELETE /api/v2/contract-lines/{id} - Delete contract line
   */
  delete() {
    return async (req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const requestContext = requireRequestContext(req);
      
      await this.contractLineService.delete(params.id, requestContext);
      
      return NextResponse.json(createApiResponse(null, 204));
    };
  }

  /**
   * GET /api/v2/contract-lines/{id}/services - Get contract line services
   */
  getContractLineServices() {
    return async (req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const requestContext = requireRequestContext(req);
      
      const services = await this.contractLineService.getContractLineServices(params.id, requestContext);
      
      const response = createApiResponse({
        data: services,
        _links: {
          self: { href: `/api/v2/contract-lines/${params.id}/services` },
          create: { href: `/api/v2/contract-lines/${params.id}/services`, method: 'POST' },
          parent: { href: `/api/v2/contract-lines/${params.id}` }
        }
      });

      return NextResponse.json(response);
    };
  }

  /**
   * POST /api/v2/contract-lines/{id}/services - Add service to contract line
   */
  addServiceToContractLine() {
    return async (req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const data = await req.json();
      const requestContext = requireRequestContext(req);

      // Validate request body
      const validation = addServiceToContractLineSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const serviceConfig = await this.contractLineService.addServiceToContractLine(params.id, validation.data, requestContext);
      
      const response = createApiResponse({ data: serviceConfig }, 201);
      return NextResponse.json(response);
    };
  }

  /**
   * PUT /api/v2/contract-lines/{contractLineId}/services/{serviceId} - Update service in contract line
   */
  updateContractLineService() {
    return async (req: NextRequest, context: { params: Promise<{ contractLineId: string; serviceId: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const data = await req.json();
      const requestContext = requireRequestContext(req);
      
      // Validate request body
      const validation = updateContractLineServiceSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const serviceConfig = await this.contractLineService.updateContractLineService(params.contractLineId, params.serviceId, validation.data, requestContext);
      
      const response = createApiResponse({ data: serviceConfig });
      return NextResponse.json(response);
    };
  }

  /**
   * DELETE /api/v2/contract-lines/{contractLineId}/services/{serviceId} - Remove service from contract line
   */
  removeServiceFromContractLine() {
    return async (req: NextRequest, context: { params: Promise<{ contractLineId: string; serviceId: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const requestContext = requireRequestContext(req);
      
      await this.contractLineService.removeServiceFromContractLine(params.contractLineId, params.serviceId, requestContext);
      
      return NextResponse.json(createApiResponse(null, 204));
    };
  }

  /**
   * GET /api/v2/contract-lines/{id}/fixed-config - Get fixed contract line configuration
   */
  getFixedContractLineConfig() {
    return async (req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const requestContext = requireRequestContext(req);

      const config = await this.contractLineService.getFixedContractLineConfig(params.id, requestContext);

      if (!config) {
        return createErrorResponse('Fixed contract line configuration not found', 404);
      }

      const response = createApiResponse({ data: config });
      return NextResponse.json(response);
    };
  }

  /**
   * PUT /api/v2/contract-lines/{id}/fixed-config - Update fixed contract line configuration
   */
  upsertFixedContractLineConfig() {
    return async (req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const data = await req.json();
      const requestContext = requireRequestContext(req);

      // Validate request body
      const validation = createFixedContractLineConfigSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const config = await this.contractLineService.upsertFixedContractLineConfig(params.id, validation.data, requestContext);
      
      const response = createApiResponse({ data: config });
      return NextResponse.json(response);
    };
  }

  /**
   * GET /api/v2/contract-lines/{contractLineId}/services/{serviceId}/config - Get combined configuration
   */
  getCombinedFixedContractLineConfig() {
    return async (req: NextRequest, context: { params: Promise<{ contractLineId: string; serviceId: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const requestContext = requireRequestContext(req);

      const config = await this.contractLineService.getCombinedFixedContractLineConfig(params.contractLineId, params.serviceId, requestContext);
      
      const response = createApiResponse({ data: config });
      return NextResponse.json(response);
    };
  }

  /**
   * PUT /api/v2/contract-lines/{id}/activation - Activate/deactivate contract line
   */
  setContractLineActivation() {
    return async (req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const data = await req.json();
      const requestContext = requireRequestContext(req);

      // Validate request body
      const validation = contractLineActivationSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const contractLine = await this.contractLineService.setContractLineActivation(params.id, validation.data, requestContext);

      const response = createApiResponse({ data: contractLine });
      return NextResponse.json(response);
    };
  }

  /**
   * POST /api/v2/contract-lines/{id}/copy - Copy existing contract line
   */
  copyContractLine() {
    return async (req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const data = await req.json();
      const requestContext = requireRequestContext(req);

      // Validate request body
      const validation = copyContractLineSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const newContractLine = await this.contractLineService.copyContractLine(validation.data, requestContext);

      const response = createApiResponse({
        data: {
          ...newContractLine,
          _links: getHateoasLinks('contract-line', newContractLine.contract_line_id!)
        }
      }, 201);

      return NextResponse.json(response);
    };
  }

  /**
   * GET /api/v2/contract-lines/{id}/analytics - Get contract line analytics
   */
  getContractLineAnalytics() {
    return async (req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const requestContext = requireRequestContext(req);

      const analytics = await this.contractLineService.getContractLineAnalytics(params.id, requestContext);
      
      const response = createApiResponse({ data: analytics });
      return NextResponse.json(response);
    };
  }

  /**
   * GET /api/v2/contract-lines/{id}/usage-metrics - Get usage metrics
   */
  getUsageMetrics() {
    return async (req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const requestContext = requireRequestContext(req);
      const url = new URL(req.url);
      
      const periodStart = new Date(url.searchParams.get('period_start') || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
      const periodEnd = new Date(url.searchParams.get('period_end') || new Date().toISOString());

      const metrics = await this.contractLineService.getUsageMetrics(params.id, periodStart, periodEnd, requestContext);
      
      const response = createApiResponse({ data: metrics });
      return NextResponse.json(response);
    };
  }

  /**
   * GET /api/v2/contracts - List contracts
   */
  listContracts() {
    return async (req: NextRequest): Promise<NextResponse> => {
      const query = Object.fromEntries(new URL(req.url).searchParams.entries());
      const context = requireRequestContext(req);
      
      // Validate query parameters
      const validation = contractListQuerySchema.safeParse(query);
      if (!validation.success) {
        return createErrorResponse('Invalid query parameters', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const { page, limit, sort, order, ...filters } = validation.data;
      const listOptions = { 
        page: page ? parseInt(page) : 1, 
        limit: limit ? parseInt(limit) : 25, 
        sort, 
        order: order as 'asc' | 'desc' | undefined,
        filters
      };
      
      // TODO: Implement listContracts in ContractLineService
      const result = { data: [], total: 0 };
      
      const response = createApiResponse({
        data: result.data,
        pagination: {
          page: listOptions.page,
          limit: listOptions.limit,
          total: result.total,
          totalPages: Math.ceil(result.total / listOptions.limit)
        },
        _links: {
          self: { href: `/api/v2/contracts` },
          create: { href: `/api/v2/contracts`, method: 'POST' }
        }
      });

      return NextResponse.json(response);
    };
  }

  /**
   * POST /api/v2/contracts - Create contract
   */
  createContract() {
    return async (req: NextRequest): Promise<NextResponse> => {
      const data = await req.json();
      const context = requireRequestContext(req);
      
      // Validate request body
      const validation = createContractSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const contract = await this.contractLineService.createContract(validation.data, context);
      
      const response = createApiResponse({ data: contract }, 201);
      return NextResponse.json(response);
    };
  }

  /**
   * POST /api/v2/contracts/{contractId}/contract-lines - Add contract line
   */
  addContractLine() {
    return async (req: NextRequest, context: { params: Promise<{ contractId: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const data = await req.json();
      const requestContext = requireRequestContext(req);
      
      // Validate request body
      const validation = addContractLineSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const contractLineMapping = await this.contractLineService.addContractLine(
        params.contractId, 
        validation.data.contract_line_id, 
        validation.data.custom_rate, 
        requestContext
      );
      
      const response = createApiResponse({ data: contractLineMapping }, 201);
      return NextResponse.json(response);
    };
  }

  /**
   * DELETE /api/v2/contracts/{contractId}/contract-lines/{contractLineId} - Remove contract line
   */
  removeContractLine() {
    return async (req: NextRequest, context: { params: Promise<{ contractId: string; contractLineId: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const requestContext = requireRequestContext(req);
      
      await this.contractLineService.removeContractLine(params.contractId, params.contractLineId, requestContext);
      
      return NextResponse.json(createApiResponse(null, 204));
    };
  }

  /**
   * GET /api/v2/client-contract-lines - List client contract line assignments
   */
  listClientContractLines() {
    return async (req: NextRequest): Promise<NextResponse> => {
      const query = Object.fromEntries(new URL(req.url).searchParams.entries());
      const context = requireRequestContext(req);
      
      // Validate query parameters
      const validation = clientContractLineListQuerySchema.safeParse(query);
      if (!validation.success) {
        return createErrorResponse('Invalid query parameters', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const { page, limit, sort, order, ...filters } = validation.data;
      const listOptions = { 
        page: page ? parseInt(page) : 1, 
        limit: limit ? parseInt(limit) : 25, 
        sort, 
        order: order as 'asc' | 'desc' | undefined,
        filters
      };
      
      // TODO: Implement listClientContractLines in ContractLineService
      const result = { data: [], total: 0 };
      
      const response = createApiResponse({
        data: result.data,
        pagination: {
          page: listOptions.page,
          limit: listOptions.limit,
          total: result.total,
          totalPages: Math.ceil(result.total / listOptions.limit)
        },
        _links: {
          self: { href: `/api/v2/client-contract-lines` },
          create: { href: `/api/v2/client-contract-lines`, method: 'POST' }
        }
      });

      return NextResponse.json(response);
    };
  }

  /**
   * POST /api/v2/client-contract-lines - Assign contract line to client
   */
  assignContractLineToClient() {
    return async (req: NextRequest): Promise<NextResponse> => {
      const data = await req.json();
      const context = requireRequestContext(req);

      // Validate request body
      const validation = createClientContractLineSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const assignment = await this.contractLineService.assignContractLineToClient(validation.data, context);
      
      const response = createApiResponse({ data: assignment }, 201);
      return NextResponse.json(response);
    };
  }

  /**
   * DELETE /api/v2/client-contract-lines/{id} - Unassign contract line from client
   */
  unassignContractLineFromClient() {
    return async (req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const requestContext = requireRequestContext(req);

      await this.contractLineService.unassignContractLineFromClient(params.id, requestContext);
      
      return NextResponse.json(createApiResponse(null, 204));
    };
  }

  /**
   * POST /api/v2/contract-line-templates - Create contract line template
   */
  createTemplate() {
    return async (req: NextRequest): Promise<NextResponse> => {
      const data = await req.json();
      const context = requireRequestContext(req);
      
      // Validate request body
      const validation = createContractLineTemplateSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const template = await this.contractLineService.createTemplate(validation.data, context);
      
      const response = createApiResponse({ data: template }, 201);
      return NextResponse.json(response);
    };
  }

  /**
   * POST /api/v2/contract-line-templates/{id}/create-contract-line - Create contract line from template
   */
  createFromTemplate() {
    return async (req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const data = await req.json();
      const requestContext = requireRequestContext(req);

      // Validate request body
      const validation = createContractLineFromTemplateSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const contractLine = await this.contractLineService.createFromTemplate(validation.data, requestContext);

      const response = createApiResponse({
        data: {
          ...contractLine,
          _links: getHateoasLinks('contract-line', contractLine.contract_line_id!)
        }
      }, 201);

      return NextResponse.json(response);
    };
  }

  /**
   * GET /api/v2/billing-analytics/overview - Get billing overview analytics
   */
  getBillingOverviewAnalytics() {
    return async (req: NextRequest): Promise<NextResponse> => {
      const context = requireRequestContext(req);
      
      const analytics = await this.contractLineService.getBillingOverviewAnalytics(context);
      
      const response = createApiResponse({ data: analytics });
      return NextResponse.json(response);
    };
  }

  /**
   * POST /api/v2/contract-lines/bulk/create - Bulk create contract lines
   */
  bulkCreateContractLines() {
    return async (req: NextRequest): Promise<NextResponse> => {
      const data = await req.json();
      const context = requireRequestContext(req);

      // Validate request body
      const validation = bulkCreateContractLinesSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const contractLines = await this.contractLineService.bulkCreateContractLines(validation.data, context);

      const response = createApiResponse({
        data: contractLines,
        count: contractLines.length
      }, 201);
      return NextResponse.json(response);
    };
  }

  /**
   * PUT /api/v2/contract-lines/bulk/update - Bulk update contract lines
   */
  bulkUpdateContractLines() {
    return async (req: NextRequest): Promise<NextResponse> => {
      const data = await req.json();
      const context = requireRequestContext(req);

      // Validate request body
      const validation = bulkUpdateContractLinesSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const contractLines = await this.contractLineService.bulkUpdateContractLines(validation.data, context);

      const response = createApiResponse({
        data: contractLines,
        count: contractLines.length
      });
      return NextResponse.json(response);
    };
  }

  /**
   * DELETE /api/v2/contract-lines/bulk/delete - Bulk delete contract lines
   */
  bulkDeleteContractLines() {
    return async (req: NextRequest): Promise<NextResponse> => {
      const data = await req.json();
      const context = requireRequestContext(req);

      // Validate request body
      const validation = bulkDeleteContractLinesSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      await this.contractLineService.bulkDeleteContractLines(validation.data, context);

      const response = createApiResponse({
        message: 'Contract lines deleted successfully',
        count: validation.data.contract_line_ids.length
      });
      return NextResponse.json(response);
    };
  }

  /**
   * POST /api/v2/contract-lines/bulk/add-services - Bulk add services to contract line
   */
  bulkAddServicesToContractLine() {
    return async (req: NextRequest): Promise<NextResponse> => {
      const data = await req.json();
      const context = requireRequestContext(req);

      // Validate request body
      const validation = bulkAddServicesToContractLineSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const results: { success: boolean; service_id: string; config?: any; error?: string }[] = [];
      for (const serviceData of validation.data.services) {
        try {
          const serviceConfig = await this.contractLineService.addServiceToContractLine(validation.data.contract_line_id, serviceData, context);
          results.push({ success: true, service_id: serviceData.service_id, config: serviceConfig });
        } catch (error: any) {
          results.push({ success: false, service_id: serviceData.service_id, error: error.message });
        }
      }
      
      const response = createApiResponse({ results, total: results.length });
      return NextResponse.json(response);
    };
  }

  /**
   * DELETE /api/v2/contract-lines/bulk/remove-services - Bulk remove services from contract line
   */
  bulkRemoveServicesFromContractLine() {
    return async (req: NextRequest): Promise<NextResponse> => {
      const data = await req.json();
      const context = requireRequestContext(req);

      // Validate request body
      const validation = bulkRemoveServicesFromContractLineSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const results: { success: boolean; service_id: string; error?: string }[] = [];
      for (const serviceId of validation.data.service_ids) {
        try {
          await this.contractLineService.removeServiceFromContractLine(validation.data.contract_line_id, serviceId, context);
          results.push({ success: true, service_id: serviceId });
        } catch (error: any) {
          results.push({ success: false, service_id: serviceId, error: error.message });
        }
      }
      
      const response = createApiResponse({ results, total: results.length });
      return NextResponse.json(response);
    };
  }
}
