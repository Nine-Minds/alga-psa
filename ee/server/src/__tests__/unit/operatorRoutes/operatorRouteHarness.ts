/**
 * Shared harness for the operator-route auth regression tests.
 *
 * Design (see docs/plans/2026-10-13-tenant-mgmt-header-regression-plan.md):
 * - Only identity sources are mocked (getCurrentUser, hasPermission,
 *   ApiKeyServiceForApi.validateApiKeyAnyTenant). The real gate, the real
 *   tenant-management error mapper and the real handleApplianceTrigger run.
 * - Every module a route reaches after the gate is a "tripwire": all of its
 *   exports are spies that write to one shared call log.
 * - Mock state lives on globalThis because `vi.resetModules()` (needed so the
 *   route re-reads MASTER_BILLING_TENANT_ID) would otherwise give the spec file
 *   and the mock factories different instances of this module.
 *
 * `vi.mock` calls are hoisted per file, so each spec declares them and pulls
 * the factories from here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

export const MASTER = '00000000-0000-4000-8000-0000000000aa';
export const OTHER_TENANT = '00000000-0000-4000-8000-0000000000bb';

/** Header set the removed header-trust branch used to accept. Sent on every case. */
export const SPOOFED_HEADERS: Record<string, string> = {
  'x-internal-request': 'ext-proxy-prefetch',
  'x-internal-user-id': 'attacker',
  'x-internal-user-tenant': MASTER,
  'x-internal-user-email': 'attacker@example.test',
};

export type Surface = 'tenant-management' | 'provisioning' | 'platform' | 'appliance';
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RouteRow {
  /** Unique, human readable id used as the describe title. */
  id: string;
  surface: Surface;
  /** Route file relative to ee/server/src/app/api, e.g. `v1/tenant-management/start-deletion/route.ts`. */
  file: string;
  /** Exported handler this row calls. */
  method: HttpMethod;
  load: () => Promise<Record<string, unknown>>;
  /** Path plus query. */
  url: string;
  /** Dynamic segments, delivered as `context.params`. */
  params?: Record<string, string>;
  /** JSON body (valid for the handler, incl. any `__method` override). */
  body?: Record<string, unknown>;
  /**
   * The handler reaches no downstream module after the gate (it returns static
   * data), so P cannot see a tripwire hit. P then requires a 200 instead.
   */
  staticAfterGate?: boolean;
}

// ---------------------------------------------------------------- state

interface HarnessState {
  calls: string[];
  allowedCalls: string[];
  getCurrentUser: ReturnType<typeof vi.fn>;
  hasPermission: ReturnType<typeof vi.fn>;
  validateApiKeyAnyTenant: ReturnType<typeof vi.fn>;
}

const STATE_KEY = Symbol.for('alga.operatorRoutes.harness');

export function state(): HarnessState {
  const g = globalThis as unknown as Record<symbol, HarnessState>;
  if (!g[STATE_KEY]) {
    g[STATE_KEY] = {
      calls: [],
      allowedCalls: [],
      getCurrentUser: vi.fn(),
      hasPermission: vi.fn(),
      validateApiKeyAnyTenant: vi.fn(),
    };
  }
  return g[STATE_KEY];
}

function resetState(): void {
  const s = state();
  s.calls.length = 0;
  s.allowedCalls.length = 0;
  s.getCurrentUser.mockReset();
  s.hasPermission.mockReset();
  s.validateApiKeyAnyTenant.mockReset();
}

// ------------------------------------------------------- mock factories

/**
 * Module whose every export (functions and classes) is a spy that records
 * `<module>#<export>` in the shared call log. `allowed` modules (logging) log
 * to a separate list that rejection assertions ignore.
 */
export function tripwire(moduleId: string, options: { allowed?: boolean } = {}): Record<string, unknown> {
  const log = (entry: string) => (options.allowed ? state().allowedCalls : state().calls).push(entry);

  // A spy that is also callable-through-properties, so object exports such as
  // `observabilityLogger.info(...)` are tripwired too.
  const makeSpy = (label: string): unknown => {
    // A plain function (not an arrow) so `new Export()` works for class exports.
    const fn = vi.fn(function () {
      log(label);
    });
    const nested = new Map<string, unknown>();
    return new Proxy(fn, {
      get(t, prop, receiver) {
        if (typeof prop === 'symbol' || prop === 'then' || prop in t) return Reflect.get(t, prop, receiver);
        if (!nested.has(prop)) nested.set(prop, makeSpy(`${label}.${prop}`));
        return nested.get(prop);
      },
    });
  };

  const cache = new Map<string, unknown>();
  return new Proxy({} as Record<string, unknown>, {
    has: () => true,
    get(_t, prop) {
      // `then` must be undefined or `await import()` treats the module as a thenable.
      if (typeof prop === 'symbol' || prop === 'then' || prop === '__esModule') return undefined;
      if (!cache.has(prop)) cache.set(prop, makeSpy(`${moduleId}#${prop}`));
      return cache.get(prop);
    },
  });
}

export function identityMocks() {
  return {
    userComposition: () => ({ getCurrentUser: state().getCurrentUser }),
    auth: () => ({ hasPermission: state().hasPermission }),
    apiKeyService: () => ({
      ApiKeyServiceForApi: { validateApiKeyAnyTenant: state().validateApiKeyAnyTenant },
    }),
  };
}

// ------------------------------------------------------------ cases

export type CaseId = 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6';

const permittedMasterUser = {
  tenant: MASTER,
  user_id: 'master-operator',
  email: 'operator@example.test',
  user_type: 'internal',
};

interface RejectionCase {
  id: CaseId;
  name: string;
  setup: () => { headers: Record<string, string> };
  /** True when the session must never be consulted (api-key path is terminal). */
  sessionUntouched?: boolean;
}

export const REJECTION_CASES: RejectionCase[] = [
  {
    id: 'C1',
    name: 'no credential',
    setup: () => {
      state().getCurrentUser.mockResolvedValue(null);
      return { headers: {} };
    },
  },
  {
    id: 'C2',
    name: 'internal user of another tenant',
    setup: () => {
      state().getCurrentUser.mockResolvedValue({ ...permittedMasterUser, tenant: OTHER_TENANT });
      state().hasPermission.mockResolvedValue(true);
      return { headers: {} };
    },
  },
  {
    id: 'C3',
    name: 'master tenant internal member without permission',
    setup: () => {
      state().getCurrentUser.mockResolvedValue(permittedMasterUser);
      state().hasPermission.mockResolvedValue(false);
      return { headers: {} };
    },
  },
  {
    id: 'C4',
    name: 'client user of the master tenant',
    setup: () => {
      state().getCurrentUser.mockResolvedValue({ ...permittedMasterUser, user_type: 'client' });
      state().hasPermission.mockResolvedValue(true);
      return { headers: {} };
    },
  },
  {
    id: 'C5',
    name: 'invalid api key with a valid permitted session behind it',
    sessionUntouched: true,
    setup: () => {
      state().validateApiKeyAnyTenant.mockResolvedValue(null);
      state().getCurrentUser.mockResolvedValue(permittedMasterUser);
      state().hasPermission.mockResolvedValue(true);
      return { headers: { 'x-api-key': 'junk' } };
    },
  },
  {
    id: 'C6',
    name: 'valid api key of a non-master tenant',
    sessionUntouched: true,
    setup: () => {
      state().validateApiKeyAnyTenant.mockResolvedValue({ tenant: OTHER_TENANT, user_id: 'other-key-user' });
      state().getCurrentUser.mockResolvedValue(permittedMasterUser);
      state().hasPermission.mockResolvedValue(true);
      return { headers: { 'x-api-key': 'valid-but-other-tenant' } };
    },
  },
];

/** Status each surface is pinned to. Tenant-management and provisioning map anonymous to 401. */
export function expectedStatus(surface: Surface, caseId: CaseId): number {
  switch (surface) {
    case 'tenant-management':
      return caseId === 'C1' || caseId === 'C5' ? 401 : 403;
    case 'provisioning':
      // Only a missing session is 401; an invalid key is "Access denied" and maps to 403.
      return caseId === 'C1' ? 401 : 403;
    default:
      return 403;
  }
}

// ------------------------------------------------------------ requests

export function makeRequest(row: RouteRow, extraHeaders: Record<string, string>): NextRequest {
  const headers: Record<string, string> = { ...SPOOFED_HEADERS, ...extraHeaders };
  const init: { method: string; headers: Record<string, string>; body?: string } = {
    method: row.method,
    headers,
  };
  if (row.body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(row.body);
  }
  return new NextRequest(`http://localhost${row.url}`, init as never);
}

async function invoke(row: RouteRow, request: NextRequest): Promise<Response> {
  const mod = await row.load();
  const handler = mod[row.method] as ((req: NextRequest, ctx: unknown) => Promise<Response>) | undefined;
  if (typeof handler !== 'function') {
    throw new Error(`${row.file} does not export ${row.method}`);
  }
  return handler(request, { params: Promise.resolve(row.params ?? {}) });
}

// ------------------------------------------------------------ matrix

export function defineOperatorMatrix(title: string, rows: RouteRow[]): void {
  describe(title, () => {
    beforeEach(() => {
      // Order matters: routes read MASTER_BILLING_TENANT_ID at import time.
      vi.resetModules();
      vi.stubEnv('MASTER_BILLING_TENANT_ID', MASTER);
      resetState();
      if (!process.env.OPERATOR_TEST_DEBUG) vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    });

    describe.each(rows)('$id', (row) => {
      it.each(REJECTION_CASES)('$id rejects: $name', async (c) => {
        const { headers } = c.setup();
        const response = await invoke(row, makeRequest(row, headers));

        // Tripwires first: a handler that did downstream work must fail loudly even if it then returned 4xx.
        expect(state().calls).toEqual([]);
        expect(response.status).toBe(expectedStatus(row.surface, c.id));

        if (c.sessionUntouched) {
          expect(state().validateApiKeyAnyTenant).toHaveBeenCalledWith(headers['x-api-key']);
          expect(state().getCurrentUser).not.toHaveBeenCalled();
        } else {
          expect(state().validateApiKeyAnyTenant).not.toHaveBeenCalled();
        }
      });

      it('P positive control: a permitted master operator gets past the gate', async () => {
        state().getCurrentUser.mockResolvedValue(permittedMasterUser);
        state().hasPermission.mockResolvedValue(true);

        const response = await invoke(row, makeRequest(row, {}));

        // Without this the rejection cases could pass on an import error or a missing param.
        expect(state().getCurrentUser).toHaveBeenCalled();
        expect([401, 403]).not.toContain(response.status);
        if (row.staticAfterGate) {
          expect(response.status).toBe(200);
        } else {
          expect(state().calls.length).toBeGreaterThan(0);
        }
      });
    });
  });
}
