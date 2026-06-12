import { afterEach, describe, expect, it, vi } from 'vitest';

describe('inbound webhook edition gate', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('@alga-psa/core/features');
  });

  it('should allow workflow handlers on Enterprise edition', async () => {
    vi.resetModules();
    vi.doMock('@alga-psa/core/features', () => ({ isEnterprise: true }));

    const gate = await import('@/lib/inboundWebhooks/editionGate');

    expect(gate.canUseInboundWebhookWorkflowHandlers()).toBe(true);
    expect(() => gate.assertInboundWebhookWorkflowHandlersAvailable()).not.toThrow();
  });

  it('should block workflow handlers on Community edition', async () => {
    vi.resetModules();
    vi.doMock('@alga-psa/core/features', () => ({ isEnterprise: false }));

    const gate = await import('@/lib/inboundWebhooks/editionGate');

    expect(gate.canUseInboundWebhookWorkflowHandlers()).toBe(false);
    expect(() => gate.assertInboundWebhookWorkflowHandlersAvailable()).toThrow(
      'Inbound webhook workflow handlers require Enterprise edition',
    );
  });
});
