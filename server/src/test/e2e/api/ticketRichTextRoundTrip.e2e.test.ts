import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import path from 'node:path';
import { parse } from 'node:url';
import { createRequire } from 'node:module';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { AddressInfo } from 'node:net';
import type { Knex } from 'knex';
import { resetTenantConnectionPool } from '@alga-psa/db';
import baseKnexConfig from '@/lib/db/knexfile';
import { setupE2ETestEnvironment, type E2ETestEnvironment } from '../utils/e2eTestSetup';
import { createTestTicket } from '../utils/ticketTestData';
import { assertSuccess } from '../utils/apiTestHelpers';

const cjsRequire = createRequire(import.meta.url);
const TEST_DB_NAME = 'test_database';
const TEST_DB_HOST = '127.0.0.1';
const TEST_DB_PORT = '5438';
const TEST_DB_ADMIN_USER = 'postgres';
const TEST_DB_APP_USER = 'app_user';
const TEST_DB_PASSWORD = process.env.DB_PASSWORD_SERVER || 'postpass123';

let originalNextRuntime: string | undefined;
let originalSkipAppInit: string | undefined;
let nextApp: any = null;
let server: http.Server | null = null;
let baseUrl = '';
let env: E2ETestEnvironment | null = null;
let boardId = '';
let statusIds: { open: string; inProgress: string; closed: string };
let priorityIds: { low: string; medium: string; high: string };

if (typeof (globalThis as any).AsyncLocalStorage === 'undefined') {
  (globalThis as any).AsyncLocalStorage = AsyncLocalStorage;
}

function configureTicketTestDatabase(): void {
  process.env.NEXT_TELEMETRY_DISABLED = process.env.NEXT_TELEMETRY_DISABLED ?? '1';
  process.env.NODE_ENV = 'test';
  process.env.NEXTAUTH_URL = process.env.NEXTAUTH_URL || 'http://127.0.0.1:3000';
  process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'localtest-nextauth-secret';
  process.env.DB_HOST = TEST_DB_HOST;
  process.env.DB_PORT = TEST_DB_PORT;
  process.env.DB_NAME_SERVER = TEST_DB_NAME;
  process.env.DB_USER_ADMIN = TEST_DB_ADMIN_USER;
  process.env.DB_USER_SERVER = TEST_DB_APP_USER;
  process.env.DB_PASSWORD_ADMIN = TEST_DB_PASSWORD;
  process.env.DB_PASSWORD_SERVER = TEST_DB_PASSWORD;

  baseKnexConfig.development.connection = {
    ...(baseKnexConfig.development.connection ?? {}),
    host: TEST_DB_HOST,
    port: Number(TEST_DB_PORT),
    user: TEST_DB_APP_USER,
    password: TEST_DB_PASSWORD,
    database: TEST_DB_NAME,
  };

  if (baseKnexConfig.production) {
    baseKnexConfig.production.connection = {
      ...(baseKnexConfig.production.connection ?? {}),
      host: TEST_DB_HOST,
      port: Number(TEST_DB_PORT),
      user: TEST_DB_APP_USER,
      password: TEST_DB_PASSWORD,
      database: TEST_DB_NAME,
    };
  }
}

async function resolveTicketDefaults(db: Knex, tenant: string): Promise<void> {
  const [board, openStatus, inProgressStatus, closedStatus, lowPriority, mediumPriority, highPriority] = await Promise.all([
    db('boards').where({ tenant, is_default: true }).first(),
    db('statuses').where({ tenant, name: 'New', status_type: 'ticket' }).first(),
    db('statuses').where({ tenant, name: 'In Progress', status_type: 'ticket' }).first(),
    db('statuses').where({ tenant, name: 'Closed', status_type: 'ticket' }).first(),
    db('priorities').where({ tenant, priority_name: 'Low' }).first(),
    db('priorities').where({ tenant, priority_name: 'Medium' }).first(),
    db('priorities').where({ tenant, priority_name: 'High' }).first(),
  ]);

  if (!board || !openStatus || !inProgressStatus || !closedStatus || !lowPriority || !mediumPriority || !highPriority) {
    throw new Error('Ticket E2E defaults were not created by setupE2ETestEnvironment');
  }

  boardId = board.board_id;
  statusIds = {
    open: openStatus.status_id,
    inProgress: inProgressStatus.status_id,
    closed: closedStatus.status_id,
  };
  priorityIds = {
    low: lowPriority.priority_id,
    medium: mediumPriority.priority_id,
    high: highPriority.priority_id,
  };
}

describe('Ticket rich-text round-trip E2E', () => {
  beforeAll(async () => {
    configureTicketTestDatabase();

    originalNextRuntime = process.env.NEXT_RUNTIME;
    originalSkipAppInit = process.env.E2E_SKIP_APP_INIT;
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.E2E_SKIP_APP_INIT = 'true';

    const appDir = path.resolve(__dirname, '../../../../../server');
    const createNextServer = cjsRequire('next');
    nextApp = createNextServer({
      dev: true,
      dir: appDir,
      hostname: TEST_DB_HOST,
      port: 0,
    });
    await nextApp.prepare();
    const requestHandler = nextApp.getRequestHandler();

    server = http.createServer((req, res) => {
      const parsedUrl = parse(req.url ?? '', true);
      requestHandler(req, res, parsedUrl);
    });
    await new Promise<void>((resolve) => server!.listen(0, TEST_DB_HOST, resolve));
    const address = server!.address() as AddressInfo;
    baseUrl = `http://${TEST_DB_HOST}:${address.port}`;

    env = await setupE2ETestEnvironment({ baseUrl });
    await resolveTicketDefaults(env.db, env.tenant);
  }, 180_000);

  afterAll(async () => {
    try {
      await resetTenantConnectionPool();
      await env?.cleanup();
      env = null;
      if (server) {
        await new Promise<void>((resolve, reject) => {
          server!.close((error) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        }).catch(() => undefined);
        server = null;
      }
      if (nextApp && typeof nextApp.close === 'function') {
        await nextApp.close().catch(() => undefined);
      }
    } finally {
      nextApp = null;
      if (originalNextRuntime === undefined) {
        delete process.env.NEXT_RUNTIME;
      } else {
        process.env.NEXT_RUNTIME = originalNextRuntime;
      }
      if (originalSkipAppInit === undefined) {
        delete process.env.E2E_SKIP_APP_INIT;
      } else {
        process.env.E2E_SKIP_APP_INIT = originalSkipAppInit;
      }
    }
  });

  it('updates a serialized rich-text description through the ticket API and round-trips the saved value', async () => {
    const ticket = await createTestTicket(env!.db, env!.tenant, {
      title: 'Rich mobile description ticket',
      description: 'Legacy plain description',
      board_id: boardId,
      status_id: statusIds.open,
      priority_id: priorityIds.medium,
      client_id: env!.clientId,
    });

    const richDescription = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Updated rich description from mobile' }],
        },
      ],
    });

    const updateResponse = await env!.apiClient.put(`/api/v1/tickets/${ticket.ticket_id}`, {
      attributes: {
        description: richDescription,
      },
    });
    assertSuccess(updateResponse);
    expect(updateResponse.data.data.attributes?.description).toBe(richDescription);

    const refetchResponse = await env!.apiClient.get(`/api/v1/tickets/${ticket.ticket_id}`);
    assertSuccess(refetchResponse);
    expect(refetchResponse.data.data.attributes?.description).toBe(richDescription);
    expect(refetchResponse.data.data.description_html).toContain('Updated rich description from mobile');
  });

  it('creates a serialized rich-text comment through the ticket API and returns render-friendly content on refetch', async () => {
    const ticket = await createTestTicket(env!.db, env!.tenant, {
      title: 'Rich mobile comment ticket',
      board_id: boardId,
      status_id: statusIds.open,
      priority_id: priorityIds.medium,
      client_id: env!.clientId,
    });

    const richComment = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Rich mobile comment round trip' }],
        },
      ],
    });

    const createResponse = await env!.apiClient.post(`/api/v1/tickets/${ticket.ticket_id}/comments`, {
      comment_text: richComment,
      is_internal: true,
    });
    assertSuccess(createResponse, 201);
    expect(createResponse.data.data.comment_text).toBe(richComment);

    const listResponse = await env!.apiClient.get(`/api/v1/tickets/${ticket.ticket_id}/comments`);
    assertSuccess(listResponse);
    expect(listResponse.data.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          comment_text: richComment,
          comment_html: expect.stringContaining('Rich mobile comment round trip'),
        }),
      ]),
    );
  });
});
