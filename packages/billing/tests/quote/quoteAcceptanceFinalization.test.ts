import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = 'tenant-1';
const QUOTE_ID = 'quote-1';

const generateAndStore = vi.fn();
const sendEmail = vi.fn();
const downloadMock = vi.fn();
const quoteGetById = vi.fn();
const listActivities = vi.fn();
const createActivity = vi.fn();
const renderQuoteEmail = vi.fn();
const lockRaw = vi.fn();
const loadAcceptance = vi.fn();
const DECISION_ID = 'decision-1';

// A trx stand-in whose lock is a real mutex, so concurrent finalizations queue
// the way pg_advisory_xact_lock makes them queue.
let lockTail: Promise<void> = Promise.resolve();
// True while any transaction (so any pooled connection) is open.
let openTransactions = 0;
const fakeTrx = () => ({
  raw: (...a: unknown[]) => lockRaw(...a),
  transaction: async (fn: (t: unknown) => Promise<unknown>) => fn({ scope: 'savepoint' }),
});

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: { scope: 'knex' }, tenant: TENANT }),
  runWithTenant: async (_t: string, fn: () => Promise<unknown>) => fn(),
  resolveEffectiveTimeZone: async () => 'America/Chicago',
  withTransaction: async (_knex: unknown, fn: (trx: unknown) => Promise<unknown>) => {
    const previous = lockTail;
    let release!: () => void;
    lockTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    openTransactions += 1;
    try {
      return await fn(fakeTrx());
    } finally {
      openTransactions -= 1;
      release();
    }
  },
}));
vi.mock('@alga-psa/email', () => ({
  TenantEmailService: { getInstance: () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }) },
}));
vi.mock('@alga-psa/notifications/notifications/emailLocaleResolver', () => ({
  resolveEmailLocale: async () => 'en',
}));
vi.mock('@alga-psa/storage', () => ({
  StorageProviderFactory: { createProvider: async () => ({ download: (...a: unknown[]) => downloadMock(...a) }) },
}));
vi.mock('../../src/lib/adapters/tenantPartyAdapter', () => ({
  fetchTenantParty: async () => ({ name: 'Northwind MSP' }),
}));
vi.mock('../../src/lib/quoteEmailRendering', () => ({
  renderQuoteEmail: (...a: unknown[]) => renderQuoteEmail(...a),
}));
vi.mock('../../src/lib/quoteAcceptance', () => ({
  loadQuoteAcceptance: (...a: unknown[]) => loadAcceptance(...a),
}));
vi.mock('../../src/models/quote', () => ({ default: { getById: (...a: unknown[]) => quoteGetById(...a) } }));
vi.mock('../../src/models/quoteActivity', () => ({
  default: {
    listByQuoteId: (...a: unknown[]) => listActivities(...a),
    create: (...a: unknown[]) => createActivity(...a),
  },
}));
vi.mock('../../src/services/pdfGenerationService', () => ({
  SIGNED_QUOTE_FILE_SUFFIX: '-signed',
  createPDFGenerationService: () => ({ generateAndStore: (...a: unknown[]) => generateAndStore(...a) }),
}));

import { finalizeLinkAcceptedQuote } from '../../src/services/quoteAcceptanceFinalizationService';

const acceptance = {
  signerName: 'Casey Signer',
  signerEmail: 'casey@example.com',
  signerContactId: 'contact-1',
  acceptedAt: '2026-07-18T23:30:00.000Z',
  method: 'email_link',
  ipAddress: '203.0.113.9',
};

const activityTypes = () => createActivity.mock.calls.map((call) => call[2].activity_type);

describe('finalizeLinkAcceptedQuote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openTransactions = 0;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    quoteGetById.mockResolvedValue({
      quote_id: QUOTE_ID,
      quote_number: 'Q-1',
      title: 'Proposal',
      status: 'accepted',
      client_id: 'client-1',
      contact_id: 'contact-1',
      created_by: 'creator',
    });
    generateAndStore.mockResolvedValue({
      file_id: 'file-1',
      document_id: 'doc-signed',
      storage_path: 'stored/Proposal-signed.pdf',
      original_name: 'Proposal-signed.pdf',
    });
    downloadMock.mockResolvedValue(Buffer.from('%PDF-signed'));
    loadAcceptance.mockResolvedValue(acceptance);
    listActivities.mockResolvedValue([]);
    createActivity.mockResolvedValue({});
    renderQuoteEmail.mockResolvedValue({ subject: 'Quote Q-1 was accepted', html: '<p>ok</p>', text: 'ok' });
    sendEmail.mockResolvedValue({ success: true, messageId: 'm-1' });
  });

  it('files the signed copy in the tenant zone and mails it, attached, to the signer only', async () => {
    const result = await finalizeLinkAcceptedQuote(TENANT, QUOTE_ID, DECISION_ID);

    expect(result).toEqual({ documentId: 'doc-signed', emailSent: true, errors: [] });
    expect(generateAndStore).toHaveBeenCalledWith(
      expect.objectContaining({
        quoteId: QUOTE_ID,
        quoteVariant: 'signed',
        acceptance: expect.objectContaining({ signerName: 'Casey Signer', timeZone: 'America/Chicago' }),
      })
    );
    expect(renderQuoteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ templateName: 'quote-accepted-confirmation-email' })
    );
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const sent = sendEmail.mock.calls[0][0];
    expect(sent.to).toEqual(['casey@example.com']);
    expect(sent.entityType).toBe('quote');
    expect(sent.attachments).toEqual([
      { filename: 'Proposal-signed.pdf', content: Buffer.from('%PDF-signed'), contentType: 'application/pdf' },
    ]);
    expect(downloadMock).toHaveBeenCalledWith('stored/Proposal-signed.pdf');
  });

  it('sends no email and does not throw when the PDF cannot be produced', async () => {
    generateAndStore.mockRejectedValue(new Error('chromium crashed'));
    const result = await finalizeLinkAcceptedQuote(TENANT, QUOTE_ID, DECISION_ID);

    expect(result.emailSent).toBe(false);
    expect(result.documentId).toBeUndefined();
    expect(result.errors.join(' ')).toMatch(/chromium crashed/);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('sends no email when the PDF was produced but not filed as a document', async () => {
    generateAndStore.mockResolvedValue({ file_id: 'file-1', storage_path: 'x.pdf' });
    const result = await finalizeLinkAcceptedQuote(TENANT, QUOTE_ID, DECISION_ID);

    expect(result.emailSent).toBe(false);
    expect(result.documentId).toBeUndefined();
    expect(result.errors).toHaveLength(1);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('reports an email failure without throwing, keeping the filed document', async () => {
    sendEmail.mockResolvedValue({ success: false, error: 'smtp down' });
    const result = await finalizeLinkAcceptedQuote(TENANT, QUOTE_ID, DECISION_ID);

    expect(result.documentId).toBe('doc-signed');
    expect(result.emailSent).toBe(false);
    expect(result.errors.join(' ')).toMatch(/smtp down/);
    expect(activityTypes()).toEqual(['signer_confirmation_claimed', 'signer_confirmation_failed']);
  });

  it('holds no transaction (no pooled connection) while the email is sent', async () => {
    let openDuringSend = -1;
    sendEmail.mockImplementation(async () => {
      openDuringSend = openTransactions;
      return { success: true, messageId: 'm-1' };
    });

    const result = await finalizeLinkAcceptedQuote(TENANT, QUOTE_ID, DECISION_ID);

    expect(result.emailSent).toBe(true);
    expect(openDuringSend).toBe(0);
  });

  it('releases the claim when the send fails, so a later run sends', async () => {
    const recorded: Array<{ activity_type: string }> = [];
    listActivities.mockImplementation(async () => [...recorded]);
    createActivity.mockImplementation(async (_k: unknown, _t: unknown, activity: { activity_type: string }) => {
      recorded.push({ ...activity, created_at: new Date().toISOString() } as { activity_type: string });
      return {};
    });
    sendEmail.mockResolvedValueOnce({ success: false, error: 'smtp down' });

    const first = await finalizeLinkAcceptedQuote(TENANT, QUOTE_ID, DECISION_ID);
    expect(first.emailSent).toBe(false);

    const second = await finalizeLinkAcceptedQuote(TENANT, QUOTE_ID, DECISION_ID);
    expect(second.emailSent).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(activityTypes()).toEqual([
      'signer_confirmation_claimed',
      'signer_confirmation_failed',
      'signer_confirmation_claimed',
      'signer_confirmation_sent',
    ]);
  });

  it('stands down while another run holds a live claim, and retakes a stale one', async () => {
    const claimedAt = (msAgo: number) => ({
      activity_type: 'signer_confirmation_claimed',
      created_at: new Date(Date.now() - msAgo).toISOString(),
    });

    listActivities.mockResolvedValue([claimedAt(60 * 1000)]);
    const live = await finalizeLinkAcceptedQuote(TENANT, QUOTE_ID, DECISION_ID);
    expect(live).toEqual({ documentId: 'doc-signed', emailSent: false, errors: [] });
    expect(sendEmail).not.toHaveBeenCalled();

    listActivities.mockResolvedValue([claimedAt(60 * 60 * 1000)]);
    const stale = await finalizeLinkAcceptedQuote(TENANT, QUOTE_ID, DECISION_ID);
    expect(stale.emailSent).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('matches failed records to claims by claim_id: a late failure of an old claim does not release a newer live claim', async () => {
    const at = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
    listActivities.mockResolvedValue([
      { activity_type: 'signer_confirmation_claimed', created_at: at(60 * 60 * 1000), metadata: { claim_id: 'old' } },
      { activity_type: 'signer_confirmation_claimed', created_at: at(60 * 1000), metadata: { claim_id: 'new' } },
      { activity_type: 'signer_confirmation_failed', created_at: at(1000), metadata: { claim_id: 'old' } },
    ]);
    const blocked = await finalizeLinkAcceptedQuote(TENANT, QUOTE_ID, DECISION_ID);
    expect(blocked.emailSent).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();

    // The newer claim's own failure releases it.
    listActivities.mockResolvedValue([
      { activity_type: 'signer_confirmation_claimed', created_at: at(60 * 1000), metadata: { claim_id: 'new' } },
      { activity_type: 'signer_confirmation_failed', created_at: at(1000), metadata: { claim_id: 'new' } },
    ]);
    const released = await finalizeLinkAcceptedQuote(TENANT, QUOTE_ID, DECISION_ID);
    expect(released.emailSent).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('reports a thrown email error without throwing, and releases the claim', async () => {
    sendEmail.mockRejectedValue(new Error('boom'));
    const result = await finalizeLinkAcceptedQuote(TENANT, QUOTE_ID, DECISION_ID);

    expect(result.emailSent).toBe(false);
    expect(result.errors.join(' ')).toMatch(/boom/);
    expect(activityTypes()).toEqual(['signer_confirmation_claimed', 'signer_confirmation_failed']);
  });

  it('does not email twice: a second run reuses the signed document and skips the send', async () => {
    const first = await finalizeLinkAcceptedQuote(TENANT, QUOTE_ID, DECISION_ID);
    expect(first.emailSent).toBe(true);
    expect(activityTypes()).toEqual(['signer_confirmation_claimed', 'signer_confirmation_sent']);

    listActivities.mockResolvedValue([{ activity_type: 'signer_confirmation_sent' }]);
    const second = await finalizeLinkAcceptedQuote(TENANT, QUOTE_ID, DECISION_ID);
    expect(second).toEqual({ documentId: 'doc-signed', emailSent: false, errors: [] });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('sends once when two finalizations race: the second sees the recorded confirmation', async () => {
    const recorded: Array<{ activity_type: string }> = [];
    listActivities.mockImplementation(async () => [...recorded]);
    createActivity.mockImplementation(async (_k: unknown, _t: unknown, activity: { activity_type: string }) => {
      recorded.push({ ...activity, created_at: new Date().toISOString() } as { activity_type: string });
      return {};
    });
    // Slow send, so the second run is in flight while the first is mid-send.
    sendEmail.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { success: true, messageId: 'm-1' };
    });

    const [a, b] = await Promise.all([
      finalizeLinkAcceptedQuote(TENANT, QUOTE_ID, DECISION_ID),
      finalizeLinkAcceptedQuote(TENANT, QUOTE_ID, DECISION_ID),
    ]);

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(activityTypes()).toEqual(['signer_confirmation_claimed', 'signer_confirmation_sent']);
    expect([a.emailSent, b.emailSent].sort()).toEqual([false, true]);
    expect(a.documentId).toBe('doc-signed');
    expect(b.documentId).toBe('doc-signed');
    expect(lockRaw).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'), [
      'alga:quote-signer-confirmation',
      `${TENANT}:${QUOTE_ID}`,
    ]);
  });

  it('still reports success for the email when logging it fails', async () => {
    createActivity.mockImplementation(async (_k: unknown, _t: unknown, activity: { activity_type: string }) => {
      if (activity.activity_type === 'signer_confirmation_sent') throw new Error('activity insert failed');
      return {};
    });
    const result = await finalizeLinkAcceptedQuote(TENANT, QUOTE_ID, DECISION_ID);

    expect(result).toEqual({ documentId: 'doc-signed', emailSent: true, errors: [] });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('does not produce a signed PDF when the quote has no user to attribute it to', async () => {
    quoteGetById.mockResolvedValue({ quote_id: QUOTE_ID, status: 'accepted', contact_id: 'contact-1' });
    const result = await finalizeLinkAcceptedQuote(TENANT, QUOTE_ID, DECISION_ID);

    expect(result.errors[0]).toMatch(/no user to attribute/);
    expect(generateAndStore).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('refuses to run before the decision is committed', async () => {
    quoteGetById.mockResolvedValue({ quote_id: QUOTE_ID, status: 'sent' });
    const result = await finalizeLinkAcceptedQuote(TENANT, QUOTE_ID, DECISION_ID);

    expect(result.errors[0]).toMatch(/not accepted/);
    expect(generateAndStore).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('does not email when the acceptance carries no signer email', async () => {
    const result = await (loadAcceptance.mockResolvedValue({ ...acceptance, signerEmail: null }), finalizeLinkAcceptedQuote(TENANT, QUOTE_ID, DECISION_ID));

    expect(result.documentId).toBe('doc-signed');
    expect(result.emailSent).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('never throws even when loading the quote fails', async () => {
    quoteGetById.mockRejectedValue(new Error('db gone'));
    await expect(finalizeLinkAcceptedQuote(TENANT, QUOTE_ID, DECISION_ID)).resolves.toMatchObject({
      emailSent: false,
      errors: [expect.stringMatching(/db gone/)],
    });
  });

  it('stamps the recorded decision it is named for, not caller-supplied details', async () => {
    await finalizeLinkAcceptedQuote(TENANT, QUOTE_ID, DECISION_ID);

    expect(loadAcceptance).toHaveBeenCalledWith({ scope: 'knex' }, TENANT, QUOTE_ID, { decisionId: DECISION_ID });
    expect(generateAndStore.mock.calls[0][0].acceptance).toMatchObject({
      signerName: 'Casey Signer',
      signerEmail: 'casey@example.com',
      method: 'email_link',
      ipAddress: '203.0.113.9',
    });
  });

  it('does nothing when the decision is not a recorded acceptance of this quote', async () => {
    loadAcceptance.mockResolvedValue(null);
    const result = await finalizeLinkAcceptedQuote(TENANT, QUOTE_ID, DECISION_ID);

    expect(result.emailSent).toBe(false);
    expect(result.errors[0]).toMatch(/No accepted decision/);
    expect(generateAndStore).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('leaves portal and MSP acceptances alone', async () => {
    loadAcceptance.mockResolvedValue({ ...acceptance, method: 'portal' });
    const result = await finalizeLinkAcceptedQuote(TENANT, QUOTE_ID, DECISION_ID);

    expect(result.errors[0]).toMatch(/not made through an emailed link/);
    expect(generateAndStore).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
