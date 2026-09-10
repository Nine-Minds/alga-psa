import { afterEach, expect, it, vi } from 'vitest';
const { captured } = vi.hoisted(() => ({ captured: vi.fn() }));
vi.mock('../../../../test-utils/testContext', () => ({ TestContext: class {
  async initialize() { captured({ ...process.env }); throw new Error('stop before database setup'); }
} }));
vi.mock('../../e2e/utils/docker-service-manager', () => ({ DockerServiceManager: class {} }));
vi.mock('../../e2e/utils/mailhog-client', () => ({ MailHogClient: class {} }));
vi.mock('../../e2e/utils/email-test-factory', () => ({ EmailTestFactory: class {} }));
vi.mock('../../../services/email/MailHogPollingService', () => ({ MailHogPollingService: class {} }));
import { E2ETestContext } from '../../e2e/utils/e2e-test-context';
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it('preserves explicit owned-stack endpoints before database initialization', async () => {
  const settings = { E2E_DATABASE_ISOLATED: 'true', TEST_DB_NAME: 'owned_email_test',
    DB_HOST: '127.0.0.1', DB_PORT: '55432', DB_USER_ADMIN: 'test_admin', DB_NAME_SERVER: 'different',
    PGBOUNCER_HOST: '127.0.0.1', PGBOUNCER_PORT: '56434', REDIS_HOST: '127.0.0.1', REDIS_PORT: '56379',
    EMAIL_HOST: '127.0.0.1', EMAIL_PORT: '51025' };
  Object.entries(settings).forEach(([key, value]) => vi.stubEnv(key, value));
  await expect(new E2ETestContext().initialize()).rejects.toThrow('stop before database setup');
  expect(captured).toHaveBeenCalledWith(expect.objectContaining({ ...settings, DB_NAME_SERVER: 'owned_email_test' }));
});

it('rejects missing isolated database configuration before connecting', async () => {
  vi.stubEnv('E2E_DATABASE_ISOLATED', 'true');
  vi.stubEnv('TEST_DB_NAME', undefined);
  await expect(new E2ETestContext().initialize()).rejects.toThrow('explicit TEST_DB_NAME');
  expect(captured).not.toHaveBeenCalled();
});
