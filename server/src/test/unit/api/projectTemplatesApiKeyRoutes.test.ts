/**
 * API-key callers of the unversioned project-template routes
 * (alga-2026-0002902).
 *
 * These routes delegate straight to `withAuth` server actions, which resolve the
 * caller from the NextAuth session only. With an `x-api-key` and no session the
 * action threw `AuthenticationError: User not authenticated` and the route
 * answered 500 — even though the endpoints are published as ApiKeyAuth in the
 * OpenAPI spec. `runWithApiKeyOrSession` establishes the key's user as the
 * effective identity; a caller with neither identity gets a 401, never a 500.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => {
  class AuthenticationError extends Error {
    constructor(message = 'User not authenticated') {
      super(message);
      this.name = 'AuthenticationError';
    }
  }
  return {
    AuthenticationError,
    state: {
      /** Identity the mocked `withAuth` actions see; only set by the API-key bridge. */
      apiKeyUser: null as unknown,
      keyValid: true,
      listFilters: undefined as unknown,
      createdFrom: undefined as unknown,
      applied: undefined as unknown,
    },
  };
});

vi.mock('@alga-psa/auth', () => ({
  AuthenticationError: h.AuthenticationError,
  runWithApiKeyUser: async (user: unknown, fn: () => Promise<unknown>) => {
    h.state.apiKeyUser = user;
    try {
      return await fn();
    } finally {
      h.state.apiKeyUser = null;
    }
  },
}));

vi.mock('@/lib/api/middleware/apiAuthMiddleware', () => ({
  authenticateApiKeyRequest: async (req: Request) => {
    if (!h.state.keyValid) {
      throw Object.assign(new Error('Invalid API key'), { name: 'UnauthorizedError', statusCode: 401 });
    }
    const authed = req as Request & { context?: unknown };
    authed.context = { tenant: 'tenant-1', user: { user_id: 'user-1', tenant: 'tenant-1' } };
    return authed;
  },
}));

vi.mock('@alga-psa/projects/actions/projectTemplateActions', () => {
  // Stands in for the real `withAuth` wrapper: no resolvable caller -> throw.
  const requireUser = () => {
    if (!h.state.apiKeyUser) {
      throw new h.AuthenticationError();
    }
  };
  return {
    getTemplates: async (filters: unknown) => {
      requireUser();
      h.state.listFilters = filters;
      return [{ template_id: 'template-1', template_name: 'Onboarding' }];
    },
    createTemplateFromProject: async (projectId: string, data: unknown) => {
      requireUser();
      h.state.createdFrom = { projectId, data };
      return 'template-2';
    },
    applyTemplate: async (templateId: string, data: unknown) => {
      requireUser();
      h.state.applied = { templateId, data };
      return 'project-9';
    },
    getTemplateWithDetails: async () => {
      requireUser();
      return { template_id: 'template-1' };
    },
    updateTemplate: async () => {
      requireUser();
      return { template_id: 'template-1' };
    },
    deleteTemplate: async () => {
      requireUser();
      return { success: true };
    },
    duplicateTemplate: async () => {
      requireUser();
      return 'template-3';
    },
    getTemplateCategories: async () => {
      requireUser();
      return ['Onboarding'];
    },
  };
});

const API_KEY_HEADERS = { 'x-api-key': 'key-123' };

function request(url: string, init: RequestInit = {}): NextRequest {
  return new NextRequest(new Request(url, init));
}

async function listTemplates(headers: Record<string, string> = {}) {
  const { GET } = await import('../../../app/api/projects/templates/route');
  const response = await GET(
    request('http://localhost/api/projects/templates?category=Onboarding', { headers }),
  );
  return { status: response.status, body: await response.json() };
}

async function createTemplate(headers: Record<string, string> = {}) {
  const { POST } = await import('../../../app/api/projects/templates/route');
  const response = await POST(
    request('http://localhost/api/projects/templates', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ project_id: 'project-1', template_name: 'Onboarding' }),
    }),
  );
  return { status: response.status, body: await response.json() };
}

async function applyTemplateRoute(headers: Record<string, string> = {}) {
  const { POST } = await import('../../../app/api/projects/templates/[templateId]/apply/route');
  const response = await POST(
    request('http://localhost/api/projects/templates/template-1/apply', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ project_name: 'Rollout', client_id: 'client-1' }),
    }),
    { params: { templateId: 'template-1' } },
  );
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  vi.resetModules();
  h.state.apiKeyUser = null;
  h.state.keyValid = true;
  h.state.listFilters = undefined;
  h.state.createdFrom = undefined;
  h.state.applied = undefined;
});

describe('project template routes with an API key and no session', () => {
  it('lists templates (200) instead of 500', async () => {
    const { status, body } = await listTemplates(API_KEY_HEADERS);

    expect(status).toBe(200);
    expect(body).toEqual([{ template_id: 'template-1', template_name: 'Onboarding' }]);
    expect(h.state.listFilters).toEqual({ category: 'Onboarding', search: undefined });
  });

  it('creates a template (201) instead of 500', async () => {
    const { status, body } = await createTemplate(API_KEY_HEADERS);

    expect(status).toBe(201);
    expect(body).toEqual({ template_id: 'template-2' });
    expect(h.state.createdFrom).toMatchObject({ projectId: 'project-1' });
  });

  it('applies a template (201) instead of 500', async () => {
    const { status, body } = await applyTemplateRoute(API_KEY_HEADERS);

    expect(status).toBe(201);
    expect(body).toEqual({ project_id: 'project-9' });
    expect(h.state.applied).toMatchObject({ templateId: 'template-1' });
  });
});

describe('project template routes without any identity', () => {
  it('answers 401 for list/create/apply, never 500', async () => {
    expect((await listTemplates()).status).toBe(401);
    expect((await createTemplate()).status).toBe(401);
    expect((await applyTemplateRoute()).status).toBe(401);
  });

  it('answers 401 when the API key itself is rejected', async () => {
    h.state.keyValid = false;

    const { status, body } = await listTemplates(API_KEY_HEADERS);

    expect(status).toBe(401);
    expect(body.error).toMatch(/Unauthorized/);
  });
});
