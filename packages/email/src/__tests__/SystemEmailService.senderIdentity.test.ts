import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  sends: [] as Array<{ message: Record<string, any>; password?: string }>,
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
    getConfigFingerprint: vi.fn(() => JSON.stringify({
      password: process.env.EMAIL_PASSWORD,
      from: process.env.EMAIL_FROM,
    })),
    createProvider: vi.fn(async () => {
      runtime.providerCreations += 1;
      const password = process.env.EMAIL_PASSWORD;
      return {
        providerId: 'system-email-provider',
        providerType: 'smtp',
        sendEmail: vi.fn(async (message: Record<string, any>) => {
          runtime.sends.push({ message, password });
          return {
            success: true,
            messageId: `system-${runtime.sends.length}`,
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
  const originalEmailPassword = process.env.EMAIL_PASSWORD;
  let configVersion = 0;

  beforeEach(() => {
    runtime.sends.length = 0;
    runtime.providerCreations = 0;
    configVersion += 1;
    process.env.EMAIL_FROM = 'Platform Mail <platform@example.test>';
    process.env.EMAIL_PASSWORD = `password-${configVersion}`;
  });

  afterAll(() => {
    if (originalEmailFrom === undefined) {
      delete process.env.EMAIL_FROM;
    } else {
      process.env.EMAIL_FROM = originalEmailFrom;
    }
    if (originalEmailPassword === undefined) {
      delete process.env.EMAIL_PASSWORD;
    } else {
      process.env.EMAIL_PASSWORD = originalEmailPassword;
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
    expect(runtime.sends.map(send => send.message.from)).toEqual([
      { email: 'platform@example.test', name: 'First MSP Portal' },
      { email: 'platform@example.test', name: 'Second MSP Portal' },
    ]);
  });

  it('refreshes environment-backed credentials and From address between sends', async () => {
    const service = await getSystemEmailService();

    await service.sendEmail({
      to: 'first@example.test',
      subject: 'First',
      html: '<p>First</p>',
    });
    process.env.EMAIL_PASSWORD = 'rotated-password';
    process.env.EMAIL_FROM = 'Rotated Platform <rotated@example.test>';
    await service.sendEmail({
      to: 'second@example.test',
      subject: 'Second',
      html: '<p>Second</p>',
    });

    expect(runtime.providerCreations).toBe(2);
    expect(runtime.sends.map(send => ({
      password: send.password,
      from: send.message.from,
    }))).toEqual([
      {
        password: `password-${configVersion}`,
        from: { email: 'platform@example.test', name: 'Platform Mail' },
      },
      {
        password: 'rotated-password',
        from: { email: 'rotated@example.test', name: 'Rotated Platform' },
      },
    ]);
  });

  it('keeps an in-flight message paired with its provider and From snapshot', async () => {
    const service = await getSystemEmailService();
    let releaseTemplate!: () => void;
    let markTemplateStarted!: () => void;
    const templateStarted = new Promise<void>((resolve) => {
      markTemplateStarted = resolve;
    });
    const templateRelease = new Promise<void>((resolve) => {
      releaseTemplate = resolve;
    });

    const firstSend = service.sendEmail({
      to: 'first@example.test',
      templateProcessor: {
        process: async () => {
          markTemplateStarted();
          await templateRelease;
          return { subject: 'First', html: '<p>First</p>', text: 'First' };
        },
      },
    });
    await templateStarted;

    process.env.EMAIL_PASSWORD = 'concurrent-password';
    process.env.EMAIL_FROM = 'Concurrent Platform <concurrent@example.test>';
    await service.sendEmail({
      to: 'second@example.test',
      subject: 'Second',
      html: '<p>Second</p>',
    });
    releaseTemplate();
    await firstSend;

    expect(runtime.sends.map(send => ({
      password: send.password,
      from: send.message.from,
    }))).toEqual([
      {
        password: 'concurrent-password',
        from: { email: 'concurrent@example.test', name: 'Concurrent Platform' },
      },
      {
        password: `password-${configVersion}`,
        from: { email: 'platform@example.test', name: 'Platform Mail' },
      },
    ]);
  });
});
