import { describe, expect, it, vi } from 'vitest';

import {
  buildLoginWinbackEmail,
  buildReactivationInviteEmail,
  sendLoginWinbackEmail,
  sendReactivationInviteEmail,
} from '../../../../../ee/server/src/lib/billing/reactivationInviteEmail';

describe('reactivation emails', () => {
  const baseInput = {
    to: 'admin@example.com',
    tenantId: 'tenant-1',
    tenantName: 'Acme MSP',
    reactivationUrl: 'https://store.example.test/reactivate?token=signed',
    effectiveDeletionDate: '2026-07-01T12:00:00.000Z',
  };

  it('T044: reactivation invite includes deletion date, standard-price note, and one CTA', () => {
    const email = buildReactivationInviteEmail(baseInput);

    expect(email.subject).toContain('Welcome back');
    expect(email.html).toContain('July 1, 2026');
    expect(email.html).toContain('standard price');
    expect(email.html).toContain('no intro discount or trial');
    expect((email.html.match(/Reactivate your account/g) || [])).toHaveLength(1);
    expect(email.text).toContain(baseInput.reactivationUrl);
  });

  it('T045: login win-back email contains sign-in attempt copy, deletion date, and CTA', () => {
    const email = buildLoginWinbackEmail(baseInput);

    expect(email.html).toContain('We noticed a sign-in attempt');
    expect(email.html).toContain('July 1, 2026');
    expect(email.html).toContain(baseInput.reactivationUrl);
    expect(email.text).toContain('Reactivate your account');
  });

  it('T046: both emails dispatch through the configured sender from info@nineminds.com', async () => {
    const sender = {
      sendEmail: vi.fn(async () => ({ success: true })),
    };

    await expect(sendReactivationInviteEmail(baseInput, sender)).resolves.toBe(true);
    await expect(sendLoginWinbackEmail(baseInput, sender)).resolves.toBe(true);

    expect(sender.sendEmail).toHaveBeenCalledTimes(2);
    expect(sender.sendEmail.mock.calls[0][0]).toMatchObject({
      to: 'admin@example.com',
      from: 'info@nineminds.com',
      tenantId: 'tenant-1',
      entityType: 'tenant_reactivation',
    });
    expect(sender.sendEmail.mock.calls[1][0]).toMatchObject({
      to: 'admin@example.com',
      from: 'info@nineminds.com',
      tenantId: 'tenant-1',
      entityType: 'tenant_reactivation',
      metadata: {
        emailType: 'login_winback',
      },
    });
  });
});
