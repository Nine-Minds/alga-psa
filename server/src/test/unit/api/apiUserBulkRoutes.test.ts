/**
 * Bulk user routes over the v1 API (alga-2026-0003355).
 *
 * `POST /api/v1/users/bulk/create` used to delegate to ApiUserController.create(),
 * so a batch body was validated against the single-user schema and at most the
 * first user was ever created; `PUT /api/v1/users/bulk/deactivate` delegated to
 * update(), whose id extraction read the literal path segment "bulk" and failed
 * UUID validation, so the route could not work at all. Both now reach dedicated
 * controller handlers that validate the bulk schemas and hand the whole batch to
 * UserService.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  bulkCreateCalls: [] as Array<{ users: any[]; options: any }>,
  bulkDeactivateCalls: [] as Array<{ userIds: string[]; deactivate: boolean }>,
  singleCreateCalls: 0,
  singleUpdateCalls: 0,
  bulkCreateError: null as Error | null,
}));

vi.mock('@alga-psa/users', () => ({
  UserService: class {
    async bulkCreateUsers(users: any[], _context: unknown, options: any) {
      state.bulkCreateCalls.push({ users, options });
      if (state.bulkCreateError) {
        throw state.bulkCreateError;
      }
      return {
        total_processed: users.length,
        successful: users.length,
        failed: 0,
        errors: [],
        results: users.map((user: any, index: number) => ({ user_id: `user-${index}`, email: user.email })),
      };
    }
    async bulkDeactivateUsers(userIds: string[], deactivate: boolean, _context: unknown) {
      state.bulkDeactivateCalls.push({ userIds, deactivate });
      return {
        total_processed: userIds.length,
        successful: userIds.length,
        failed: 0,
        errors: [],
        results: [],
      };
    }
    // The single-user paths the routes used to land on. A call here means the
    // route regressed to create()/update().
    async create() {
      state.singleCreateCalls += 1;
      return {};
    }
    async update() {
      state.singleUpdateCalls += 1;
      return {};
    }
  },
}));

vi.mock('@/lib/db/db', () => ({ getConnection: vi.fn(async () => ({})) }));
vi.mock('@/lib/api/middleware/apiContextPermission', () => ({
  hasApiContextPermission: vi.fn(async () => true),
}));

const CONTEXT = {
  userId: 'actor-1',
  tenant: 'tenant-1',
  user: { user_id: 'actor-1', user_type: 'internal' },
};

const { ApiUserController } = await import('@/lib/api/controllers/ApiUserController');
(ApiUserController.prototype as any).authenticate = async (req: any) => {
  req.context = { ...CONTEXT };
  return req;
};

const createRoute = await import('@/app/api/v1/users/bulk/create/route');
const deactivateRoute = await import('@/app/api/v1/users/bulk/deactivate/route');

const JSON_HEADERS = { 'content-type': 'application/json' };

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const ROLE_ID = '33333333-3333-4333-8333-333333333333';

function newUser(suffix: string) {
  return {
    username: `tech.${suffix}`,
    email: `tech.${suffix}@example.com`,
    password: 'Zq7!quartzFern',
    first_name: 'Tech',
    last_name: suffix.toUpperCase(),
    role_ids: [ROLE_ID],
  };
}

async function postBulkCreate(body: unknown) {
  const response = await createRoute.POST(
    new Request('http://localhost/api/v1/users/bulk/create', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: await response.json() };
}

async function putBulkDeactivate(body: unknown) {
  const response = await deactivateRoute.PUT(
    new Request('http://localhost/api/v1/users/bulk/deactivate', {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  state.bulkCreateCalls = [];
  state.bulkDeactivateCalls = [];
  state.singleCreateCalls = 0;
  state.singleUpdateCalls = 0;
  state.bulkCreateError = null;
});

describe('POST /api/v1/users/bulk/create', () => {
  it('hands the whole users array and the options to bulkCreateUsers', async () => {
    const users = [newUser('a'), newUser('b'), newUser('c')];

    const { status, body } = await postBulkCreate({ users, options: { skip_invalid: false } });

    expect(status).toBe(201);
    expect(state.singleCreateCalls).toBe(0);
    expect(state.bulkCreateCalls).toHaveLength(1);
    expect(state.bulkCreateCalls[0].users.map((user: any) => user.email)).toEqual([
      'tech.a@example.com',
      'tech.b@example.com',
      'tech.c@example.com',
    ]);
    expect(state.bulkCreateCalls[0].options).toMatchObject({ skip_invalid: false });
    expect(body.data).toMatchObject({ total_processed: 3, successful: 3, failed: 0 });
  });

  it('applies the documented option defaults when the caller omits options', async () => {
    await postBulkCreate({ users: [newUser('a')] });

    // An omitted options object must mean the same as `options: {}` —
    // skip_invalid is documented as defaulting to true either way.
    expect(state.bulkCreateCalls[0].options).toEqual({
      send_welcome_email: true,
      force_password_reset: false,
      skip_invalid: true,
      dry_run: false,
    });
  });

  it('400s a single-user body instead of creating one user from it', async () => {
    const { status, body } = await postBulkCreate(newUser('a'));

    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(state.bulkCreateCalls).toEqual([]);
    expect(state.singleCreateCalls).toBe(0);
  });

  it('400s an empty batch', async () => {
    const { status } = await postBulkCreate({ users: [] });

    expect(status).toBe(400);
    expect(state.bulkCreateCalls).toEqual([]);
  });

  it('409s a duplicate email when skip_invalid rolls the batch back', async () => {
    // skip_invalid: false rethrows the rejected user's error after the rollback;
    // the caller gets the same 409 the single-user create path returns, not an
    // opaque 500 with the message masked.
    state.bulkCreateError = new Error('A user with this email address already exists');

    const { status, body } = await postBulkCreate({
      users: [newUser('a')],
      options: { skip_invalid: false },
    });

    expect(status).toBe(409);
    expect(body.error.message).toContain('already exists');
  });

  it('passes a seat-limit refusal through as the 403 single create returns', async () => {
    // UserService throws LicenseLimitError when the tenant has no seat left.
    // bulkCreate() only rewrites "already exists"; everything else has to reach
    // handleApiError untouched, keeping its own status and code.
    state.bulkCreateError = Object.assign(new Error('No available user licenses for this tenant'), {
      name: 'LicenseLimitError',
      statusCode: 403,
      code: 'LICENSE_LIMIT_REACHED',
    });

    const { status, body } = await postBulkCreate({
      users: [newUser('a')],
      options: { skip_invalid: false },
    });

    expect(status).toBe(403);
    expect(body.error.code).toBe('LICENSE_LIMIT_REACHED');
    expect(body.error.message).toContain('No available user licenses');
  });
});

describe('PUT /api/v1/users/bulk/deactivate', () => {
  it('hands the user ids and the deactivate flag to bulkDeactivateUsers', async () => {
    const { status, body } = await putBulkDeactivate({ user_ids: [USER_A, USER_B], deactivate: true });

    expect(status).toBe(200);
    expect(state.singleUpdateCalls).toBe(0);
    expect(state.bulkDeactivateCalls).toEqual([{ userIds: [USER_A, USER_B], deactivate: true }]);
    expect(body.data).toMatchObject({ total_processed: 2, successful: 2 });
  });

  it('no longer fails UUID extraction on the "bulk" path segment', async () => {
    const { status, body } = await putBulkDeactivate({ user_ids: [USER_A] });

    expect(status).toBe(200);
    expect(JSON.stringify(body)).not.toContain('Invalid user ID format');
    // deactivate defaults to true, so an omitted flag still deactivates.
    expect(state.bulkDeactivateCalls).toEqual([{ userIds: [USER_A], deactivate: true }]);
  });

  it('reactivates when deactivate is false', async () => {
    await putBulkDeactivate({ user_ids: [USER_A], deactivate: false });

    expect(state.bulkDeactivateCalls).toEqual([{ userIds: [USER_A], deactivate: false }]);
  });

  it('400s ids that are not UUIDs', async () => {
    const { status, body } = await putBulkDeactivate({ user_ids: ['not-a-uuid'] });

    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(state.bulkDeactivateCalls).toEqual([]);
  });
});
