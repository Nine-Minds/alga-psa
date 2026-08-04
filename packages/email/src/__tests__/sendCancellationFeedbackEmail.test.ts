import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendEmail: vi.fn(),
}));

vi.mock('../system/SystemEmailService', () => ({
  getSystemEmailService: async () => ({ sendEmail: mocks.sendEmail }),
}));

import { sendCancellationFeedbackEmail } from '../sendCancellationFeedbackEmail';

describe('sendCancellationFeedbackEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendEmail.mockResolvedValue(undefined);
  });

  it('escapes dynamic values in the HTML email', async () => {
    await sendCancellationFeedbackEmail({
      tenantName: 'A&B <script>alert(1)</script>',
      tenantEmail: 'owner+<tag>@example.test',
      reasonText: '<img src=x onerror=alert(1)>\nSecond & final line',
      reasonCategory: 'Other <unsafe>',
      licenseCount: 3,
      monthlyCost: 75,
      cancelAt: '<tomorrow>',
    });

    expect(mocks.sendEmail).toHaveBeenCalledOnce();
    const message = mocks.sendEmail.mock.calls[0][0];

    expect(message.html).toContain('A&amp;B &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(message.html).toContain('owner+&lt;tag&gt;@example.test');
    expect(message.html).toContain('&lt;img src=x onerror=alert(1)&gt;<br>Second &amp; final line');
    expect(message.html).toContain('Other &lt;unsafe&gt;');
    expect(message.html).toContain('&lt;tomorrow&gt;');
    expect(message.html).not.toContain('<script>');
    expect(message.html).not.toContain('<img');
    expect(message.text).toContain('<img src=x onerror=alert(1)>');
  });
});
