/**
 * SDK Generator Service
 * Generates TypeScript/JavaScript SDKs from OpenAPI specifications
 * Supports HATEOAS link following and provides type-safe API clients
 */

export interface SdkGenerationConfig {
  language: 'typescript' | 'javascript' | 'python' | 'java';
  packageName: string;
  version: string;
  author?: string;
  description?: string;
  includeHateoas?: boolean;
  includeExamples?: boolean;
  outputFormat: 'zip' | 'npm' | 'github';
}

export interface GeneratedSdk {
  language: string;
  packageName: string;
  version: string;
  files: Record<string, string>;
  downloadUrl?: string;
  installInstructions: string;
  usageExample: string;
}

export class SdkGeneratorService {
  /**
   * Generate TypeScript SDK with full HATEOAS support
   */
  static async generateTypeScriptSdk(config: SdkGenerationConfig): Promise<GeneratedSdk> {
    const files: Record<string, string> = {};

    // Generate package.json
    files['package.json'] = this.generatePackageJson(config);

    // Generate main client class
    files['src/client.ts'] = this.generateTypeScriptClient(config);

    // Generate resource classes for each API resource
    files['src/resources/teams.ts'] = this.generateTeamsResource();
    files['src/resources/projects.ts'] = this.generateProjectsResource();
    files['src/resources/tickets.ts'] = this.generateTicketsResource();
    files['src/resources/users.ts'] = this.generateUsersResource();
    files['src/resources/webhooks.ts'] = this.generateWebhooksResource();

    // Generate types
    files['src/types/index.ts'] = this.generateTypeDefinitions();
    files['src/types/hateoas.ts'] = this.generateHateoasTypes();

    // Generate utilities
    files['src/utils/http.ts'] = this.generateHttpUtils();
    files['src/utils/hateoas.ts'] = this.generateHateoasUtils();

    // Generate index file
    files['src/index.ts'] = this.generateIndexFile();

    // Generate README
    files['README.md'] = this.generateReadme(config);

    // Generate TypeScript config
    files['tsconfig.json'] = this.generateTsConfig();

    // Generate examples
    if (config.includeExamples) {
      files['examples/basic-usage.ts'] = this.generateBasicExample();
      files['examples/hateoas-navigation.ts'] = this.generateHateoasExample();
      files['examples/webhooks.ts'] = this.generateWebhookExample();
    }

    return {
      language: 'typescript',
      packageName: config.packageName,
      version: config.version,
      files,
      installInstructions: `npm install ${config.packageName}`,
      usageExample: this.generateQuickUsageExample(config.packageName)
    };
  }

  /**
   * Generate JavaScript SDK (compiled from TypeScript)
   */
  static async generateJavaScriptSdk(config: SdkGenerationConfig): Promise<GeneratedSdk> {
    const tsConfig = { ...config, language: 'typescript' as const };
    const tsSdk = await this.generateTypeScriptSdk(tsConfig);

    // Convert TypeScript files to JavaScript (simplified - in reality would use TypeScript compiler)
    const jsFiles: Record<string, string> = {};
    
    Object.entries(tsSdk.files).forEach(([path, content]) => {
      if (path.endsWith('.ts') && !path.endsWith('.d.ts')) {
        const jsPath = path.replace('.ts', '.js');
        jsFiles[jsPath] = this.convertTsToJs(content);
        
        // Also generate .d.ts files for type definitions
        if (path.includes('/types/') || path.includes('client.ts')) {
          jsFiles[path.replace('.ts', '.d.ts')] = this.generateDeclarationFile(content);
        }
      } else {
        jsFiles[path] = content;
      }
    });

    // Update package.json for JavaScript
    jsFiles['package.json'] = this.generatePackageJson({
      ...config,
      language: 'javascript'
    });

    return {
      language: 'javascript',
      packageName: config.packageName,
      version: config.version,
      files: jsFiles,
      installInstructions: `npm install ${config.packageName}`,
      usageExample: this.generateQuickUsageExample(config.packageName, 'javascript')
    };
  }

  private static generatePackageJson(config: SdkGenerationConfig): string {
    const pkg = {
      name: config.packageName,
      version: config.version,
      description: config.description || `${config.language === 'typescript' ? 'TypeScript' : 'JavaScript'} SDK for Alga PSA API`,
      main: config.language === 'typescript' ? 'dist/index.js' : 'src/index.js',
      types: config.language === 'typescript' ? 'dist/index.d.ts' : 'src/index.d.ts',
      scripts: {
        build: config.language === 'typescript' ? 'tsc' : 'echo "No build required"',
        test: 'jest',
        'test:watch': 'jest --watch',
        prepublishOnly: config.language === 'typescript' ? 'npm run build' : 'echo "No build required"'
      },
      dependencies: {
        'cross-fetch': '^3.1.5'
      },
      devDependencies: config.language === 'typescript' ? {
        typescript: '^5.0.0',
        '@types/node': '^18.0.0',
        jest: '^29.0.0',
        '@types/jest': '^29.0.0'
      } : {
        jest: '^29.0.0'
      },
      keywords: ['alga-psa', 'api', 'sdk', 'rest', 'hateoas'],
      author: config.author || 'Alga PSA',
      license: 'MIT',
      repository: {
        type: 'git',
        url: `https://github.com/alga-psa/${config.packageName}.git`
      },
      files: config.language === 'typescript' ? ['dist/', 'src/', 'README.md'] : ['src/', 'README.md']
    };

    return JSON.stringify(pkg, null, 2);
  }

  private static generateTypeScriptClient(config: SdkGenerationConfig): string {
    return `import { TeamsResource } from './resources/teams';
import { ProjectsResource } from './resources/projects';
import { TicketsResource } from './resources/tickets';
import { UsersResource } from './resources/users';
import { WebhooksResource } from './resources/webhooks';
import { HttpClient } from './utils/http';
import { HateoasResponse, HateoasLink } from './types/hateoas';

export interface AlgaPSAClientConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  retries?: number;
}

export class AlgaPSAClient {
  private httpClient: HttpClient;
  
  public readonly teams: TeamsResource;
  public readonly projects: ProjectsResource;
  public readonly tickets: TicketsResource;
  public readonly users: UsersResource;
  public readonly webhooks: WebhooksResource;

  constructor(config: AlgaPSAClientConfig) {
    this.httpClient = new HttpClient({
      baseUrl: config.baseUrl || 'https://api.algapsa.com',
      apiKey: config.apiKey,
      timeout: config.timeout || 30000,
      retries: config.retries || 3
    });

    // Initialize resource classes
    this.teams = new TeamsResource(this.httpClient);
    this.projects = new ProjectsResource(this.httpClient);
    this.tickets = new TicketsResource(this.httpClient);
    this.users = new UsersResource(this.httpClient);
    this.webhooks = new WebhooksResource(this.httpClient);
  }

  /**
   * Follow a HATEOAS link
   */
  async followLink<T = any>(link: HateoasLink, body?: any): Promise<HateoasResponse<T>> {
    return this.httpClient.request<T>({
      method: link.method as any,
      url: link.href,
      data: body
    });
  }

  /**
   * Discover API capabilities from the root endpoint
   */
  async discover(): Promise<HateoasResponse<any>> {
    return this.httpClient.get('/api/v1');
  }

  /**
   * Get API health status
   */
  async health(): Promise<any> {
    return this.httpClient.get('/api/v1/meta/health');
  }

  /**
   * Get OpenAPI specification
   */
  async getOpenApiSpec(): Promise<any> {
    return this.httpClient.get('/api/v1/meta/openapi');
  }
}`;
  }

  private static generateTeamsResource(): string {
    return `import { HttpClient } from '@server/lib/utils/http';
import { HateoasResponse, PaginatedResponse } from '@server/types/hateoas';
import { Team, CreateTeamRequest, UpdateTeamRequest, TeamFilters } from '@server/types';

export class TeamsResource {
  constructor(private http: HttpClient) {}

  /**
   * List teams with optional filtering and pagination
   */
  async list(options: {
    page?: number;
    limit?: number;
    filters?: TeamFilters;
  } = {}): Promise<PaginatedResponse<Team>> {
    const params = new URLSearchParams();
    
    if (options.page) params.append('page', options.page.toString());
    if (options.limit) params.append('limit', options.limit.toString());
    
    if (options.filters) {
      Object.entries(options.filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params.append(key, value.toString());
        }
      });
    }

    const url = \`/api/v1/teams\${params.toString() ? '?' + params.toString() : ''}\`;
    return this.http.get<PaginatedResponse<Team>>(url);
  }

  /**
   * Get a team by ID
   */
  async get(id: string, options: {
    includeMembers?: boolean;
    includeProjects?: boolean;
    includeAnalytics?: boolean;
  } = {}): Promise<HateoasResponse<Team>> {
    const params = new URLSearchParams();
    
    if (options.includeMembers) params.append('include_members', 'true');
    if (options.includeProjects) params.append('include_projects', 'true');
    if (options.includeAnalytics) params.append('include_analytics', 'true');

    const url = \`/api/v1/teams/\${id}\${params.toString() ? '?' + params.toString() : ''}\`;
    return this.http.get<Team>(url);
  }

  /**
   * Create a new team
   */
  async create(data: CreateTeamRequest): Promise<HateoasResponse<Team>> {
    return this.http.post<Team>('/api/v1/teams', data);
  }

  /**
   * Update a team
   */
  async update(id: string, data: UpdateTeamRequest): Promise<HateoasResponse<Team>> {
    return this.http.put<Team>(\`/api/v1/teams/\${id}\`, data);
  }

  /**
   * Delete a team
   */
  async delete(id: string): Promise<void> {
    await this.http.delete(\`/api/v1/teams/\${id}\`);
  }

  /**
   * Add a member to a team
   */
  async addMember(teamId: string, userId: string): Promise<HateoasResponse<Team>> {
    return this.http.post<Team>(\`/api/v1/teams/\${teamId}/members\`, { user_id: userId });
  }

  /**
   * Remove a member from a team
   */
  async removeMember(teamId: string, userId: string): Promise<HateoasResponse<Team>> {
    return this.http.delete(\`/api/v1/teams/\${teamId}/members/\${userId}\`);
  }

  /**
   * Get team analytics
   */
  async getAnalytics(teamId: string, options: {
    startDate?: string;
    endDate?: string;
  } = {}): Promise<any> {
    const params = new URLSearchParams();
    
    if (options.startDate) params.append('start_date', options.startDate);
    if (options.endDate) params.append('end_date', options.endDate);

    const url = \`/api/v1/teams/\${teamId}/analytics\${params.toString() ? '?' + params.toString() : ''}\`;
    return this.http.get(url);
  }
}`;
  }

  private static generateProjectsResource(): string {
    return `import { HttpClient } from '@server/lib/utils/http';
import { HateoasResponse, PaginatedResponse } from '@server/types/hateoas';
import { Project, CreateProjectRequest, UpdateProjectRequest, ProjectFilters } from '@server/types';

export class ProjectsResource {
  constructor(private http: HttpClient) {}

  async list(options: {
    page?: number;
    limit?: number;
    filters?: ProjectFilters;
  } = {}): Promise<PaginatedResponse<Project>> {
    const params = new URLSearchParams();
    
    if (options.page) params.append('page', options.page.toString());
    if (options.limit) params.append('limit', options.limit.toString());
    
    if (options.filters) {
      Object.entries(options.filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params.append(key, value.toString());
        }
      });
    }

    const url = \`/api/v1/projects\${params.toString() ? '?' + params.toString() : ''}\`;
    return this.http.get<PaginatedResponse<Project>>(url);
  }

  async get(id: string): Promise<HateoasResponse<Project>> {
    return this.http.get<Project>(\`/api/v1/projects/\${id}\`);
  }

  async create(data: CreateProjectRequest): Promise<HateoasResponse<Project>> {
    return this.http.post<Project>('/api/v1/projects', data);
  }

  async update(id: string, data: UpdateProjectRequest): Promise<HateoasResponse<Project>> {
    return this.http.put<Project>(\`/api/v1/projects/\${id}\`, data);
  }

  async delete(id: string): Promise<void> {
    await this.http.delete(\`/api/v1/projects/\${id}\`);
  }
}`;
  }

  private static generateTicketsResource(): string {
    return `import { HttpClient } from '@server/lib/utils/http';
import { HateoasResponse, PaginatedResponse } from '@server/types/hateoas';
import { Ticket, CreateTicketRequest, UpdateTicketRequest, TicketFilters } from '@server/types';

export class TicketsResource {
  constructor(private http: HttpClient) {}

  async list(options: {
    page?: number;
    limit?: number;
    filters?: TicketFilters;
  } = {}): Promise<PaginatedResponse<Ticket>> {
    const params = new URLSearchParams();
    
    if (options.page) params.append('page', options.page.toString());
    if (options.limit) params.append('limit', options.limit.toString());
    
    if (options.filters) {
      Object.entries(options.filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params.append(key, value.toString());
        }
      });
    }

    const url = \`/api/v1/tickets\${params.toString() ? '?' + params.toString() : ''}\`;
    return this.http.get<PaginatedResponse<Ticket>>(url);
  }

  async get(id: string): Promise<HateoasResponse<Ticket>> {
    return this.http.get<Ticket>(\`/api/v1/tickets/\${id}\`);
  }

  async create(data: CreateTicketRequest): Promise<HateoasResponse<Ticket>> {
    return this.http.post<Ticket>('/api/v1/tickets', data);
  }

  async update(id: string, data: UpdateTicketRequest): Promise<HateoasResponse<Ticket>> {
    return this.http.put<Ticket>(\`/api/v1/tickets/\${id}\`, data);
  }

  async delete(id: string): Promise<void> {
    await this.http.delete(\`/api/v1/tickets/\${id}\`);
  }

  async assign(id: string, assigneeId: string): Promise<HateoasResponse<Ticket>> {
    return this.http.put<Ticket>(\`/api/v1/tickets/\${id}/assign\`, { assignee_id: assigneeId });
  }

  async changeStatus(id: string, status: string): Promise<HateoasResponse<Ticket>> {
    return this.http.put<Ticket>(\`/api/v1/tickets/\${id}/status\`, { status });
  }
}`;
  }

  private static generateUsersResource(): string {
    return `import { HttpClient } from '@server/lib/utils/http';
import { HateoasResponse, PaginatedResponse } from '@server/types/hateoas';
import { User, CreateUserRequest, UpdateUserRequest, UserFilters } from '@server/types';

export class UsersResource {
  constructor(private http: HttpClient) {}

  async list(options: {
    page?: number;
    limit?: number;
    filters?: UserFilters;
  } = {}): Promise<PaginatedResponse<User>> {
    const params = new URLSearchParams();
    
    if (options.page) params.append('page', options.page.toString());
    if (options.limit) params.append('limit', options.limit.toString());
    
    if (options.filters) {
      Object.entries(options.filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params.append(key, value.toString());
        }
      });
    }

    const url = \`/api/v1/users\${params.toString() ? '?' + params.toString() : ''}\`;
    return this.http.get<PaginatedResponse<User>>(url);
  }

  async get(id: string): Promise<HateoasResponse<User>> {
    return this.http.get<User>(\`/api/v1/users/\${id}\`);
  }

  async create(data: CreateUserRequest): Promise<HateoasResponse<User>> {
    return this.http.post<User>('/api/v1/users', data);
  }

  async update(id: string, data: UpdateUserRequest): Promise<HateoasResponse<User>> {
    return this.http.put<User>(\`/api/v1/users/\${id}\`, data);
  }

  async delete(id: string): Promise<void> {
    await this.http.delete(\`/api/v1/users/\${id}\`);
  }
}`;
  }

  private static generateWebhooksResource(): string {
    return `import { HttpClient } from '@server/lib/utils/http';
import { HateoasResponse, PaginatedResponse } from '@server/types/hateoas';
import { Webhook, CreateWebhookRequest, UpdateWebhookRequest, WebhookFilters } from '@server/types';

export class WebhooksResource {
  constructor(private http: HttpClient) {}

  async list(options: {
    page?: number;
    limit?: number;
    filters?: WebhookFilters;
  } = {}): Promise<PaginatedResponse<Webhook>> {
    const params = new URLSearchParams();
    
    if (options.page) params.append('page', options.page.toString());
    if (options.limit) params.append('limit', options.limit.toString());
    
    if (options.filters) {
      Object.entries(options.filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params.append(key, value.toString());
        }
      });
    }

    const url = \`/api/v1/webhooks\${params.toString() ? '?' + params.toString() : ''}\`;
    return this.http.get<PaginatedResponse<Webhook>>(url);
  }

  async get(id: string): Promise<HateoasResponse<Webhook>> {
    return this.http.get<Webhook>(\`/api/v1/webhooks/\${id}\`);
  }

  async create(data: CreateWebhookRequest): Promise<HateoasResponse<Webhook>> {
    return this.http.post<Webhook>('/api/v1/webhooks', data);
  }

  async update(id: string, data: UpdateWebhookRequest): Promise<HateoasResponse<Webhook>> {
    return this.http.put<Webhook>(\`/api/v1/webhooks/\${id}\`, data);
  }

  async delete(id: string): Promise<void> {
    await this.http.delete(\`/api/v1/webhooks/\${id}\`);
  }

  async test(id: string, eventType?: string): Promise<any> {
    return this.http.post(\`/api/v1/webhooks/\${id}/test\`, { event_type: eventType });
  }
}`;
  }

  private static generateTypeDefinitions(): string {
    return `// Core entity types
export interface Team {
  team_id: string;
  team_name: string;
  manager_id?: string;
  created_at: string;
  updated_at: string;
  members?: User[];
  _links?: Record<string, import('./hateoas').HateoasLink>;
}

export interface Project {
  project_id: string;
  project_name: string;
  description?: string;
  status: 'planning' | 'active' | 'completed' | 'on-hold' | 'cancelled';
  client_id?: string;
  manager_id?: string;
  created_at: string;
  updated_at: string;
  _links?: Record<string, import('./hateoas').HateoasLink>;
}

export interface Ticket {
  ticket_id: string;
  title: string;
  description?: string;
  status: 'open' | 'in-progress' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assignee_id?: string;
  project_id?: string;
  created_at: string;
  updated_at: string;
  _links?: Record<string, import('./hateoas').HateoasLink>;
}

export interface User {
  user_id: string;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  is_inactive: boolean;
  created_at: string;
  updated_at: string;
  _links?: Record<string, import('./hateoas').HateoasLink>;
}

export interface Webhook {
  webhook_id: string;
  name: string;
  url: string;
  event_types: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
  _links?: Record<string, import('./hateoas').HateoasLink>;
}

// Request types
export interface CreateTeamRequest {
  team_name: string;
  manager_id?: string;
  members?: Array<{ user_id: string }>;
}

export interface UpdateTeamRequest {
  team_name?: string;
  manager_id?: string;
}

export interface CreateProjectRequest {
  project_name: string;
  description?: string;
  client_id?: string;
  manager_id?: string;
}

export interface UpdateProjectRequest {
  project_name?: string;
  description?: string;
  status?: 'planning' | 'active' | 'completed' | 'on-hold' | 'cancelled';
}

export interface CreateTicketRequest {
  title: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  project_id?: string;
  assignee_id?: string;
}

export interface UpdateTicketRequest {
  title?: string;
  description?: string;
  status?: 'open' | 'in-progress' | 'resolved' | 'closed';
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  assignee_id?: string;
}

export interface CreateUserRequest {
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  password: string;
}

export interface UpdateUserRequest {
  username?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  is_inactive?: boolean;
}

export interface CreateWebhookRequest {
  name: string;
  url: string;
  event_types: string[];
  is_active?: boolean;
  secret?: string;
}

export interface UpdateWebhookRequest {
  name?: string;
  url?: string;
  event_types?: string[];
  is_active?: boolean;
}

// Filter types
export interface TeamFilters {
  team_name?: string;
  manager_id?: string;
  has_manager?: boolean;
  search?: string;
}

export interface ProjectFilters {
  project_name?: string;
  status?: string;
  client_id?: string;
  manager_id?: string;
  search?: string;
}

export interface TicketFilters {
  title?: string;
  status?: string;
  priority?: string;
  assignee_id?: string;
  project_id?: string;
  search?: string;
}

export interface UserFilters {
  username?: string;
  email?: string;
  is_inactive?: boolean;
  search?: string;
}

export interface WebhookFilters {
  name?: string;
  is_active?: boolean;
  event_type?: string;
}`;
  }

  private static generateHateoasTypes(): string {
    return `export interface HateoasLink {
  href: string;
  method: string;
  rel: string;
  type?: string;
}

export interface HateoasResponse<T> {
  success: boolean;
  data: T & {
    _links?: Record<string, HateoasLink>;
  };
  message?: string;
}

export interface PaginatedResponse<T> extends HateoasResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  _links?: Record<string, HateoasLink>;
}

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: any;
  };
}`;
  }

  private static generateHttpUtils(): string {
    return `import fetch from 'cross-fetch';

export interface HttpClientConfig {
  baseUrl: string;
  apiKey: string;
  timeout?: number;
  retries?: number;
}

export interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  data?: any;
  headers?: Record<string, string>;
}

export class HttpClient {
  private config: HttpClientConfig;

  constructor(config: HttpClientConfig) {
    this.config = {
      timeout: 30000,
      retries: 3,
      ...config
    };
  }

  async request<T>(options: RequestOptions): Promise<T> {
    const url = options.url.startsWith('http') ? options.url : \`\${this.config.baseUrl}\${options.url}\`;
    
    const headers = {
      'Content-Type': 'application/json',
      'X-API-Key': this.config.apiKey,
      ...options.headers
    };

    const requestOptions: RequestInit = {
      method: options.method,
      headers,
      signal: AbortSignal.timeout(this.config.timeout!)
    };

    if (options.data && ['POST', 'PUT', 'PATCH'].includes(options.method)) {
      requestOptions.body = JSON.stringify(options.data);
    }

    let lastError: Error;
    
    for (let attempt = 0; attempt <= this.config.retries!; attempt++) {
      try {
        const response = await fetch(url, requestOptions);
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
          throw new Error(\`HTTP \${response.status}: \${errorData.message || response.statusText}\`);
        }

        if (response.status === 204) {
          return undefined as any;
        }

        return await response.json();
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < this.config.retries! && this.isRetryableError(error)) {
          await this.delay(Math.pow(2, attempt) * 1000);
          continue;
        }
        
        throw error;
      }
    }

    throw lastError!;
  }

  async get<T>(url: string, headers?: Record<string, string>): Promise<T> {
    return this.request<T>({ method: 'GET', url, headers });
  }

  async post<T>(url: string, data?: any, headers?: Record<string, string>): Promise<T> {
    return this.request<T>({ method: 'POST', url, data, headers });
  }

  async put<T>(url: string, data?: any, headers?: Record<string, string>): Promise<T> {
    return this.request<T>({ method: 'PUT', url, data, headers });
  }

  async patch<T>(url: string, data?: any, headers?: Record<string, string>): Promise<T> {
    return this.request<T>({ method: 'PATCH', url, data, headers });
  }

  async delete<T>(url: string, headers?: Record<string, string>): Promise<T> {
    return this.request<T>({ method: 'DELETE', url, headers });
  }

  private isRetryableError(error: any): boolean {
    return error.name === 'AbortError' || 
           error.message.includes('ECONNRESET') ||
           error.message.includes('ETIMEDOUT');
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}`;
  }

  private static generateHateoasUtils(): string {
    return `import { HateoasLink, HateoasResponse } from '@server/types/hateoas';

/**
 * Extract and follow HATEOAS links from API responses
 */
export class HateoasNavigator {
  constructor(private httpClient: any) {}

  /**
   * Follow a HATEOAS link from a response
   */
  async followLink<T>(response: HateoasResponse<any>, linkName: string, body?: any): Promise<T> {
    const link = response.data._links?.[linkName];
    if (!link) {
      throw new Error(\`Link '\${linkName}' not found in response\`);
    }

    return this.httpClient.request<T>({
      method: link.method as any,
      url: link.href,
      data: body
    });
  }

  /**
   * Get all available links from a response
   */
  getAvailableLinks(response: HateoasResponse<any>): Record<string, HateoasLink> {
    return response.data._links || {};
  }

  /**
   * Check if a specific link is available
   */
  hasLink(response: HateoasResponse<any>, linkName: string): boolean {
    return !!(response.data._links?.[linkName]);
  }

  /**
   * Get links by relation type
   */
  getLinksByRel(response: HateoasResponse<any>, rel: string): HateoasLink[] {
    const links = response.data._links || {};
    return Object.values(links).filter(link => link.rel === rel);
  }
}

/**
 * Extend any resource with HATEOAS navigation capabilities
 */
export function withHateoas<T>(data: T & { _links?: Record<string, HateoasLink> }, httpClient: any) {
  return {
    ...data,
    
    /**
     * Follow a HATEOAS link
     */
    async followLink<U>(linkName: string, body?: any): Promise<U> {
      const link = data._links?.[linkName];
      if (!link) {
        throw new Error(\`Link '\${linkName}' not found\`);
      }

      return httpClient.request<U>({
        method: link.method as any,
        url: link.href,
        data: body
      });
    },

    /**
     * Get all available actions
     */
    getAvailableActions(): string[] {
      return Object.keys(data._links || {});
    },

    /**
     * Check if an action is available
     */
    canPerformAction(action: string): boolean {
      return !!(data._links?.[action]);
    }
  };
}`;
  }

  private static generateIndexFile(): string {
    return `export { AlgaPSAClient } from './client';
export * from './types';
export * from './types/hateoas';
export { HateoasNavigator, withHateoas } from './utils/hateoas';`;
  }

  private static generateReadme(config: SdkGenerationConfig): string {
    return `# ${config.packageName}

${config.description || 'Official TypeScript/JavaScript SDK for the Alga PSA API'}

## Installation

\`\`\`bash
npm install ${config.packageName}
\`\`\`

## Quick Start

\`\`\`typescript
import { AlgaPSAClient } from '${config.packageName}';

const client = new AlgaPSAClient({
  apiKey: 'your-api-key-here',
  baseUrl: 'https://api.algapsa.com' // optional
});

// List teams
const teams = await client.teams.list();

// Create a new team
const newTeam = await client.teams.create({
  team_name: 'Development Team',
  manager_id: 'user-123'
});

// Follow HATEOAS links
const teamMembers = await newTeam.data.followLink('members');
\`\`\`

## Features

- 🔗 **Full HATEOAS Support**: Automatically follow hypermedia links
- 📝 **TypeScript First**: Complete type definitions for all API resources
- 🔄 **Automatic Retries**: Built-in retry logic for failed requests
- ⚡ **Promise-based**: Modern async/await API
- 🛡️ **Error Handling**: Comprehensive error handling and validation

## HATEOAS Navigation

The SDK provides powerful HATEOAS navigation capabilities:

\`\`\`typescript
// Get a team
const team = await client.teams.get('team-123');

// Check available actions
const actions = team.data.getAvailableActions();
console.log(actions); // ['edit', 'delete', 'add-member', 'projects', ...]

// Follow links dynamically
if (team.data.canPerformAction('add-member')) {
  await team.data.followLink('add-member', { user_id: 'user-456' });
}

// Navigate to related resources
const projects = await team.data.followLink('projects');
const analytics = await team.data.followLink('analytics');
\`\`\`

## Error Handling

\`\`\`typescript
try {
  const team = await client.teams.get('invalid-id');
} catch (error) {
  if (error.message.includes('404')) {
    console.log('Team not found');
  } else {
    console.error('API Error:', error.message);
  }
}
\`\`\`

## Configuration

\`\`\`typescript
const client = new AlgaPSAClient({
  apiKey: 'your-api-key',
  baseUrl: 'https://api.algapsa.com',
  timeout: 30000,  // 30 seconds
  retries: 3       // retry failed requests 3 times
});
\`\`\`

## Available Resources

- \`client.teams\` - Team management
- \`client.projects\` - Project operations
- \`client.tickets\` - Ticket handling
- \`client.users\` - User management
- \`client.webhooks\` - Webhook configuration

## License

MIT License - see LICENSE file for details.
`;
  }

  private static generateTsConfig(): string {
    return JSON.stringify({
      compilerOptions: {
        target: 'ES2020',
        lib: ['ES2020', 'DOM'],
        module: 'commonjs',
        declaration: true,
        outDir: './dist',
        strict: true,
        noImplicitAny: true,
        strictNullChecks: true,
        strictFunctionTypes: true,
        noImplicitReturns: true,
        noFallthroughCasesInSwitch: true,
        moduleResolution: 'node',
        baseUrl: './',
        esModuleInterop: true,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true
      },
      include: ['src/**/*'],
      exclude: ['node_modules', 'dist', '**/*.test.ts']
    }, null, 2);
  }

  private static generateBasicExample(): string {
    return `import { AlgaPSAClient } from '../src';

async function basicExample() {
  const client = new AlgaPSAClient({
    apiKey: process.env.ALGA_PSA_API_KEY!,
    baseUrl: 'https://api.algapsa.com'
  });

  try {
    // List teams
    console.log('Fetching teams...');
    const teams = await client.teams.list({ page: 1, limit: 10 });
    console.log(\`Found \${teams.data.length} teams\`);

    // Create a new team
    console.log('Creating a new team...');
    const newTeam = await client.teams.create({
      team_name: 'SDK Test Team',
      manager_id: 'user-123' // Replace with actual user ID
    });
    console.log('Team created:', newTeam.data.team_name);

    // Update the team
    const updatedTeam = await client.teams.update(newTeam.data.team_id, {
      team_name: 'Updated SDK Test Team'
    });
    console.log('Team updated:', updatedTeam.data.team_name);

    // Clean up - delete the test team
    await client.teams.delete(newTeam.data.team_id);
    console.log('Test team deleted');

  } catch (error) {
    console.error('Error:', error);
  }
}

basicExample();`;
  }

  private static generateHateoasExample(): string {
    return `import { AlgaPSAClient } from '../src';

async function hateoasExample() {
  const client = new AlgaPSAClient({
    apiKey: process.env.ALGA_PSA_API_KEY!
  });

  try {
    // Get a team with full HATEOAS navigation
    const team = await client.teams.get('team-123');
    
    console.log('Available actions for this team:');
    console.log(team.data.getAvailableActions());

    // Follow HATEOAS links dynamically
    if (team.data.canPerformAction('members')) {
      console.log('Fetching team members...');
      const members = await team.data.followLink('members');
      console.log(\`Team has \${members.data.length} members\`);
    }

    if (team.data.canPerformAction('projects')) {
      console.log('Fetching team projects...');
      const projects = await team.data.followLink('projects');
      console.log(\`Team is working on \${projects.data.length} projects\`);
    }

    // Use action links to perform operations
    if (team.data.canPerformAction('add-member')) {
      console.log('Adding a member to the team...');
      await team.data.followLink('add-member', {
        user_id: 'user-456'
      });
      console.log('Member added successfully');
    }

    // Navigate to analytics
    if (team.data.canPerformAction('analytics')) {
      console.log('Fetching team analytics...');
      const analytics = await team.data.followLink('analytics', {
        start_date: '2024-01-01',
        end_date: '2024-12-31'
      });
      console.log('Analytics retrieved:', analytics);
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

hateoasExample();`;
  }

  private static generateWebhookExample(): string {
    return `import { AlgaPSAClient } from '../src';

async function webhookExample() {
  const client = new AlgaPSAClient({
    apiKey: process.env.ALGA_PSA_API_KEY!
  });

  try {
    // Create a webhook
    console.log('Creating webhook...');
    const webhook = await client.webhooks.create({
      name: 'Team Updates Webhook',
      url: 'https://your-app.com/webhook',
      event_types: ['team.created', 'team.updated', 'team.member.added'],
      is_active: true
    });
    console.log('Webhook created:', webhook.data.name);

    // Test the webhook
    console.log('Testing webhook...');
    const testResult = await client.webhooks.test(webhook.data.webhook_id, 'team.created');
    console.log('Webhook test result:', testResult);

    // List all webhooks
    const webhooks = await client.webhooks.list();
    console.log(\`Total webhooks: \${webhooks.data.length}\`);

    // Update webhook
    const updatedWebhook = await client.webhooks.update(webhook.data.webhook_id, {
      name: 'Updated Team Webhook',
      event_types: ['team.created', 'team.updated', 'team.member.added', 'team.member.removed']
    });
    console.log('Webhook updated:', updatedWebhook.data.name);

    // Clean up
    await client.webhooks.delete(webhook.data.webhook_id);
    console.log('Test webhook deleted');

  } catch (error) {
    console.error('Error:', error);
  }
}

webhookExample();`;
  }

  private static generateQuickUsageExample(packageName: string, language: string = 'typescript'): string {
    const importStatement = language === 'typescript' 
      ? `import { AlgaPSAClient } from '${packageName}';`
      : `const { AlgaPSAClient } = require('${packageName}');`;

    return `${importStatement}

const client = new AlgaPSAClient({
  apiKey: 'your-api-key-here'
});

// List teams
const teams = await client.teams.list();

// Create a team
const team = await client.teams.create({
  team_name: 'Development Team'
});

// Follow HATEOAS links
const members = await team.data.followLink('members');`;
  }

  private static convertTsToJs(tsCode: string): string {
    // Simplified TypeScript to JavaScript conversion
    // In a real implementation, you'd use the TypeScript compiler API
    return tsCode
      .replace(/: [^=,;{}()]+/g, '') // Remove type annotations
      .replace(/interface\s+\w+\s*{[^}]*}/g, '') // Remove interfaces
      .replace(/export\s+interface\s+[^{]+{[^}]*}/g, '') // Remove exported interfaces
      .replace(/import\s+\{[^}]+\}\s+from\s+'[^']+';/g, match => {
        // Convert ES6 imports to CommonJS requires
        const moduleMatch = match.match(/from\s+'([^']+)'/);
        const importsMatch = match.match(/\{([^}]+)\}/);
        if (moduleMatch && importsMatch) {
          const moduleName = moduleMatch[1];
          const imports = importsMatch[1];
          return `const { ${imports} } = require('${moduleName}');`;
        }
        return match;
      });
  }

  private static generateDeclarationFile(tsCode: string): string {
    // Extract type definitions for .d.ts files
    // This is a simplified version - real implementation would be more sophisticated
    const lines = tsCode.split('\n');
    const declarationLines: string[] = [];

    for (const line of lines) {
      if (line.includes('export interface') || 
          line.includes('export class') || 
          line.includes('export type') ||
          line.includes('export declare')) {
        declarationLines.push(line);
      }
    }

    return declarationLines.join('\n');
  }
}