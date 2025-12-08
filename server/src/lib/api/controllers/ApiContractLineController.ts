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
  createFixedPlanConfigSchema,
  updateFixedPlanConfigSchema,
  
  // Service management schemas
  addServiceToPlanSchema,
  updatePlanServiceSchema,
  
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
  createPlanTemplateSchema,
  createPlanFromTemplateSchema,
  
  // Activation schemas
  planActivationSchema,
  clientPlanActivationSchema,
  
  // Bulk operation schemas
  bulkCreateContractLinesSchema,
  bulkUpdateContractLinesSchema,
  bulkDeleteContractLinesSchema,
  bulkAddServicesToPlanSchema,
  bulkRemoveServicesFromPlanSchema,
  bulkAssignPlansToClientSchema,
  bulkUnassignPlansFromClientSchema,
  
  // Type exports
  CreateContractLineData,
  UpdateContractLineData,
  ContractLineResponse,
  CreateFixedPlanConfigData,
  UpdateFixedPlanConfigData,
  AddServiceToPlanData,
  UpdatePlanServiceData,
  CreateContractData,
  UpdateContractData,
  AddContractLineData,
  UpdateContractAssociationData,
  CreateClientContractLineData,
  UpdateClientContractLineData,
  CreateClientContractData,
  UpdateClientContractData,
  CopyContractLineData,
  CreatePlanTemplateData,
  CreatePlanFromTemplateData,
  PlanActivationData,
  ClientPlanActivationData,
  BulkCreateContractLinesData,
  BulkUpdateContractLinesData,
  BulkDeleteContractLinesData,
  BulkAddServicesToPlanData,
  BulkRemoveServicesFromPlanData,
  BulkAssignPlansToClientData,
  BulkUnassignPlansFromClientData
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
      const includeServices = query.include_services === 'true';
      const includeUsage = query.include_usage === 'true';
      const includeClients = query.include_clients === 'true';

      const serviceOptions: ContractLineServiceOptions = {
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
      
      // Add HATEOAS links to each plan
      const plansWithLinks = result.data.map(plan => ({
        ...plan,
        _links: getHateoasLinks('contract-line', plan.contract_line_id!)
      }));

      const response = createApiResponse({
        data: plansWithLinks,
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
        includeServices: url.searchParams.get('include_services') === 'true',
        includeUsage: url.searchParams.get('include_usage') === 'true',
        includeClients: url.searchParams.get('include_clients') === 'true'
      };
      
      const plan = await this.contractLineService.getByIdWithOptions(params.id, requestContext, serviceOptions);
      
      if (!plan) {
        return createErrorResponse('Contract Line not found', 404);
      }

      const response = createApiResponse({
        data: {
          ...plan,
          _links: getHateoasLinks('contract-line', plan.contract_line_id!)
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

      const plan = await this.contractLineService.create(validation.data, context);
      
      const response = createApiResponse({
        data: {
          ...plan,
          _links: getHateoasLinks('contract-line', plan.contract_line_id!)
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

      const plan = await this.contractLineService.update(params.id, validation.data, requestContext);
      
      const response = createApiResponse({
        data: {
          ...plan,
          _links: getHateoasLinks('contract-line', plan.contract_line_id!)
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
   * GET /api/v2/contract-lines/{id}/services - Get plan services
   */
  getPlanServices() {
    return async (req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const requestContext = requireRequestContext(req);
      
      const services = await this.contractLineService.getPlanServices(params.id, requestContext);
      
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
   * POST /api/v2/contract-lines/{id}/services - Add service to plan
   */
  addServiceToPlan() {
    return async (req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const data = await req.json();
      const requestContext = requireRequestContext(req);
      
      // Validate request body
      const validation = addServiceToPlanSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const serviceConfig = await this.contractLineService.addServiceToPlan(params.id, validation.data, requestContext);
      
      const response = createApiResponse({ data: serviceConfig }, 201);
      return NextResponse.json(response);
    };
  }

  /**
   * PUT /api/v2/contract-lines/{contractLineId}/services/{serviceId} - Update service in plan
   */
  updatePlanService() {
    return async (req: NextRequest, context: { params: Promise<{ contractLineId: string; serviceId: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const data = await req.json();
      const requestContext = requireRequestContext(req);
      
      // Validate request body
      const validation = updatePlanServiceSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const serviceConfig = await this.contractLineService.updatePlanService(params.contractLineId, params.serviceId, validation.data, requestContext);
      
      const response = createApiResponse({ data: serviceConfig });
      return NextResponse.json(response);
    };
  }

  /**
   * DELETE /api/v2/contract-lines/{contractLineId}/services/{serviceId} - Remove service from plan
   */
  removeServiceFromPlan() {
    return async (req: NextRequest, context: { params: Promise<{ contractLineId: string; serviceId: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const requestContext = requireRequestContext(req);
      
      await this.contractLineService.removeServiceFromPlan(params.contractLineId, params.serviceId, requestContext);
      
      return NextResponse.json(createApiResponse(null, 204));
    };
  }

  /**
   * GET /api/v2/contract-lines/{id}/fixed-config - Get fixed plan configuration
   */
  getFixedPlanConfig() {
    return async (req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const requestContext = requireRequestContext(req);
      
      const config = await this.contractLineService.getFixedPlanConfig(params.id, requestContext);
      
      if (!config) {
        return createErrorResponse('Fixed plan configuration not found', 404);
      }

      const response = createApiResponse({ data: config });
      return NextResponse.json(response);
    };
  }

  /**
   * PUT /api/v2/contract-lines/{id}/fixed-config - Update fixed plan configuration
   */
  upsertFixedPlanConfig() {
    return async (req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const data = await req.json();
      const requestContext = requireRequestContext(req);
      
      // Validate request body
      const validation = createFixedPlanConfigSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const config = await this.contractLineService.upsertFixedPlanConfig(params.id, validation.data, requestContext);
      
      const response = createApiResponse({ data: config });
      return NextResponse.json(response);
    };
  }

  /**
   * GET /api/v2/contract-lines/{contractLineId}/services/{serviceId}/config - Get combined configuration
   */
  getCombinedFixedPlanConfig() {
    return async (req: NextRequest, context: { params: Promise<{ contractLineId: string; serviceId: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const requestContext = requireRequestContext(req);
      
      const config = await this.contractLineService.getCombinedFixedPlanConfig(params.contractLineId, params.serviceId, requestContext);
      
      const response = createApiResponse({ data: config });
      return NextResponse.json(response);
    };
  }

  /**
   * PUT /api/v2/contract-lines/{id}/activation - Activate/deactivate plan
   */
  setPlanActivation() {
    return async (req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const data = await req.json();
      const requestContext = requireRequestContext(req);
      
      // Validate request body
      const validation = planActivationSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const plan = await this.contractLineService.setPlanActivation(params.id, validation.data, requestContext);
      
      const response = createApiResponse({ data: plan });
      return NextResponse.json(response);
    };
  }

  /**
   * POST /api/v2/contract-lines/{id}/copy - Copy existing plan
   */
  copyPlan() {
    return async (req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const data = await req.json();
      const requestContext = requireRequestContext(req);
      
      // Validate request body
      const validation = copyContractLineSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const newPlan = await this.contractLineService.copyPlan(validation.data, requestContext);
      
      const response = createApiResponse({
        data: {
          ...newPlan,
          _links: getHateoasLinks('contract-line', newPlan.contract_line_id!)
        }
      }, 201);

      return NextResponse.json(response);
    };
  }

  /**
   * GET /api/v2/contract-lines/{id}/analytics - Get plan analytics
   */
  getPlanAnalytics() {
    return async (req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const requestContext = requireRequestContext(req);
      
      const analytics = await this.contractLineService.getPlanAnalytics(params.id, requestContext);
      
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
   * POST /api/v2/client-contract-lines - Assign plan to client
   */
  assignPlanToClient() {
    return async (req: NextRequest): Promise<NextResponse> => {
      const data = await req.json();
      const context = requireRequestContext(req);
      
      // Validate request body
      const validation = createClientContractLineSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const assignment = await this.contractLineService.assignPlanToClient(validation.data, context);
      
      const response = createApiResponse({ data: assignment }, 201);
      return NextResponse.json(response);
    };
  }

  /**
   * DELETE /api/v2/client-contract-lines/{id} - Unassign plan from client
   */
  unassignPlanFromClient() {
    return async (req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const requestContext = requireRequestContext(req);
      
      await this.contractLineService.unassignPlanFromClient(params.id, requestContext);
      
      return NextResponse.json(createApiResponse(null, 204));
    };
  }

  /**
   * POST /api/v2/plan-templates - Create plan template
   */
  createTemplate() {
    return async (req: NextRequest): Promise<NextResponse> => {
      const data = await req.json();
      const context = requireRequestContext(req);
      
      // Validate request body
      const validation = createPlanTemplateSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const template = await this.contractLineService.createTemplate(validation.data, context);
      
      const response = createApiResponse({ data: template }, 201);
      return NextResponse.json(response);
    };
  }

  /**
   * POST /api/v2/plan-templates/{id}/create-plan - Create plan from template
   */
  createFromTemplate() {
    return async (req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
      const params = await context.params;
      const data = await req.json();
      const requestContext = requireRequestContext(req);
      
      // Validate request body
      const validation = createPlanFromTemplateSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const plan = await this.contractLineService.createFromTemplate(validation.data, requestContext);
      
      const response = createApiResponse({
        data: {
          ...plan,
          _links: getHateoasLinks('contract-line', plan.contract_line_id!)
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
   * POST /api/v2/contract-lines/bulk/create - Bulk create plans
   */
  bulkCreatePlans() {
    return async (req: NextRequest): Promise<NextResponse> => {
      const data = await req.json();
      const context = requireRequestContext(req);
      
      // Validate request body
      const validation = bulkCreateContractLinesSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const plans = await this.contractLineService.bulkCreateContractLines(validation.data, context);
      
      const response = createApiResponse({ 
        data: plans, 
        count: plans.length 
      }, 201);
      return NextResponse.json(response);
    };
  }

  /**
   * PUT /api/v2/contract-lines/bulk/update - Bulk update plans
   */
  bulkUpdatePlans() {
    return async (req: NextRequest): Promise<NextResponse> => {
      const data = await req.json();
      const context = requireRequestContext(req);
      
      // Validate request body
      const validation = bulkUpdateContractLinesSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const plans = await this.contractLineService.bulkUpdateContractLines(validation.data, context);
      
      const response = createApiResponse({ 
        data: plans, 
        count: plans.length 
      });
      return NextResponse.json(response);
    };
  }

  /**
   * DELETE /api/v2/contract-lines/bulk/delete - Bulk delete plans
   */
  bulkDeletePlans() {
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
        message: 'Plans deleted successfully', 
        count: validation.data.contract_line_ids.length 
      });
      return NextResponse.json(response);
    };
  }

  /**
   * POST /api/v2/contract-lines/bulk/add-services - Bulk add services to plan
   */
  bulkAddServicesToPlan() {
    return async (req: NextRequest): Promise<NextResponse> => {
      const data = await req.json();
      const context = requireRequestContext(req);
      
      // Validate request body
      const validation = bulkAddServicesToPlanSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const results: { success: boolean; service_id: string; config?: any; error?: string }[] = [];
      for (const serviceData of validation.data.services) {
        try {
          const serviceConfig = await this.contractLineService.addServiceToPlan(validation.data.contract_line_id, serviceData, context);
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
   * DELETE /api/v2/contract-lines/bulk/remove-services - Bulk remove services from plan
   */
  bulkRemoveServicesFromPlan() {
    return async (req: NextRequest): Promise<NextResponse> => {
      const data = await req.json();
      const context = requireRequestContext(req);
      
      // Validate request body
      const validation = bulkRemoveServicesFromPlanSchema.safeParse(data);
      if (!validation.success) {
        return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
      }

      const results: { success: boolean; service_id: string; error?: string }[] = [];
      for (const serviceId of validation.data.service_ids) {
        try {
          await this.contractLineService.removeServiceFromPlan(validation.data.contract_line_id, serviceId, context);
          results.push({ success: true, service_id: serviceId });
        } catch (error: any) {
          results.push({ success: false, service_id: serviceId, error: error.message });
        }
      }
      
      const response = createApiResponse({ results, total: results.length });
      return NextResponse.json(response);
    };
  }

  // ---------------------------------------------------------------------------
  // Legacy compatibility aliases (v1 route naming)
  // ---------------------------------------------------------------------------

  assignContractLineToClient() {
    return this.assignPlanToClient();
  }

  unassignContractLineFromClient() {
    return this.unassignPlanFromClient();
  }

  setContractLineActivation() {
    return this.setPlanActivation();
  }

  getContractLineAnalytics() {
    return this.getPlanAnalytics();
  }

  copyContractLine() {
    return this.copyPlan();
  }

  getFixedContractLineConfig() {
    return this.getFixedPlanConfig();
  }

  upsertFixedContractLineConfig() {
    return this.upsertFixedPlanConfig();
  }

  getContractLineServices() {
    return this.getPlanServices();
  }

  addServiceToContractLine() {
    return this.addServiceToPlan();
  }

  updateContractLineService() {
    return this.updatePlanService();
  }

  removeServiceFromContractLine() {
    return this.removeServiceFromPlan();
  }

  bulkAddServicesToContractLine() {
    return this.bulkAddServicesToPlan();
  }

  bulkRemoveServicesFromContractLine() {
    return this.bulkRemoveServicesFromPlan();
  }

  bulkCreateContractLines() {
    return this.bulkCreatePlans();
  }

  bulkUpdateContractLines() {
    return this.bulkUpdatePlans();
  }

  bulkDeleteContractLines() {
    return this.bulkDeletePlans();
  }
}
