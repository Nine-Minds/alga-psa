/**
 * API Metadata Controller V2
 * Simplified version with proper API key authentication
 */

import { NextRequest, NextResponse } from 'next/server';
import { ApiBaseController } from './ApiBaseController';
import { MetadataService } from '../services/MetadataService';
import { DatabaseService } from '../services/DatabaseService';
import { EventBusService } from '../services/EventBusService';
import { 
  metadataQuerySchema,
  apiEndpointsResponseSchema,
  apiSchemasResponseSchema,
  apiPermissionsResponseSchema,
  openApiResponseSchema,
  apiHealthResponseSchema,
  apiStatsResponseSchema
} from '../schemas/metadataSchemas';
import { ApiKeyServiceForApi } from '../../services/apiKeyServiceForApi';
import { findUserByIdForApi } from '@alga-psa/users/actions';
import { runWithTenant } from '../../db';
import { getConnection } from '../../db/db';
import { hasPermission } from '../../auth/rbac';
import {
  ApiRequest,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  createSuccessResponse,
  createPaginatedResponse,
  handleApiError
} from '../middleware/apiMiddleware';
import type { ApiPermissionInfo, ApiSchemaInfo, ApiStats } from '../schemas/metadataSchemas';
import { ZodError } from 'zod';
import { getTenantProduct } from '@/lib/productAccess';
import { isApiVisibleInMetadata } from '@/lib/productSurfaceRegistry';

export class ApiMetadataController extends ApiBaseController {
  private metadataService: MetadataService;

  constructor() {
    const metadataService = new MetadataService(
      new DatabaseService(),
      new EventBusService()
    );

    super(metadataService as any, {
      resource: 'metadata',
      permissions: {
        list: 'read',
        read: 'read',
        create: 'create',
        update: 'update',
        delete: 'delete'
      }
    });

    this.metadataService = metadataService;
  }

  /**
   * Validate query parameters
   */
  private validateMetadataQuery(req: ApiRequest, schema: any): any {
    try {
      const url = new URL(req.url);
      const query: Record<string, any> = {};
      url.searchParams.forEach((value, key) => {
        if (value === 'true') query[key] = true;
        else if (value === 'false') query[key] = false;
        else query[key] = value;
      });
      return schema.parse(query);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new ValidationError('Query validation failed', error.errors);
      }
      throw error;
    }
  }

  private async getApiMetadataProductCode(tenantId: string) {
    return getTenantProduct(tenantId);
  }

  private filterPermissionsForProduct(
    productCode: Awaited<ReturnType<typeof this.getApiMetadataProductCode>>,
    permissions: ApiPermissionInfo[],
  ): ApiPermissionInfo[] {
    if (productCode === 'psa') {
      return permissions;
    }

    return permissions
      .map((permission) => ({
        ...permission,
        endpoints: permission.endpoints.filter((endpoint) => endpoint.startsWith('/api/') && isApiVisibleInMetadata(productCode, endpoint)),
      }))
      .filter((permission) => permission.endpoints.length > 0);
  }

  private filterStatsForProduct(
    productCode: Awaited<ReturnType<typeof this.getApiMetadataProductCode>>,
    stats: ApiStats,
    visibleEndpoints: Array<{ path: string; method: string }>,
    visiblePermissionsCount: number,
    visibleSchemasCount: number,
  ): ApiStats {
    if (productCode === 'psa') {
      return stats;
    }

    const visibleByMethod: Record<string, number> = {};
    const visibleByCategory: Record<string, number> = {};
    const visiblePaths = visibleEndpoints.map((endpoint) => endpoint.path);

    visiblePaths.forEach((path) => {
      if (path.includes('/tickets')) {
        visibleByCategory.Tickets = (visibleByCategory.Tickets ?? 0) + 1;
      } else if (path.includes('/clients') || path.includes('/contacts')) {
        visibleByCategory.Clients = (visibleByCategory.Clients ?? 0) + 1;
      } else if (path.includes('/kb-articles')) {
        visibleByCategory['Knowledge Base'] = (visibleByCategory['Knowledge Base'] ?? 0) + 1;
      } else if (path.includes('/email')) {
        visibleByCategory.Email = (visibleByCategory.Email ?? 0) + 1;
      } else {
        visibleByCategory.Other = (visibleByCategory.Other ?? 0) + 1;
      }
    });

    visibleEndpoints.forEach(({ method }) => {
      visibleByMethod[method] = (visibleByMethod[method] ?? 0) + 1;
    });

    return {
      ...stats,
      totalEndpoints: visibleEndpoints.length,
      endpointsByCategory: visibleByCategory,
      endpointsByMethod: visibleByMethod,
      totalPermissions: visiblePermissionsCount,
      totalSchemas: visibleSchemasCount,
    };
  }

  private filterSchemasForProduct(
    productCode: Awaited<ReturnType<typeof this.getApiMetadataProductCode>>,
    schemas: ApiSchemaInfo[],
  ): ApiSchemaInfo[] {
    if (productCode === 'psa') {
      return schemas;
    }

    const deniedSchemaTerms = [
      'billing',
      'invoice',
      'quote',
      'contract',
      'project',
      'asset',
      'schedule',
      'timeentry',
      'time_entry',
      'timesheet',
      'time_sheet',
      'workflow',
      'survey',
      'extension',
      'accounting',
      'financial',
      'payment',
      'tax',
      'servicecatalog',
      'service_catalog',
      'servicetype',
      'service_type',
      'product',
    ];

    return schemas.filter((schema) => {
      const normalizedName = schema.name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      return !deniedSchemaTerms.some((term) => normalizedName.includes(term.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()));
    });
  }

  private getSchemaCategories(schemas: ApiSchemaInfo[]): string[] {
    const categories = new Set<string>();
    for (const schema of schemas) {
      const name = schema.name.toLowerCase();
      if (name.includes('ticket') || name.includes('comment')) categories.add('Tickets');
      else if (name.includes('client') || name.includes('contact')) categories.add('Clients');
      else if (name.includes('kb') || name.includes('knowledge')) categories.add('Knowledge Base');
      else if (name.includes('email')) categories.add('Email');
      else categories.add('Other');
    }
    return [...categories].sort();
  }

  private collectSchemaRefs(value: unknown, refs: Set<string>): void {
    if (!value || typeof value !== 'object') {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => this.collectSchemaRefs(item, refs));
      return;
    }

    const record = value as Record<string, unknown>;
    const refValue = typeof record.$ref === 'string' ? record.$ref : null;
    if (refValue?.startsWith('#/components/schemas/')) {
      refs.add(refValue.replace('#/components/schemas/', ''));
    }

    Object.values(record).forEach((entry) => this.collectSchemaRefs(entry, refs));
  }

  private filterOpenApiSchemasByVisiblePaths(
    productCode: Awaited<ReturnType<typeof this.getApiMetadataProductCode>>,
    spec: Record<string, any>,
  ): Record<string, any> {
    if (productCode === 'psa') {
      return spec;
    }

    const filteredPaths = spec.paths ?? {};
    const referencedSchemas = new Set<string>();
    this.collectSchemaRefs(filteredPaths, referencedSchemas);

    const allSchemas = (spec.components?.schemas ?? {}) as Record<string, any>;
    const filteredSchemas = Object.fromEntries(
      Object.entries(allSchemas).filter(([schemaName]) => referencedSchemas.has(schemaName)),
    );

    return {
      ...spec,
      components: {
        ...(spec.components ?? {}),
        schemas: filteredSchemas,
      },
    };
  }

  // ============================================================================
  // API ENDPOINT DISCOVERY
  // ============================================================================

  /**
   * GET /api/v1/meta/endpoints
   * List all available API endpoints with metadata
   */
  getEndpoints() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        await this.assertProductApiAccess(apiRequest);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          const query = this.validateMetadataQuery(apiRequest, metadataQuerySchema);

          const result = await this.metadataService.getApiEndpoints(query, apiRequest.context!.tenant);
          const validatedResult = apiEndpointsResponseSchema.parse(result);
          const productCode = await this.getApiMetadataProductCode(apiRequest.context!.tenant);
          const visibleEndpoints = validatedResult.data.endpoints.filter((endpoint) =>
            isApiVisibleInMetadata(productCode, endpoint.path),
          );

          return createSuccessResponse({
            ...validatedResult.data,
            endpoints: visibleEndpoints,
            totalEndpoints: visibleEndpoints.length,
          }, 200, {
            message: 'API endpoints retrieved successfully',
            ...validatedResult.meta
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // SCHEMA DISCOVERY
  // ============================================================================

  /**
   * GET /api/v1/meta/schemas
   * List all API schemas and data models
   */
  getSchemas() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        await this.assertProductApiAccess(apiRequest);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          const query = this.validateMetadataQuery(apiRequest, metadataQuerySchema);

          const result = await this.metadataService.getApiSchemas(query, apiRequest.context!.tenant);
          const validatedResult = apiSchemasResponseSchema.parse(result);
          const productCode = await this.getApiMetadataProductCode(apiRequest.context!.tenant);
          const visibleSchemas = this.filterSchemasForProduct(productCode, validatedResult.data.schemas);

          return createSuccessResponse({
            ...validatedResult.data,
            schemas: visibleSchemas,
            totalSchemas: visibleSchemas.length,
            categories: productCode === 'psa' ? validatedResult.data.categories : this.getSchemaCategories(visibleSchemas),
          }, 200, {
            message: 'API schemas retrieved successfully',
            ...validatedResult.meta
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // PERMISSION DISCOVERY
  // ============================================================================

  /**
   * GET /api/v1/meta/permissions
   * List all API permissions and access requirements
   */
  getPermissions() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        await this.assertProductApiAccess(apiRequest);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          const result = await this.metadataService.getApiPermissions(apiRequest.context!.tenant);
          const validatedResult = apiPermissionsResponseSchema.parse(result);
          const productCode = await this.getApiMetadataProductCode(apiRequest.context!.tenant);
          const visiblePermissions = this.filterPermissionsForProduct(
            productCode,
            validatedResult.data.permissions,
          );
          const categories = [...new Set(visiblePermissions.map((permission) => permission.category))].sort();

          return createSuccessResponse({
            ...validatedResult.data,
            permissions: visiblePermissions,
            totalPermissions: visiblePermissions.length,
            categories,
          }, 200, {
            message: 'API permissions retrieved successfully'
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // OPENAPI SPECIFICATION
  // ============================================================================

  /**
   * GET /api/v1/meta/openapi
   * Generate OpenAPI 3.0 specification for the entire API
   */
  getOpenApiSpec() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        await this.assertProductApiAccess(apiRequest);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          const query = this.validateMetadataQuery(apiRequest, metadataQuerySchema);

          const result = await this.metadataService.generateOpenApiSpec(query, apiRequest.context!.tenant);
          const validatedResult = openApiResponseSchema.parse(result);
          const productCode = await this.getApiMetadataProductCode(apiRequest.context!.tenant);
          const filteredPaths = Object.fromEntries(
            Object.entries(validatedResult.data.paths).filter(([apiPath]) =>
              isApiVisibleInMetadata(productCode, apiPath),
            ),
          );

          // Set appropriate content type for OpenAPI spec
          const contentType = query.format === 'yaml' 
            ? 'application/x-yaml' 
            : 'application/json';

          const filteredSpec = this.filterOpenApiSchemasByVisiblePaths(productCode, {
            ...validatedResult.data,
            paths: filteredPaths,
          });

          return NextResponse.json(
            filteredSpec,
            {
              status: 200,
              headers: {
                'Content-Type': contentType,
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'public, max-age=300' // 5 minutes cache
              }
            }
          );
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // API HEALTH AND STATISTICS
  // ============================================================================

  /**
   * GET /api/v1/meta/health
   * Get API health status and service availability
   */
  getHealth() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        await this.assertProductApiAccess(apiRequest);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          const result = await this.metadataService.getApiHealth(apiRequest.context!.tenant);
          const validatedResult = apiHealthResponseSchema.parse(result);
          const productCode = await this.getApiMetadataProductCode(apiRequest.context!.tenant);
          let data = validatedResult.data;

          if (productCode !== 'psa' && data.metrics) {
            const endpointsResult = await this.metadataService.getApiEndpoints(
              {
                format: 'json',
                includeExamples: false,
                includeSchemas: false,
              },
              apiRequest.context!.tenant,
            );
            const visibleEndpointCount = endpointsResult.data.endpoints.filter((endpoint) =>
              isApiVisibleInMetadata(productCode, endpoint.path),
            ).length;
            data = {
              ...data,
              metrics: {
                ...data.metrics,
                totalEndpoints: visibleEndpointCount,
              },
            };
          }

          return createSuccessResponse(data, 200, {
            message: 'API health status retrieved successfully'
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * GET /api/v1/meta/stats
   * Get API usage statistics and metrics
   */
  getStats() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        await this.assertProductApiAccess(apiRequest);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          const url = new URL(apiRequest.url);
          const period = url.searchParams.get('period') || '24h';

          const result = await this.metadataService.getApiStats(apiRequest.context!.tenant, period);
          const validatedResult = apiStatsResponseSchema.parse(result);
          const productCode = await this.getApiMetadataProductCode(apiRequest.context!.tenant);
          const endpointsResult = await this.metadataService.getApiEndpoints(
            {
              format: 'json',
              includeExamples: false,
              includeSchemas: false,
            },
            apiRequest.context!.tenant,
          );
          const visibleEndpoints = endpointsResult.data.endpoints
            .map((endpoint) => ({ path: endpoint.path, method: endpoint.method }))
            .filter((endpoint) => isApiVisibleInMetadata(productCode, endpoint.path));
          const permissionsResult = await this.metadataService.getApiPermissions(apiRequest.context!.tenant);
          const visiblePermissions = this.filterPermissionsForProduct(
            productCode,
            permissionsResult.data.permissions,
          );
          const schemasResult = await this.metadataService.getApiSchemas(
            {
              format: 'json',
              includeExamples: false,
              includeSchemas: true,
            },
            apiRequest.context!.tenant,
          );
          const visibleSchemas = this.filterSchemasForProduct(productCode, schemasResult.data.schemas);
          const filteredStats = this.filterStatsForProduct(
            productCode,
            validatedResult.data,
            visibleEndpoints,
            visiblePermissions.length,
            visibleSchemas.length,
          );

          return createSuccessResponse(filteredStats, 200, {
            message: 'API statistics retrieved successfully',
            ...validatedResult.meta
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // API DOCUMENTATION
  // ============================================================================

  /**
   * GET /api/v1/meta/docs
   * Serve interactive API documentation (Swagger UI)
   */
  getDocs() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        await this.assertProductApiAccess(apiRequest);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          const url = new URL(apiRequest.url);
          const format = url.searchParams.get('format') || 'html';

          if (format === 'html') {
            return new NextResponse(this.generateSwaggerUI(), {
              status: 200,
              headers: {
                'Content-Type': 'text/html',
                'Cache-Control': 'public, max-age=3600' // 1 hour cache
              }
            });
          } else {
            // Redirect to OpenAPI spec for other formats
            return NextResponse.redirect(new URL('/api/v1/meta/openapi', apiRequest.nextUrl.origin));
          }
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Generate and download SDK for specified language
   */
  generateSdk() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        await this.assertProductApiAccess(apiRequest);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          const url = new URL(apiRequest.url);
          const language = url.searchParams.get('language') as 'typescript' | 'javascript' | 'python' | 'java' || 'typescript';
          const packageName = url.searchParams.get('package_name') || '@alga-psa/api-client';
          const version = url.searchParams.get('version') || '1.0.0';
          const format = url.searchParams.get('format') || 'zip';

          const { SdkGeneratorService } = await import('../services/SdkGeneratorService');

          const config = {
            language,
            packageName,
            version,
            author: 'Alga PSA',
            description: `${language === 'typescript' ? 'TypeScript' : 'JavaScript'} SDK for Alga PSA API with full HATEOAS support`,
            includeHateoas: true,
            includeExamples: true,
            outputFormat: format as any
          };

          let sdk;
          if (language === 'typescript') {
            sdk = await SdkGeneratorService.generateTypeScriptSdk(config);
          } else if (language === 'javascript') {
            sdk = await SdkGeneratorService.generateJavaScriptSdk(config);
          } else {
            return NextResponse.json({
              success: false,
              error: {
                code: 'UNSUPPORTED_LANGUAGE',
                message: `Language '${language}' is not yet supported. Available: typescript, javascript`
              }
            }, {
              status: 400
            });
          }

          if (format === 'zip') {
            // In a real implementation, you'd create a ZIP file
            // For now, return the file structure as JSON
            return NextResponse.json({
              success: true,
              data: {
                sdk_info: {
                  language: sdk.language,
                  packageName: sdk.packageName,
                  version: sdk.version,
                  installInstructions: sdk.installInstructions,
                  usageExample: sdk.usageExample
                },
                files: sdk.files,
                download_instructions: {
                  message: "Extract the files below to create your SDK package",
                  steps: [
                    "1. Create a new directory for your SDK",
                    "2. Save each file with its specified path",
                    "3. Run 'npm install' to install dependencies",
                    language === 'typescript' ? "4. Run 'npm run build' to compile TypeScript" : "4. SDK is ready to use",
                    "5. Import and use the AlgaPSAClient in your code"
                  ]
                }
              }
            }, {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'Content-Disposition': `attachment; filename="${packageName}-${version}.json"`
              }
            });
          } else {
            return NextResponse.json({
              success: true,
              data: sdk
            }, {
              status: 200
            });
          }
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  private convertToYaml(obj: any): string {
    // Simple YAML conversion - in production, use a proper YAML library
    return JSON.stringify(obj, null, 2)
      .replace(/"/g, '')
      .replace(/,$/gm, '')
      .replace(/^\s*{/gm, '')
      .replace(/^\s*}/gm, '');
  }

  private generateSwaggerUI(): string {
    // Import and use the enhanced documentation service
    return require('../services/DocumentationService').DocumentationService.generateEnhancedSwaggerUI();
  }
}
