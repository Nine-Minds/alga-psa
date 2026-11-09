import { beforeEach, describe, expect, it, vi } from 'vitest';

const finalize = vi.fn();
const scheduleJob = vi.fn();
const submit = vi.fn();

vi.mock('@alga-psa/billing/services', () => ({
  finalizeLinkAcceptedQuote: (...a: unknown[]) => finalize(...a),
  submitQuoteLinkDecision: (...a: unknown[]) => submit(...a),
}));
vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../../lib/jobs/JobRunnerFactory', () => ({
  getJobRunner: async () => ({ scheduleJob: (...a: unknown[]) => scheduleJob(...a) }),
}));
vi.mock('@/lib/jobs/JobRunnerFactory', () => ({
  getJobRunner: async () => ({ scheduleJob: (...a: unknown[]) => scheduleJob(...a) }),
}));

import {
  FINALIZE_LINK_ACCEPTED_QUOTE_JOB,
  enqueueLinkAcceptanceFinalization,
  finalizeLinkAcceptedQuoteHandler,
} from '../../../lib/jobs/handlers/finalizeLinkAcceptedQuoteHandler';
import { POST } from '../../../app/api/quote/[token]/decision/route';

const committed = { tenant: 't-1', quoteId: 'q-1', decisionId: 'd-1', decision: 'accepted' as const };

describe('link acceptance finalization job', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queues one job per committed acceptance, keyed by the decision', async () => {
    await enqueueLinkAcceptanceFinalization(committed);
    expect(scheduleJob).toHaveBeenCalledWith(
      FINALIZE_LINK_ACCEPTED_QUOTE_JOB,
      { tenantId: 't-1', quoteId: 'q-1', decisionId: 'd-1' },
      { singletonKey: `${FINALIZE_LINK_ACCEPTED_QUOTE_JOB}:t-1:d-1` },
    );
  });

  it('queues nothing for a rejection', async () => {
    await enqueueLinkAcceptanceFinalization({ ...committed, decision: 'rejected' });
    expect(scheduleJob).not.toHaveBeenCalled();
  });

  it('runs the finalizer for the named decision', async () => {
    finalize.mockResolvedValue({ documentId: 'doc-1', emailSent: true, errors: [] });
    await finalizeLinkAcceptedQuoteHandler({ tenantId: 't-1', quoteId: 'q-1', decisionId: 'd-1' });
    expect(finalize).toHaveBeenCalledWith('t-1', 'q-1', 'd-1');
  });

  it('throws when the finalizer reports problems so the runner retries', async () => {
    finalize.mockResolvedValue({ documentId: 'doc-1', emailSent: false, errors: ['Signer confirmation email failed: smtp down'] });
    await expect(
      finalizeLinkAcceptedQuoteHandler({ tenantId: 't-1', quoteId: 'q-1', decisionId: 'd-1' }),
    ).rejects.toThrow(/smtp down/);
  });
});

describe('POST /api/quote/[token]/decision', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hands the decision service the finalization hook, and the hook queues the job', async () => {
    submit.mockImplementation(async (_token, _input, _ctx, hooks) => {
      await hooks.afterCommit(committed);
      return { status: 'decided', decision: 'accepted', decidedAt: '2026-11-01T00:00:00.000Z', committed: {} };
    });
    const request = new Request('http://localhost/api/quote/tok/decision', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
      body: JSON.stringify({ action: 'accept', signerName: 'Casey' }),
    });

    const response = await POST(request as any, { params: Promise.resolve({ token: 'tok' }) });

    expect(response.status).toBe(200);
    const body = await response.json();
    // Internal ids never reach the browser.
    expect(JSON.stringify(body)).not.toContain('d-1');
    expect(submit.mock.calls[0][2]).toMatchObject({ ip: '203.0.113.9' });
    expect(scheduleJob).toHaveBeenCalledWith(
      FINALIZE_LINK_ACCEPTED_QUOTE_JOB,
      { tenantId: 't-1', quoteId: 'q-1', decisionId: 'd-1' },
      expect.anything(),
    );
  });
});
