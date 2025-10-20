import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupE2ETestEnvironment, E2ETestEnvironment } from '../utils/e2eTestSetup';
import { ApiTestClient } from '../utils/apiTestHelpers';
import {
  createServiceRequestData,
  ensureServiceType,
  ServiceRequestPayload
} from '../utils/serviceTestData';
import {
  ensureApiServerRunning,
  resolveApiBaseUrl,
  stopApiServerIfStarted
} from '../utils/apiServerManager';

type BillingMethod = 'fixed' | 'hourly' | 'usage';

const TEST_TIMEOUT = 60000;

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

interface ServiceRecord {
  service_id: string;
  service_name: string;
  custom_service_type_id: string;
  billing_method: BillingMethod;
  default_rate: number;
  unit_of_measure: string;
  category_id: string | null;
  tax_rate_id: string | null;
  description: string | null;
  tenant: string;
  service_type_name?: string;
  created_at?: string;
  updated_at?: string;
}

interface SuccessResponse<T> {
  data: T;
  meta?: unknown;
}

interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  meta?: unknown;
}

// Ensure the API server uses the same database as the E2E test fixtures
process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'sebastian_test';
if (!process.env.DB_USER_SERVER && process.env.DB_USER_ADMIN) {
  process.env.DB_USER_SERVER = process.env.DB_USER_ADMIN;
}
if (!process.env.DB_PASSWORD_SERVER && process.env.DB_PASSWORD_ADMIN) {
  process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_ADMIN;
}
process.env.DB_HOST = process.env.DB_HOST || 'localhost';
process.env.DB_PORT = process.env.DB_PORT || '5432';

const apiBaseUrl = resolveApiBaseUrl(process.env.TEST_API_BASE_URL);

describe('Services API E2E Tests', () => {
  let env: E2ETestEnvironment;
  const createdServiceIds = new Set<string>();
  const serviceTypeIds: Record<BillingMethod, string> = {
    fixed: '',
    hourly: '',
    usage: ''
  };
  beforeAll(async () => {
    await ensureApiServerRunning(apiBaseUrl);

    env = await setupE2ETestEnvironment({
      baseUrl: apiBaseUrl,
      clientName: 'Services API Test Client',
      userName: 'services_api_test'
    });

    serviceTypeIds.fixed = await ensureServiceType(env.db, env.tenant, 'fixed');
    serviceTypeIds.hourly = await ensureServiceType(env.db, env.tenant, 'hourly');
    serviceTypeIds.usage = await ensureServiceType(env.db, env.tenant, 'usage');
  }, 120_000);

  afterAll(async () => {
    for (const serviceId of createdServiceIds) {
      try {
        await env.apiClient.delete<null>(`/api/v1/services/${serviceId}`);
      } catch {
        // Ignore cleanup errors (resource might already be removed)
      }
    }

    await env.cleanup();
    await stopApiServerIfStarted();
  }, 60_000);

  describe('Authentication', () => {
    it('rejects requests without API key', async () => {
      const client = new ApiTestClient({
        baseUrl: apiBaseUrl,
        tenantId: env.tenant
      });

      const response = await client.get<ErrorResponse>('/api/v1/services');

      expect(response.status).toBe(401);
      const errorPayload = response.data?.error;
      if (typeof errorPayload === 'string') {
        expect(errorPayload).toMatch(/API key/i);
      } else {
        expect(errorPayload?.message).toMatch(/API key/i);
      }
    }, TEST_TIMEOUT);

    it('rejects requests with invalid API key', async () => {
      const client = new ApiTestClient({
        baseUrl: apiBaseUrl,
        tenantId: env.tenant,
        apiKey: 'invalid-api-key'
      });

      const response = await client.get<ErrorResponse>('/api/v1/services');

      expect(response.status).toBe(401);
      const errorPayload = response.data?.error;
      if (typeof errorPayload === 'string') {
        expect(errorPayload).toMatch(/invalid/i);
      } else {
        expect(errorPayload?.message).toMatch(/invalid/i);
      }
    }, TEST_TIMEOUT);

    it('accepts requests with valid API key', async () => {
      const response = await env.apiClient.get<PaginatedResponse<ServiceRecord>>(
        '/api/v1/services'
      );

      if (response.status !== 200) {
        console.error(
          'List services failed:',
          response.status,
          JSON.stringify(response.data, null, 2)
        );
      }

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('data');
      expect(response.data).toHaveProperty('pagination');
    }, TEST_TIMEOUT);
  });

  describe('CRUD Operations', () => {
    it('creates a service', async () => {
      const payload: ServiceRequestPayload = await createServiceRequestData(env.db, env.tenant, {
        custom_service_type_id: serviceTypeIds.fixed
      });

      const response = await env.apiClient.post<SuccessResponse<ServiceRecord>>(
        '/api/v1/services',
        payload
      );

      if (response.status !== 201) {
        console.error('Create service failed:', response.status, JSON.stringify(response.data, null, 2));
      }

      expect(response.status).toBe(201);
      expect(response.data.data).toMatchObject({
        service_name: payload.service_name,
        billing_method: payload.billing_method,
        unit_of_measure: payload.unit_of_measure
      });
      expect(response.data.data.default_rate).toBeCloseTo(payload.default_rate, 2);
      expect(response.data.data.service_id).toBeTruthy();

      createdServiceIds.add(response.data.data.service_id);
    }, TEST_TIMEOUT);

    it('retrieves a service by ID', async () => {
      const payload: ServiceRequestPayload = await createServiceRequestData(env.db, env.tenant, {
        custom_service_type_id: serviceTypeIds.fixed
      });
      const createResponse = await env.apiClient.post<SuccessResponse<ServiceRecord>>(
        '/api/v1/services',
        payload
      );

      expect(createResponse.status).toBe(201);
      const serviceId = createResponse.data.data.service_id;
      createdServiceIds.add(serviceId);

      const response = await env.apiClient.get<SuccessResponse<ServiceRecord>>(
        `/api/v1/services/${serviceId}`
      );

      expect(response.status).toBe(200);
      expect(response.data.data.service_id).toBe(serviceId);
      expect(response.data.data.service_name).toBe(payload.service_name);
    }, TEST_TIMEOUT);

    it('updates a service', async () => {
      const payload: ServiceRequestPayload = await createServiceRequestData(env.db, env.tenant, {
        custom_service_type_id: serviceTypeIds.fixed
      });
      const createResponse = await env.apiClient.post<SuccessResponse<ServiceRecord>>(
        '/api/v1/services',
        payload
      );

      expect(createResponse.status).toBe(201);
      const serviceId = createResponse.data.data.service_id;
      createdServiceIds.add(serviceId);

      const updatedRate = payload.default_rate + 2500;
      const updatePayload = {
        service_name: `${payload.service_name} Updated`,
        default_rate: updatedRate,
        description: 'Updated service description',
        unit_of_measure: 'unit'
      };

      const response = await env.apiClient.put<SuccessResponse<ServiceRecord>>(
        `/api/v1/services/${serviceId}`,
        updatePayload
      );

      if (response.status !== 200) {
        console.error('Update service failed:', response.status, JSON.stringify(response.data, null, 2));
      }

      expect(response.status).toBe(200);
      expect(response.data.data).toMatchObject({
        service_id: serviceId,
        service_name: updatePayload.service_name,
        description: updatePayload.description,
        unit_of_measure: updatePayload.unit_of_measure
      });
      expect(response.data.data.default_rate).toBe(updatePayload.default_rate);
    }, TEST_TIMEOUT);

    it('deletes a service', async () => {
      const payload: ServiceRequestPayload = await createServiceRequestData(env.db, env.tenant, {
        custom_service_type_id: serviceTypeIds.fixed
      });
      const createResponse = await env.apiClient.post<SuccessResponse<ServiceRecord>>(
        '/api/v1/services',
        payload
      );

      expect(createResponse.status).toBe(201);
      const serviceId = createResponse.data.data.service_id;

      const deleteResponse = await env.apiClient.delete<null>(`/api/v1/services/${serviceId}`);
      createdServiceIds.delete(serviceId);

      expect(deleteResponse.status).toBe(204);

      const getResponse = await env.apiClient.get<ErrorResponse>(`/api/v1/services/${serviceId}`);
      expect(getResponse.status).toBe(404);
    }, TEST_TIMEOUT);

    it('lists services with pagination', async () => {
      for (let i = 0; i < 4; i++) {
        const payload: ServiceRequestPayload = await createServiceRequestData(env.db, env.tenant, {
          service_name: `Pagination Test Service ${Date.now()}-${i}`,
          custom_service_type_id: serviceTypeIds.fixed
        });
        const response = await env.apiClient.post<SuccessResponse<ServiceRecord>>(
          '/api/v1/services',
          payload
        );
        expect(response.status).toBe(201);
        createdServiceIds.add(response.data.data.service_id);
      }

      const response = await env.apiClient.get<PaginatedResponse<ServiceRecord>>(
        '/api/v1/services?limit=2&page=1&sort=service_name&order=asc'
      );

      expect(response.status).toBe(200);
      expect(Array.isArray(response.data.data)).toBe(true);
      expect(response.data.data.length).toBeLessThanOrEqual(2);
      expect(response.data.pagination).toMatchObject({
        page: 1,
        limit: 2
      });
      expect(response.data.pagination.total).toBeGreaterThan(0);
    }, TEST_TIMEOUT);
  });

  describe('Filtering and search', () => {
    it('filters services by billing method', async () => {
      for (let i = 0; i < 2; i++) {
        const payload: ServiceRequestPayload = await createServiceRequestData(env.db, env.tenant, {
          service_name: `Hourly Filter Service ${Date.now()}-${i}`,
          billing_method: 'hourly',
          custom_service_type_id: serviceTypeIds.hourly
        });
        const response = await env.apiClient.post<SuccessResponse<ServiceRecord>>(
          '/api/v1/services',
          payload
        );
        expect(response.status).toBe(201);
        createdServiceIds.add(response.data.data.service_id);
      }

      const fixedPayload: ServiceRequestPayload = await createServiceRequestData(env.db, env.tenant, {
        service_name: `Fixed Filter Service ${Date.now()}`,
        billing_method: 'fixed',
        custom_service_type_id: serviceTypeIds.fixed
      });
      const fixedResponse = await env.apiClient.post<SuccessResponse<ServiceRecord>>(
        '/api/v1/services',
        fixedPayload
      );
      expect(fixedResponse.status).toBe(201);
      createdServiceIds.add(fixedResponse.data.data.service_id);

      const response = await env.apiClient.get<PaginatedResponse<ServiceRecord>>(
        '/api/v1/services?billing_method=hourly'
      );

      expect(response.status).toBe(200);
      expect(response.data.data.length).toBeGreaterThan(0);
      for (const service of response.data.data) {
        expect(service.billing_method).toBe('hourly');
      }
    }, TEST_TIMEOUT);

    it('searches services by name fragment', async () => {
      const uniqueName = `Observability Search Service ${Date.now()}`;
      const payload: ServiceRequestPayload = await createServiceRequestData(env.db, env.tenant, {
        service_name: uniqueName,
        custom_service_type_id: serviceTypeIds.fixed
      });
      const createResponse = await env.apiClient.post<SuccessResponse<ServiceRecord>>(
        '/api/v1/services',
        payload
      );
      expect(createResponse.status).toBe(201);
      const serviceId = createResponse.data.data.service_id;
      createdServiceIds.add(serviceId);

      const response = await env.apiClient.get<PaginatedResponse<ServiceRecord>>(
        '/api/v1/services?search=observability'
      );

      expect(response.status).toBe(200);
      const match = response.data.data.find(
        (service) => service.service_id === serviceId
      );
      expect(match).toBeDefined();
      expect(match.service_name).toBe(uniqueName);
    }, TEST_TIMEOUT);
  });
});
