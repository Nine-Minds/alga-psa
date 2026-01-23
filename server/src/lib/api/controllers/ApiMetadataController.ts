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
import { ZodError } from 'zod';

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
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          const query = this.validateMetadataQuery(apiRequest, metadataQuerySchema);

          const result = await this.metadataService.getApiEndpoints(query, apiRequest.context!.tenant);
          const validatedResult = apiEndpointsResponseSchema.parse(result);

          return createSuccessResponse(validatedResult.data, 200, {
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
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          const query = this.validateMetadataQuery(apiRequest, metadataQuerySchema);

          const result = await this.metadataService.getApiSchemas(query, apiRequest.context!.tenant);
          const validatedResult = apiSchemasResponseSchema.parse(result);

          return createSuccessResponse(validatedResult.data, 200, {
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
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          const result = await this.metadataService.getApiPermissions(apiRequest.context!.tenant);
          const validatedResult = apiPermissionsResponseSchema.parse(result);

          return createSuccessResponse(validatedResult.data, 200, {
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
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          const query = this.validateMetadataQuery(apiRequest, metadataQuerySchema);

          const result = await this.metadataService.generateOpenApiSpec(query, apiRequest.context!.tenant);
          const validatedResult = openApiResponseSchema.parse(result);

          // Set appropriate content type for OpenAPI spec
          const contentType = query.format === 'yaml' 
            ? 'application/x-yaml' 
            : 'application/json';

          return NextResponse.json(
            validatedResult.data,
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
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          const result = await this.metadataService.getApiHealth(apiRequest.context!.tenant);
          const validatedResult = apiHealthResponseSchema.parse(result);

          return createSuccessResponse(validatedResult.data, 200, {
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
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          const url = new URL(apiRequest.url);
          const period = url.searchParams.get('period') || '24h';

          const result = await this.metadataService.getApiStats(apiRequest.context!.tenant, period);
          const validatedResult = apiStatsResponseSchema.parse(result);

          return createSuccessResponse(validatedResult.data, 200, {
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
