import { Knex } from 'knex';
import crypto from 'crypto';

interface ApiKeyRecord {
  api_key_id: string;
  api_key: string;
  user_id: string;
  tenant: string;
  description: string | null;
  active: boolean;
  created_at: Date;
  updated_at: Date;
  last_used_at: Date | null;
  expires_at: Date | null;
}

/**
 * Configuration for API test client
 */
export interface ApiTestConfig {
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
}

/**
 * Response wrapper for API calls
 */
export interface ApiTestResponse<T = any> {
  status: number;
  data: T;
  headers: Headers;
  ok: boolean;
}

/**
 * Error response structure
 */
export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: any;
  };
}

/**
 * API Test Client for making authenticated requests
 */
export class ApiTestClient {
  private config: ApiTestConfig;

  constructor(config: ApiTestConfig) {
    this.config = {
      baseUrl: config.baseUrl || 'http://localhost:3000',
      ...config
    };
  }

  /**
   * Set API key for authentication
   */
  setApiKey(apiKey: string): void {
    this.config.apiKey = apiKey;
  }

  /**
   * Make a GET request
   */
  async get<T = any>(path: string, options?: RequestInit & { params?: Record<string, any> }): Promise<ApiTestResponse<T>> {
    let finalPath = path;
    
    // Handle query parameters if provided
    if (options?.params) {
      const queryString = buildQueryString(options.params);
      finalPath = path + queryString;
    }
    
    return this.request<T>('GET', finalPath, undefined, options);
  }

  /**
   * Make a POST request
   */
  async post<T = any>(path: string, body?: any, options?: RequestInit): Promise<ApiTestResponse<T>> {
    return this.request<T>('POST', path, body, options);
  }

  /**
   * Make a PUT request
   */
  async put<T = any>(path: string, body?: any, options?: RequestInit): Promise<ApiTestResponse<T>> {
    return this.request<T>('PUT', path, body, options);
  }

  /**
   * Make a DELETE request
   */
  async delete<T = any>(path: string, options?: RequestInit & { data?: any }): Promise<ApiTestResponse<T>> {
    return this.request<T>('DELETE', path, options?.data, options);
  }

  /**
   * Make a PATCH request
   */
  async patch<T = any>(path: string, body?: any, options?: RequestInit): Promise<ApiTestResponse<T>> {
    return this.request<T>('PATCH', path, body, options);
  }

  /**
   * Internal method to make requests
   */
  private async request<T>(
    method: string,
    path: string,
    body?: any,
    options?: RequestInit
  ): Promise<ApiTestResponse<T>> {
    const url = `${this.config.baseUrl}${path}`;
    
    const headers: Record<string, string> = {
      ...this.config.headers,
      ...options?.headers as any
    };

    // Add API key if set
    if (this.config.apiKey) {
      headers['x-api-key'] = this.config.apiKey;
    }

    // Add tenant ID if set
    // Add content-type for body requests
    if (body && !headers['content-type']) {
      headers['content-type'] = 'application/json';
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      ...options
    });

    const responseData = await response.json().catch(() => null);

    return {
      status: response.status,
      data: responseData,
      headers: response.headers,
      ok: response.ok
    };
  }
}

/**
 * Create an API key for testing
 * @param db Knex database instance
 * @param userId User ID to create API key for
 * @param tenant Tenant ID
 * @param description Optional description for the API key
 * @returns The created API key record with plaintext key
 */
export async function createTestApiKey(
  db: Knex,
  userId: string,
  tenant: string,
  description: string = 'Test API Key'
): Promise<ApiKeyRecord> {
  const plaintextKey = crypto.randomBytes(32).toString('hex');
  const hashedKey = crypto.createHash('sha256').update(plaintextKey).digest('hex');
  
  const [record] = await db('api_keys')
    .insert({
      api_key: hashedKey,
      user_id: userId,
      tenant,
      description,
      active: true,
      created_at: new Date(),
      updated_at: new Date()
    })
    .returning('*');
  
  if (!record) {
    throw new Error(`Failed to create API key for user ${userId} in tenant ${tenant}`);
  }

  // Return the record with the plaintext key (only time it's available)
  return {
    ...record,
    api_key: plaintextKey
  };
}

/**
 * Clean up API keys created during testing
 * @param db Knex database instance
 * @param tenant Tenant ID
 */
export async function cleanupTestApiKeys(db: Knex, tenant: string): Promise<void> {
  await db('api_keys')
    .where('tenant', tenant)
    .where('description', 'like', 'Test%')
    .delete();
}

/**
 * Create headers for API requests
 * @param apiKey API key for authentication
 * @param additionalHeaders Additional headers to include
 */
export function createApiHeaders(apiKey: string, additionalHeaders?: Record<string, string>): Record<string, string> {
  return {
    'x-api-key': apiKey,
    'content-type': 'application/json',
    ...additionalHeaders
  };
}

/**
 * Assert successful API response
 * @param response API test response
 * @param expectedStatus Expected status code (default 200)
 */
export function assertSuccess<T>(response: ApiTestResponse<T>, expectedStatus: number = 200): void {
  if (response.status !== expectedStatus) {
    throw new Error(
      `Expected status ${expectedStatus} but got ${response.status}. Response: ${JSON.stringify(response.data)}`
    );
  }
}

/**
 * Assert error API response
 * @param response API test response
 * @param expectedStatus Expected error status code
 * @param expectedCode Expected error code
 */
export function assertError(response: ApiTestResponse<any>, expectedStatus: number, expectedCode?: string): void {
  if (response.status !== expectedStatus) {
    throw new Error(
      `Expected status ${expectedStatus} but got ${response.status}. Response: ${JSON.stringify(response.data)}`
    );
  }

  if (expectedCode && response.data?.error?.code !== expectedCode) {
    throw new Error(
      `Expected error code ${expectedCode} but got ${response.data?.error?.code}`
    );
  }
}

/**
 * Extract pagination metadata from response
 */
export function extractPagination(response: ApiTestResponse<any>) {
  return response.data?.pagination || null;
}

/**
 * Build query string from parameters
 */
export function buildQueryString(params: Record<string, any>): string {
  const searchParams = new URLSearchParams();
  
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      searchParams.append(key, String(value));
    }
  });

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

/**
 * Assert paginated API response
 * @param response API test response
 */
export function assertPaginated(response: ApiTestResponse<any>): void {
  if (!response.data?.pagination) {
    throw new Error('Response is not paginated - missing pagination metadata');
  }
  
  const { pagination } = response.data;
  
  if (typeof pagination.page !== 'number') {
    throw new Error('Pagination missing page number');
  }
  
  if (typeof pagination.limit !== 'number') {
    throw new Error('Pagination missing limit');
  }
  
  if (typeof pagination.total !== 'number') {
    throw new Error('Pagination missing total count');
  }
  
  if (typeof pagination.totalPages !== 'number') {
    throw new Error('Pagination missing totalPages');
  }
}
