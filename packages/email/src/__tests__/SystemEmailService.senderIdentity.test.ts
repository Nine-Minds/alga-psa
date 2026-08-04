import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  messages: [] as Array<Record<string, any>>,
  providerCreations: 0,
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async () => undefined),
}));

vi.mock('../system/SystemEmailProviderFactory', () => ({
  SystemEmailProviderFactory: {
    createProvider: vi.fn(async () => {
      runtime.providerCreations += 1;
      return {
        providerId: 'system-email-provider',
        providerType: 'smtp',
        sendEmail: vi.fn(async (message: Record<string, any>) => {
          runtime.messages.push(message);
          return {
            success: true,
            messageId: `system-${runtime.messages.length}`,
            providerId: 'system-email-provider',
            providerType: 'smtp',
            sentAt: new Date(),
          };
        }),
      };
    }),
  },
}));

import { getSystemEmailService } from '../system/SystemEmailService';

describe('SystemEmailService sender identity', () => {
  const originalEmailFrom = process.env.EMAIL_FROM;

  beforeEach(() => {
    runtime.messages.length = 0;
    runtime.providerCreations = 0;
    process.env.EMAIL_FROM = 'Platform Mail <platform@example.test>';
  });

  afterAll(() => {
    if (originalEmailFrom === undefined) {
      delete process.env.EMAIL_FROM;
    } else {
      process.env.EMAIL_FROM = originalEmailFrom;
    }
  });

  it('keeps fallback names call-scoped on a long-lived system service', async () => {
    const service = await getSystemEmailService();

    await service.sendEmail({
      to: 'first@example.test',
      fromName: 'First MSP Portal',
      subject: 'First invite',
      html: '<p>First invite</p>',
    });
    await service.sendEmail({
      to: 'second@example.test',
      fromName: 'Second MSP Portal',
      subject: 'Second invite',
      html: '<p>Second invite</p>',
    });

    expect(await getSystemEmailService()).toBe(service);
    expect(runtime.providerCreations).toBe(1);
    expect(runtime.messages.map(message => message.from)).toEqual([
      { email: 'platform@example.test', name: 'First MSP Portal' },
      { email: 'platform@example.test', name: 'Second MSP Portal' },
    ]);
  });
});
