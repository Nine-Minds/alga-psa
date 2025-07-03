/**
 * API Metadata Controller
 * Handles API discovery, documentation, and metadata endpoints
 */

import { NextRequest } from 'next/server';
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
import { createErrorResponse, createApiResponse } from '../utils/response';
import { withAuth, handleApiError } from '../middleware/apiMiddleware';

export class MetadataController {
  private metadataService: MetadataService;

  constructor() {
    // Initialize services
    this.metadataService = new MetadataService(
      new DatabaseService(),
      new EventBusService()
    );
  }

  private async getContext(request: NextRequest) {
    // Extract tenant from API key or request headers
    // For now, use a default tenant - in production this would be extracted from auth
    return {
      tenant: 'default',
      userId: 'system'
    };
  }

  private validateQuery(searchParams: URLSearchParams, schema: any) {
    const query: any = {};
    
    // Extract query parameters
    for (const [key, value] of searchParams.entries()) {
      if (value === 'true') query[key] = true;
      else if (value === 'false') query[key] = false;
      else query[key] = value;
    }
    
    return schema.parse(query);
  }

  // ============================================================================
  // API ENDPOINT DISCOVERY
  // ============================================================================

  /**
   * GET /api/v1/meta/endpoints
   * List all available API endpoints with metadata
   */
  async getEndpoints(request: NextRequest, searchParams: URLSearchParams) {
    try {
      const context = await this.getContext(request);
      const query = this.validateQuery(searchParams, metadataQuerySchema);

      const result = await this.metadataService.getApiEndpoints(query, context.tenant);
      const validatedResult = apiEndpointsResponseSchema.parse(result);

      return createApiResponse(validatedResult.data, 200, {
        message: 'API endpoints retrieved successfully',
        ...validatedResult.meta
      });
    } catch (error) {
      return this.handleError(error, 'Failed to retrieve API endpoints');
    }
  }

  // ============================================================================
  // SCHEMA DISCOVERY
  // ============================================================================

  /**
   * GET /api/v1/meta/schemas
   * List all API schemas and data models
   */
  async getSchemas(request: NextRequest, searchParams: URLSearchParams) {
    try {
      const context = await this.getContext(request);
      const query = this.validateQuery(searchParams, metadataQuerySchema);

      const result = await this.metadataService.getApiSchemas(query, context.tenant);
      const validatedResult = apiSchemasResponseSchema.parse(result);

      return createApiResponse(validatedResult.data, 200, {
        message: 'API schemas retrieved successfully',
        ...validatedResult.meta
      });
    } catch (error) {
      return this.handleError(error, 'Failed to retrieve API schemas');
    }
  }

  // ============================================================================
  // PERMISSION DISCOVERY
  // ============================================================================

  /**
   * GET /api/v1/meta/permissions
   * List all API permissions and access requirements
   */
  async getPermissions(request: NextRequest) {
    try {
      const context = await this.getContext(request);

      const result = await this.metadataService.getApiPermissions(context.tenant);
      const validatedResult = apiPermissionsResponseSchema.parse(result);

      return createApiResponse(validatedResult.data, 200, {
        message: 'API permissions retrieved successfully'
      });
    } catch (error) {
      return this.handleError(error, 'Failed to retrieve API permissions');
    }
  }

  // ============================================================================
  // OPENAPI SPECIFICATION
  // ============================================================================

  /**
   * GET /api/v1/meta/openapi
   * Generate OpenAPI 3.0 specification for the entire API
   */
  async getOpenApiSpec(request: NextRequest, searchParams: URLSearchParams) {
    try {
      const context = await this.getContext(request);
      const query = this.validateQuery(searchParams, metadataQuerySchema);

      const result = await this.metadataService.generateOpenApiSpec(query, context.tenant);
      const validatedResult = openApiResponseSchema.parse(result);

      // Set appropriate content type for OpenAPI spec
      const contentType = query.format === 'yaml' 
        ? 'application/x-yaml' 
        : 'application/json';

      return new Response(
        query.format === 'yaml' 
          ? this.convertToYaml(validatedResult.data)
          : JSON.stringify(validatedResult.data, null, 2),
        {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=300' // 5 minutes cache
          }
        }
      );
    } catch (error) {
      return this.handleError(error, 'Failed to generate OpenAPI specification');
    }
  }

  // ============================================================================
  // API HEALTH AND STATISTICS
  // ============================================================================

  /**
   * GET /api/v1/meta/health
   * Get API health status and service availability
   */
  async getHealth(request: NextRequest) {
    try {
      const context = await this.getContext(request);

      const result = await this.metadataService.getApiHealth(context.tenant);
      const validatedResult = apiHealthResponseSchema.parse(result);

      return createApiResponse(validatedResult.data, 200, {
        message: 'API health status retrieved successfully'
      });
    } catch (error) {
      return this.handleError(error, 'Failed to retrieve API health status');
    }
  }

  /**
   * GET /api/v1/meta/stats
   * Get API usage statistics and metrics
   */
  async getStats(request: NextRequest, searchParams: URLSearchParams) {
    try {
      const context = await this.getContext(request);
      const period = searchParams.get('period') || '24h';

      const result = await this.metadataService.getApiStats(context.tenant, period);
      const validatedResult = apiStatsResponseSchema.parse(result);

      return createApiResponse(validatedResult.data, 200, {
        message: 'API statistics retrieved successfully',
        ...validatedResult.meta
      });
    } catch (error) {
      return this.handleError(error, 'Failed to retrieve API statistics');
    }
  }

  // ============================================================================
  // API DOCUMENTATION
  // ============================================================================

  /**
   * GET /api/v1/meta/docs
   * Serve interactive API documentation (Swagger UI)
   */
  async getDocs(request: NextRequest, searchParams: URLSearchParams) {
    try {
      const format = searchParams.get('format') || 'html';

      if (format === 'html') {
        return new Response(this.generateSwaggerUI(), {
          status: 200,
          headers: {
            'Content-Type': 'text/html',
            'Cache-Control': 'public, max-age=3600' // 1 hour cache
          }
        });
      } else {
        // Redirect to OpenAPI spec for other formats
        return Response.redirect(new URL('/api/v1/meta/openapi', request.nextUrl.origin));
      }
    } catch (error) {
      return this.handleError(error, 'Failed to serve API documentation');
    }
  }
  
    /**
     * Generate and download SDK for specified language
     */
    async generateSdk(request: NextRequest, searchParams: URLSearchParams) {
      try {
        const language = searchParams.get('language') as 'typescript' | 'javascript' | 'python' | 'java' || 'typescript';
        const packageName = searchParams.get('package_name') || '@alga-psa/api-client';
        const version = searchParams.get('version') || '1.0.0';
        const format = searchParams.get('format') || 'zip';
  
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
          return new Response(JSON.stringify({
            success: false,
            error: {
              code: 'UNSUPPORTED_LANGUAGE',
              message: `Language '${language}' is not yet supported. Available: typescript, javascript`
            }
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }
  
        if (format === 'zip') {
          // In a real implementation, you'd create a ZIP file
          // For now, return the file structure as JSON
          return new Response(JSON.stringify({
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
          }), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Content-Disposition': `attachment; filename="${packageName}-${version}.json"`
            }
          });
        } else {
          return new Response(JSON.stringify({
            success: true,
            data: sdk
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      } catch (error) {
        return this.handleError(error, 'Failed to generate SDK');
      }
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


  private handleError(error: any, defaultMessage: string) {
    console.error('MetadataController error:', error);
    
    if (error.name === 'ZodError') {
      return createErrorResponse('Validation failed', 400, error.errors);
    }
    
    return createErrorResponse(
      error.message || defaultMessage,
      error.status || 500
    );
  }
}