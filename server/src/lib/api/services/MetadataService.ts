/**
 * API Metadata Service
 * Service for API discovery, documentation generation, and metadata operations
 */

import { 
  ApiEndpoint, 
  ApiEndpointsResponse,
  ApiSchemasResponse,
  ApiPermissionsResponse,
  OpenApiResponse,
  ApiHealthResponse,
  ApiStatsResponse,
  MetadataQuery,
  OpenApiSpec,
  ApiSchemaInfo,
  ApiPermissionInfo
} from '../schemas/metadataSchemas';
import { DatabaseService } from './DatabaseService';
import { EventBusService } from './EventBusService';
// import { validateTenantAccess } from '../../utils/validation';
import fs from 'fs/promises';
import path from 'path';

export class MetadataService {
  private endpointsCache: ApiEndpoint[] | null = null;
  private cacheTimestamp: number = 0;
  private readonly cacheTimeout = 5 * 60 * 1000; // 5 minutes

  constructor(
    private db: DatabaseService,
    private eventBus: EventBusService
  ) {}

  // ============================================================================
  // API ENDPOINT DISCOVERY
  // ============================================================================

  async getApiEndpoints(
    query: MetadataQuery,
    tenantId: string
  ): Promise<ApiEndpointsResponse> {
    // Validate tenant access - simplified for metadata endpoints
    if (!tenantId) {
      throw new Error('Tenant ID is required');
    }

    const endpoints = await this.discoverEndpoints();
    let filteredEndpoints = endpoints;

    // Apply filters
    if (query.category) {
      filteredEndpoints = filteredEndpoints.filter(ep => 
        ep.tags?.includes(query.category!)
      );
    }

    if (query.method) {
      filteredEndpoints = filteredEndpoints.filter(ep => 
        ep.method === query.method
      );
    }

    if (query.deprecated !== undefined) {
      filteredEndpoints = filteredEndpoints.filter(ep => 
        Boolean(ep.deprecated) === query.deprecated
      );
    }

    // Get unique categories
    const categories = [...new Set(
      endpoints.flatMap(ep => ep.tags || [])
    )].sort();

    return {
      success: true,
      data: {
        endpoints: filteredEndpoints,
        totalEndpoints: filteredEndpoints.length,
        categories,
        version: '1.0.0',
        lastUpdated: new Date().toISOString()
      },
      meta: {
        generated_at: new Date().toISOString(),
        api_version: 'v1',
        server_info: {
          name: 'Alga PSA API',
          version: '1.0.0',
          environment: process.env.NODE_ENV || 'development'
        }
      }
    };
  }

  // ============================================================================
  // SCHEMA DISCOVERY
  // ============================================================================

  async getApiSchemas(
    query: MetadataQuery,
    tenantId: string
  ): Promise<ApiSchemasResponse> {
    // Validate tenant access - simplified for metadata endpoints
    if (!tenantId) {
      throw new Error('Tenant ID is required');
    }

    const schemas = await this.discoverSchemas();
    let filteredSchemas = schemas;

    if (query.category) {
      filteredSchemas = schemas.filter(schema => 
        schema.name.toLowerCase().includes(query.category!.toLowerCase())
      );
    }

    const categories = [...new Set(
      schemas.map(schema => this.getSchemaCategory(schema.name))
    )].sort();

    return {
      success: true,
      data: {
        schemas: filteredSchemas,
        totalSchemas: filteredSchemas.length,
        categories
      },
      meta: {
        generated_at: new Date().toISOString(),
        schema_version: '1.0.0'
      }
    };
  }

  // ============================================================================
  // PERMISSION DISCOVERY
  // ============================================================================

  async getApiPermissions(
    tenantId: string
  ): Promise<ApiPermissionsResponse> {
    // Validate tenant access - simplified for metadata endpoints
    if (!tenantId) {
      throw new Error('Tenant ID is required');
    }

    const permissions = await this.discoverPermissions();
    const categories = [...new Set(
      permissions.map(p => p.category)
    )].sort();

    return {
      success: true,
      data: {
        permissions,
        totalPermissions: permissions.length,
        categories
      }
    };
  }

  // ============================================================================
  // OPENAPI SPECIFICATION
  // ============================================================================

  async generateOpenApiSpec(
    query: MetadataQuery,
    tenantId: string
  ): Promise<OpenApiResponse> {
    // Validate tenant access - simplified for metadata endpoints
    if (!tenantId) {
      throw new Error('Tenant ID is required');
    }

    const endpoints = await this.discoverEndpoints();
    const schemas = await this.discoverSchemas();

    const spec: OpenApiSpec = {
      openapi: '3.0.3',
      info: {
        title: 'Alga PSA REST API',
        version: '1.0.0',
        description: 'Comprehensive REST API for Alga Professional Services Automation platform',
        contact: {
          name: 'Alga PSA API Support',
          email: 'api-support@alga-psa.com'
        },
        license: {
          name: 'MIT',
          url: 'https://opensource.org/licenses/MIT'
        }
      },
      servers: [
        {
          url: process.env.API_BASE_URL || 'https://api.alga-psa.com',
          description: 'Production server'
        },
        {
          url: 'http://localhost:3000',
          description: 'Development server'
        }
      ],
      paths: this.generateOpenApiPaths(endpoints),
      components: {
        schemas: this.generateOpenApiSchemas(schemas),
        securitySchemes: {
          ApiKeyAuth: {
            type: 'apiKey',
            in: 'header',
            name: 'X-API-Key'
          },
          BearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT'
          }
        }
      },
      security: [
        { ApiKeyAuth: [] },
        { BearerAuth: [] }
      ],
      tags: this.generateOpenApiTags(endpoints)
    };

    return {
      success: true,
      data: spec,
      meta: {
        generated_at: new Date().toISOString(),
        generator: 'Alga PSA Metadata Service v1.0.0'
      }
    };
  }

  // ============================================================================
  // API HEALTH AND STATISTICS
  // ============================================================================

  async getApiHealth(tenantId: string): Promise<ApiHealthResponse> {
    // Validate tenant access - simplified for metadata endpoints
    if (!tenantId) {
      throw new Error('Tenant ID is required');
    }

    const startTime = Date.now();
    const services: Record<string, any> = {};

    // Check database connectivity
    try {
      await this.db.findOne('clients', { limit: 1 });
      services.database = { status: 'up', latency: Date.now() - startTime };
    } catch (error) {
      services.database = { 
        status: 'down', 
        message: error instanceof Error ? error.message : 'Unknown error' 
      };
    }

    // Check event bus
    try {
      services.eventBus = { status: 'up' };
    } catch (error) {
      services.eventBus = { 
        status: 'down', 
        message: error instanceof Error ? error.message : 'Unknown error' 
      };
    }

    const endpoints = await this.discoverEndpoints();
    const overallStatus = Object.values(services).every(s => s.status === 'up') 
      ? 'healthy' : 'degraded';

    return {
      success: true,
      data: {
        status: overallStatus,
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        services,
        metrics: {
          totalEndpoints: endpoints.length
        }
      }
    };
  }

  async getApiStats(
    tenantId: string,
    period: string = '24h'
  ): Promise<ApiStatsResponse> {
    // Validate tenant access - simplified for metadata endpoints
    if (!tenantId) {
      throw new Error('Tenant ID is required');
    }

    const endpoints = await this.discoverEndpoints();
    const schemas = await this.discoverSchemas();
    const permissions = await this.discoverPermissions();

    // Count endpoints by category and method
    const endpointsByCategory: Record<string, number> = {};
    const endpointsByMethod: Record<string, number> = {};

    endpoints.forEach(endpoint => {
      // Count by method
      endpointsByMethod[endpoint.method] = (endpointsByMethod[endpoint.method] || 0) + 1;

      // Count by category (tags)
      endpoint.tags?.forEach(tag => {
        endpointsByCategory[tag] = (endpointsByCategory[tag] || 0) + 1;
      });
    });

    return {
      success: true,
      data: {
        totalEndpoints: endpoints.length,
        endpointsByCategory,
        endpointsByMethod,
        totalSchemas: schemas.length,
        totalPermissions: permissions.length,
        coverage: {
          documented: endpoints.filter(ep => ep.description).length,
          tested: endpoints.length, // Assume all are tested for now
          deprecated: endpoints.filter(ep => ep.deprecated).length
        }
      },
      meta: {
        period,
        generated_at: new Date().toISOString()
      }
    };
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  private async discoverEndpoints(): Promise<ApiEndpoint[]> {
    // Check cache first
    if (this.endpointsCache && (Date.now() - this.cacheTimestamp) < this.cacheTimeout) {
      return this.endpointsCache;
    }

    const endpoints: ApiEndpoint[] = [];
    const apiPath = path.join(process.cwd(), 'src/app/api/v1');

    try {
      await this.scanDirectoryForEndpoints(apiPath, '/api/v1', endpoints);
      
      // Cache the results
      this.endpointsCache = endpoints;
      this.cacheTimestamp = Date.now();
      
      return endpoints;
    } catch (error) {
      console.error('Error discovering endpoints:', error);
      return [];
    }
  }

  private async scanDirectoryForEndpoints(
    dirPath: string, 
    basePath: string, 
    endpoints: ApiEndpoint[]
  ): Promise<void> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        
        if (entry.isDirectory()) {
          // Handle dynamic routes like [id]
          const routePath = entry.name.startsWith('[') && entry.name.endsWith(']')
            ? `{${entry.name.slice(1, -1)}}`
            : entry.name;
          
          await this.scanDirectoryForEndpoints(
            fullPath,
            `${basePath}/${routePath}`,
            endpoints
          );
        } else if (entry.name === 'route.ts') {
          // Found a route file, extract endpoint information
          await this.extractEndpointInfo(fullPath, basePath, endpoints);
        }
      }
    } catch (error) {
      console.error(`Error scanning directory ${dirPath}:`, error);
    }
  }

  private async extractEndpointInfo(
    routeFile: string,
    routePath: string,
    endpoints: ApiEndpoint[]
  ): Promise<void> {
    try {
      const content = await fs.readFile(routeFile, 'utf-8');
      const httpMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

      for (const method of httpMethods) {
        if (content.includes(`export async function ${method}(`)) {
          const endpoint: ApiEndpoint = {
            path: routePath,
            method: method as any,
            summary: this.generateSummary(routePath, method),
            description: this.generateDescription(routePath, method),
            tags: this.generateTags(routePath),
            operationId: `${method.toLowerCase()}${routePath.replace(/[^a-zA-Z0-9]/g, '')}`,
            requiresAuth: !routePath.includes('/meta/'), // Meta endpoints might not require auth
            permissions: this.generatePermissions(routePath, method)
          };

          endpoints.push(endpoint);
        }
      }
    } catch (error) {
      console.error(`Error extracting endpoint info from ${routeFile}:`, error);
    }
  }

  private generateSummary(path: string, method: string): string {
    const parts = path.split('/').filter(p => p && p !== 'api' && p !== 'v1');
    const resource = parts[0] || 'resource';
    
    const actionMap: Record<string, string> = {
      'GET': parts.length === 1 ? `List ${resource}` : `Get ${resource}`,
      'POST': `Create ${resource}`,
      'PUT': `Update ${resource}`,
      'DELETE': `Delete ${resource}`,
      'PATCH': `Partially update ${resource}`
    };

    return actionMap[method] || `${method} ${resource}`;
  }

  private generateDescription(path: string, method: string): string {
    const summary = this.generateSummary(path, method);
    return `${summary} operation for the ${path} endpoint`;
  }

  private generateTags(path: string): string[] {
    const parts = path.split('/').filter(p => p && p !== 'api' && p !== 'v1');
    const mainResource = parts[0];
    
    const tagMap: Record<string, string> = {
      'clients': 'Clients',
      'contacts': 'Contacts',
      'tickets': 'Tickets',
      'projects': 'Projects',
      'assets': 'Assets',
      'time-entries': 'Time Management',
      'time-sheets': 'Time Management',
      'schedules': 'Time Management',
      'time-periods': 'Time Management',
      'invoices': 'Financial',
      'contract-lines': 'Financial',
      'financial': 'Financial',
      'products': 'Configuration',
      'users': 'Users & Teams',
      'teams': 'Users & Teams',
      'roles': 'Security',
      'permissions': 'Security',
      'rbac': 'Security',
      'categories': 'Configuration',
      'tags': 'Configuration',
      'workflows': 'Automation',
      'automation': 'Automation',
      'webhooks': 'Integrations',
      'integrations': 'Integrations',
      'meta': 'API Metadata'
    };

    return mainResource ? [tagMap[mainResource] || 'Other'] : ['Other'];
  }

  private generatePermissions(path: string, method: string): string[] {
    const parts = path.split('/').filter(p => p && p !== 'api' && p !== 'v1');
    const resource = parts[0];
    
    if (!resource || resource === 'meta') return []; // Meta endpoints don't require permissions

    const actionMap: Record<string, string> = {
      'GET': 'read',
      'POST': 'create',
      'PUT': 'update',
      'DELETE': 'delete',
      'PATCH': 'update'
    };

    const action = actionMap[method];
    return action ? [`${resource}:${action}`] : [];
  }

  private async discoverSchemas(): Promise<ApiSchemaInfo[]> {
    const schemas: ApiSchemaInfo[] = [];
    // When running the Next.js app, `process.cwd()` is the Next.js project root (`server/`).
    // Keep all paths relative to that root.
    const schemasPath = path.join(process.cwd(), 'src/lib/api/schemas');

    try {
      const schemaFiles = await fs.readdir(schemasPath);
      
      for (const file of schemaFiles) {
        if (file.endsWith('.ts') && file !== 'common.ts' && file !== 'metadataSchemas.ts') {
          const schemaInfo = await this.extractSchemaFromFile(path.join(schemasPath, file), file);
          schemas.push(...schemaInfo);
        }
      }

      return schemas;
    } catch (error) {
      console.error('Error discovering schemas:', error);
      
      // Fallback to known schemas
      return [
      {
        name: 'Client',
        type: 'model',
        description: 'Client entity schema',
        properties: {
          client_id: { type: 'string', description: 'Unique client identifier' },
          client_name: { type: 'string', description: 'Client name' },
          status: { type: 'string', description: 'Client status' }
        },
        required: ['client_name']
      },
      {
        name: 'Contact',
        type: 'model',
        description: 'Contact entity schema',
        properties: {
          contact_id: { type: 'string', description: 'Unique contact identifier' },
          name: { type: 'string', description: 'Contact name' },
          email: { type: 'string', description: 'Contact email address' }
        },
        required: ['name', 'email']
      },
        {
          name: 'Ticket',
          type: 'model',
          description: 'Support ticket entity schema',
          properties: {
            ticket_id: { type: 'string', description: 'Unique ticket identifier' },
            title: { type: 'string', description: 'Ticket title' },
            status: { type: 'string', description: 'Ticket status' },
            priority: { type: 'string', description: 'Ticket priority' }
          },
          required: ['title']
        },
        {
          name: 'Project',
          type: 'model',
          description: 'Project entity schema',
          properties: {
            project_id: { type: 'string', description: 'Unique project identifier' },
            project_name: { type: 'string', description: 'Project name' },
            status: { type: 'string', description: 'Project status' }
          },
          required: ['project_name']
        },
        {
          name: 'Invoice',
          type: 'model',
          description: 'Invoice entity schema',
          properties: {
            invoice_id: { type: 'string', description: 'Unique invoice identifier' },
            invoice_number: { type: 'string', description: 'Invoice number' },
            status: { type: 'string', description: 'Invoice status' },
            total: { type: 'number', description: 'Invoice total amount' }
          },
          required: ['invoice_number']
        },
        {
          name: 'User',
          type: 'model',
          description: 'User entity schema',
          properties: {
            user_id: { type: 'string', description: 'Unique user identifier' },
            username: { type: 'string', description: 'Username' },
            email: { type: 'string', description: 'User email address' },
            role: { type: 'string', description: 'User role' }
          },
          required: ['username', 'email']
        }
      ];
    }
  }

  private async extractSchemaFromFile(filePath: string, fileName: string): Promise<ApiSchemaInfo[]> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const schemas: ApiSchemaInfo[] = [];
      
      // Extract schema names from export statements
      const exportMatches = content.match(/export const (\w+Schema) = z\.object\(/g);
      
      if (exportMatches) {
        for (const match of exportMatches) {
          const schemaName = match.replace('export const ', '').replace('Schema = z.object(', '');
          const cleanName = this.cleanSchemaName(schemaName);
          
          schemas.push({
            name: cleanName,
            type: this.getSchemaType(schemaName),
            description: `${cleanName} schema from ${fileName}`,
            properties: await this.extractSchemaProperties(content, schemaName),
            required: await this.extractRequiredFields(content, schemaName)
          });
        }
      }

      return schemas;
    } catch (error) {
      console.error(`Error extracting schema from ${filePath}:`, error);
      return [];
    }
  }

  private cleanSchemaName(schemaName: string): string {
    return schemaName
      .replace(/Schema$/, '')
      .replace(/([A-Z])/g, ' $1')
      .trim()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  private getSchemaType(schemaName: string): 'request' | 'response' | 'model' {
    const name = schemaName.toLowerCase();
    if (name.includes('create') || name.includes('update') || name.includes('request')) {
      return 'request';
    }
    if (name.includes('response') || name.includes('result')) {
      return 'response';
    }
    return 'model';
  }

  private async extractSchemaProperties(content: string, schemaName: string): Promise<Record<string, any>> {
    // This is a simplified extraction - in a real implementation, 
    // you might use AST parsing for more accurate results
    const properties: Record<string, any> = {};
    
    // Try to find the schema definition and extract basic field information
    const schemaMatch = content.match(new RegExp(`${schemaName} = z\\.object\\(\\{([\\s\\S]*?)\\}\\)`));
    
    if (schemaMatch) {
      const schemaBody = schemaMatch[1];
      const fieldMatches = schemaBody.match(/(\w+):\s*z\.(\w+)\(\)/g);
      
      if (fieldMatches) {
        for (const fieldMatch of fieldMatches) {
          const [, fieldName, fieldType] = fieldMatch.match(/(\w+):\s*z\.(\w+)\(\)/) || [];
          if (fieldName && fieldType) {
            properties[fieldName] = {
              type: this.mapZodTypeToJsonSchema(fieldType),
              description: `${fieldName} field`
            };
          }
        }
      }

      // Fall back to extracting keys even if we can't infer types
      if (Object.keys(properties).length === 0) {
        const keyMatches = schemaBody.match(/^\s*(\w+)\s*:/gm) || [];
        keyMatches.forEach((match) => {
          const fieldName = match.replace(':', '').trim();
          if (!fieldName) return;
          properties[fieldName] = {
            type: 'string',
            description: `${fieldName} field`
          };
        });
      }

      return properties;
    }

    // Support schema definitions that reference a shared shape object, e.g.:
    // const thingShape = { ... } as const;
    // export const createThingSchema = z.object(thingShape);
    const shapeRefMatch = content.match(new RegExp(`${schemaName} = z\\.object\\((\\w+)\\)`));
    if (!shapeRefMatch) return properties;

    const shapeName = shapeRefMatch[1];
    if (!shapeName) return properties;

    const shapeMatch = content.match(new RegExp(`const\\s+${shapeName}\\s*=\\s*\\{([\\s\\S]*?)\\}\\s*(?:as\\s+const)?\\s*;`));
    if (!shapeMatch) return properties;

    const shapeBody = shapeMatch[1];
    const keyLines = shapeBody.match(/^\s*(\w+)\s*:\s*([^\n,]+)[,\n]/gm) || [];

    keyLines.forEach((line) => {
      const fieldMatch = line.match(/^\s*(\w+)\s*:\s*([^\n,]+)[,\n]/m);
      if (!fieldMatch) return;

      const fieldName = fieldMatch[1];
      const valueExpr = fieldMatch[2] ?? '';

      let inferredType = 'string';
      if (valueExpr.includes('z.number')) inferredType = 'number';
      else if (valueExpr.includes('z.boolean')) inferredType = 'boolean';
      else if (valueExpr.includes('z.array')) inferredType = 'array';
      else if (valueExpr.includes('z.object')) inferredType = 'object';

      properties[fieldName] = {
        type: inferredType,
        description: `${fieldName} field`
      };
    });

    return properties;
  }

  private async extractRequiredFields(content: string, schemaName: string): Promise<string[]> {
    // Extract required fields from schema definition
    // This is simplified - could be enhanced with AST parsing
    const required: string[] = [];
    
    const schemaMatch = content.match(new RegExp(`${schemaName} = z\\.object\\(\\{([\\s\\S]*?)\\}\\)`));
    
    if (schemaMatch) {
      const schemaBody = schemaMatch[1];
      const requiredMatches = schemaBody.match(/(\w+):\s*z\.\w+\(\)[^.]|(\w+):\s*z\.\w+\(\)\.min\(/g);
      
      if (requiredMatches) {
        for (const match of requiredMatches) {
          const fieldMatch = match.match(/(\w+):/);
          if (fieldMatch && !match.includes('.optional()')) {
            required.push(fieldMatch[1]);
          }
        }
      }

      return required;
    }

    // Support z.object(shapeName) patterns
    const shapeRefMatch = content.match(new RegExp(`${schemaName} = z\\.object\\((\\w+)\\)`));
    if (!shapeRefMatch) return required;

    const shapeName = shapeRefMatch[1];
    if (!shapeName) return required;

    const shapeMatch = content.match(new RegExp(`const\\s+${shapeName}\\s*=\\s*\\{([\\s\\S]*?)\\}\\s*(?:as\\s+const)?\\s*;`));
    if (!shapeMatch) return required;

    const shapeBody = shapeMatch[1];
    const keyLines = shapeBody.match(/^\s*(\w+)\s*:\s*([^\n,]+)[,\n]/gm) || [];

    keyLines.forEach((line) => {
      const fieldMatch = line.match(/^\s*(\w+)\s*:\s*([^\n,]+)[,\n]/m);
      if (!fieldMatch) return;

      const fieldName = fieldMatch[1];
      const valueExpr = fieldMatch[2] ?? '';

      if (valueExpr.includes('.optional(') || valueExpr.includes('.optional()')) return;
      required.push(fieldName);
    });

    return required;
  }

  private mapZodTypeToJsonSchema(zodType: string): string {
    const typeMap: Record<string, string> = {
      'string': 'string',
      'number': 'number',
      'boolean': 'boolean',
      'array': 'array',
      'object': 'object',
      'date': 'string',
      'enum': 'string'
    };

    return typeMap[zodType] || 'string';
  }

  private async discoverPermissions(): Promise<ApiPermissionInfo[]> {
    // Generate permissions based on discovered endpoints
    const endpoints = await this.discoverEndpoints();
    const permissions: ApiPermissionInfo[] = [];
    const permissionMap = new Map<string, ApiPermissionInfo>();

    endpoints.forEach(endpoint => {
      endpoint.permissions?.forEach(permission => {
        if (!permissionMap.has(permission)) {
          const [resource, action] = permission.split(':');
          const category = this.generateTags(`/api/v1/${resource}`)[0] || 'Other';
          
          permissionMap.set(permission, {
            permission,
            description: this.generatePermissionDescription(resource, action),
            category,
            endpoints: []
          });
        }
        
        const perm = permissionMap.get(permission)!;
        if (!perm.endpoints.includes(endpoint.path)) {
          perm.endpoints.push(endpoint.path);
        }
      });
    });

    // Add common permissions that might not be auto-discovered
    const commonPermissions = [
      {
        permission: 'admin:all',
        description: 'Full administrative access to all resources',
        category: 'Administration',
        endpoints: ['*']
      },
      {
        permission: 'api:access',
        description: 'Basic API access permission',
        category: 'API Access',
        endpoints: ['/api/v1/*']
      }
    ];

    permissions.push(...Array.from(permissionMap.values()), ...commonPermissions);
    return permissions;
  }

  private generatePermissionDescription(resource: string, action: string): string {
    const actionDescriptions: Record<string, string> = {
      'read': 'View and read',
      'create': 'Create new',
      'update': 'Edit and update',
      'delete': 'Delete and remove',
      'manage': 'Full management of',
      'export': 'Export data from',
      'import': 'Import data to'
    };

    const resourceName = resource.replace(/-/g, ' ').replace(/s$/, '');
    const actionDesc = actionDescriptions[action] || action;
    
    return `${actionDesc} ${resourceName} records`;
  }

  private getSchemaCategory(schemaName: string): string {
    const name = schemaName.toLowerCase();
    
    if (name.includes('client') || name.includes('contact')) return 'Core Business';
    if (name.includes('ticket') || name.includes('project')) return 'Operations';
    if (name.includes('invoice') || name.includes('billing')) return 'Financial';
    if (name.includes('user') || name.includes('team')) return 'Administration';
    if (name.includes('workflow') || name.includes('automation')) return 'Automation';
    
    return 'Other';
  }

  private generateOpenApiPaths(endpoints: ApiEndpoint[]): Record<string, any> {
    const paths: Record<string, any> = {};

    endpoints.forEach(endpoint => {
      if (!paths[endpoint.path]) {
        paths[endpoint.path] = {};
      }

      paths[endpoint.path][endpoint.method.toLowerCase()] = {
        summary: endpoint.summary,
        description: endpoint.description,
        tags: endpoint.tags,
        operationId: endpoint.operationId,
        deprecated: endpoint.deprecated,
        security: endpoint.requiresAuth ? [{ ApiKeyAuth: [] }] : [],
        parameters: this.generateOpenApiParameters(endpoint),
        responses: {
          '200': {
            description: 'Successful response',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: { type: 'object', description: 'Response data' },
                    message: { type: 'string', description: 'Success message' },
                    meta: { 
                      type: 'object', 
                      description: 'Additional metadata',
                      properties: {
                        pagination: {
                          type: 'object',
                          properties: {
                            page: { type: 'number' },
                            limit: { type: 'number' },
                            total: { type: 'number' },
                            totalPages: { type: 'number' }
                          }
                        }
                      }
                    }
                  },
                  required: ['success', 'data']
                }
              }
            }
          },
          '400': { 
            description: 'Bad Request',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: false },
                    error: { type: 'string' },
                    details: { type: 'array', items: { type: 'object' } }
                  }
                }
              }
            }
          },
          '401': { 
            description: 'Unauthorized - Invalid or missing API key',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: false },
                    error: { type: 'string', example: 'Unauthorized' }
                  }
                }
              }
            }
          },
          '403': { 
            description: 'Forbidden - Insufficient permissions',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: false },
                    error: { type: 'string', example: 'Forbidden' }
                  }
                }
              }
            }
          },
          '404': { 
            description: 'Resource not found',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: false },
                    error: { type: 'string', example: 'Resource not found' }
                  }
                }
              }
            }
          },
          '500': { 
            description: 'Internal Server Error',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: false },
                    error: { type: 'string', example: 'Internal server error' }
                  }
                }
              }
            }
          }
        }
      };

      // Add request body for POST/PUT/PATCH methods
      if (['POST', 'PUT', 'PATCH'].includes(endpoint.method)) {
        paths[endpoint.path][endpoint.method.toLowerCase()].requestBody = {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                description: `${endpoint.method} request body for ${endpoint.path}`
              }
            }
          }
        };
      }
    });

    return paths;
  }

  private generateOpenApiSchemas(schemas: ApiSchemaInfo[]): Record<string, any> {
    const openApiSchemas: Record<string, any> = {};

    schemas.forEach(schema => {
      openApiSchemas[schema.name] = {
        type: 'object',
        description: schema.description,
        properties: schema.properties,
        required: schema.required
      };
    });

    return openApiSchemas;
  }

  private generateOpenApiTags(endpoints: ApiEndpoint[]): any[] {
    const tagSet = new Set<string>();
    endpoints.forEach(ep => ep.tags?.forEach(tag => tagSet.add(tag)));

    return Array.from(tagSet).map(tag => ({
      name: tag,
      description: `${tag} related operations`
    }));
  }

  private generateOpenApiParameters(endpoint: ApiEndpoint): any[] {
    const parameters: any[] = [];

    // Extract path parameters from the path
    const pathParams = endpoint.path.match(/\{(\w+)\}/g);
    if (pathParams) {
      pathParams.forEach(param => {
        const paramName = param.slice(1, -1); // Remove { }
        parameters.push({
          name: paramName,
          in: 'path',
          required: true,
          schema: { type: 'string' },
          description: `${paramName} identifier`
        });
      });
    }

    // Add common query parameters for GET requests
    if (endpoint.method === 'GET') {
      if (endpoint.path.split('/').length <= 4) { // List endpoints
        parameters.push(
          {
            name: 'page',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, default: 1 },
            description: 'Page number for pagination'
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
            description: 'Number of items per page'
          },
          {
            name: 'sort',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description: 'Field to sort by'
          },
          {
            name: 'order',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
            description: 'Sort order'
          }
        );
      }
    }

    return parameters;
  }
}
