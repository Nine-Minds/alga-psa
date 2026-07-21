import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const openAiConfigs = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const getSecretMock = vi.hoisted(() => vi.fn());
const rolloutEnabledMock = vi.hoisted(() => vi.fn());
const licensingMocks = vi.hoisted(() => ({
  getLicenseStateRow: vi.fn(),
  isSelfHostLicensing: vi.fn(),
}));

vi.mock('openai', () => ({
  default: class OpenAI {
    constructor(config: Record<string, unknown>) {
      openAiConfigs.push(config);
    }
  },
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecret: getSecretMock,
}));

vi.mock('@alga-psa/licensing', () => licensingMocks);

vi.mock('../aiGatewayRollout', () => ({
  isAiUsageBillingEnabled: rolloutEnabledMock,
}));

describe('package chatProviderResolver appliance path', () => {
  beforeEach(() => {
    vi.resetModules();
    openAiConfigs.splice(0, openAiConfigs.length);
    getSecretMock.mockReset();
    rolloutEnabledMock.mockReset();
    licensingMocks.getLicenseStateRow.mockReset();
    licensingMocks.isSelfHostLicensing.mockReset();

    process.env.AI_GATEWAY_URL = 'https://gateway.example.test/';
    delete process.env.AI_GATEWAY_BYPASS;
    delete process.env.AI_GATEWAY_ROLLOUT_ALL;
    getSecretMock.mockImplementation(async (key: string) => (
      key === 'AI_GATEWAY_MODEL' ? 'gateway/appliance-model' : ''
    ));
    rolloutEnabledMock.mockResolvedValue(false);
    licensingMocks.isSelfHostLicensing.mockResolvedValue(true);
    licensingMocks.getLicenseStateRow.mockResolvedValue({
      appliance_credential: 'c'.repeat(64),
    });
  });

  afterEach(() => {
    delete process.env.AI_GATEWAY_URL;
    delete process.env.AI_GATEWAY_BYPASS;
    delete process.env.AI_GATEWAY_ROLLOUT_ALL;
  });

  it('uses appliance auth and skips the hosted rollout check', async () => {
    const { resolveChatProvider } = await import('../chatProviderResolver');

    const provider = await resolveChatProvider('tenant-appliance', 'workflow-inference');

    expect(provider.providerId).toBe('gateway');
    expect(rolloutEnabledMock).not.toHaveBeenCalled();
    expect(openAiConfigs.at(-1)).toMatchObject({
      apiKey: 'c'.repeat(64),
      baseURL: 'https://gateway.example.test/v1',
      defaultHeaders: {
        'X-Alga-AI-Feature': 'workflow-inference',
      },
    });
  });
});
