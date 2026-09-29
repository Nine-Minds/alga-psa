import { afterEach, expect, it, vi } from 'vitest';
const { first } = vi.hoisted(() => ({ first: vi.fn() }));
vi.mock('../../../../test-utils/testContext', () => ({ TestContext: class {} }));
vi.mock('@alga-psa/db', () => ({ tenantDb: () => ({ table: () => ({ where: () => ({ count: () => ({ first }) }) }) }) }));
vi.mock('../../e2e/utils/docker-service-manager', () => ({ DockerServiceManager: class {} }));
vi.mock('../../e2e/utils/mailhog-client', () => ({ MailHogClient: class {} }));
vi.mock('../../e2e/utils/email-test-factory', () => ({ EmailTestFactory: class {} }));
vi.mock('../../../services/email/MailHogPollingService', () => ({ MailHogPollingService: class {} }));
import { E2ETestContext } from '../../e2e/utils/e2e-test-context';
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

it('rejects an email-to-ticket wait when no ticket is observed', async () => {
  vi.useFakeTimers();
  first.mockResolvedValue({ count: '0' });
  const result = expect(new E2ETestContext().waitForWorkflowProcessing(2000)).rejects.toThrow('Email-to-ticket processing was not observed');
  await vi.advanceTimersByTimeAsync(2000);
  await result;
});

it('completes when polling observes a ticket', async () => {
  vi.useFakeTimers();
  first.mockResolvedValueOnce({ count: '0' }).mockResolvedValueOnce({ count: '1' });
  const result = new E2ETestContext().waitForWorkflowProcessing(5000);
  await vi.advanceTimersByTimeAsync(3000);
  await expect(result).resolves.toBeUndefined();
  expect(first).toHaveBeenCalledTimes(2);
});
