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

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: { scope: 'knex' }, tenant: TENANT }),
  runWithTenant: async (_t: string, fn: () => Promise<unknown>) => fn(),
  resolveEffectiveTimeZone: async () => 'America/Chicago',
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

describe('finalizeLinkAcceptedQuote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    listActivities.mockResolvedValue([]);
    createActivity.mockResolvedValue({});
    renderQuoteEmail.mockResolvedValue({ subject: 'Quote Q-1 was accepted', html: '<p>ok</p>', text: 'ok' });
    sendEmail.mockResolvedValue({ success: true, messageId: 'm-1' });
  });

  it('files the signed copy in the tenant zone and mails it, attached, to the signer only', async () => {
    const result = await finalizeLinkAcceptedQuote(TENANT, QUOTE_ID, acceptance);

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
    const result = await finalizeLinkAcceptedQuote(TENANT, QUOTE_ID, acceptance);

    expect(result.emailSent).toBe(false);
    expect(result.documentId).toBeUndefined();
    expect(result.errors.join(' ')).toMatch(/chromium crashed/);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('sends no email when the PDF was produced but not filed as a document', async () => {
    generateAndStore.mockResolvedValue({ file_id: 'file-1', storage_path: 'x.pdf' });
    const result = await finalizeLinkAcceptedQuote(TENANT, QUOTE_ID, acceptance);

    expect(result.emailSent).toBe(false);
    expect(result.documentId).toBeUndefined();
    expect(result.errors).toHaveLength(1);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('reports an email failure without throwing, keeping the filed document', async () => {
    sendEmail.mockResolvedValue({ success: false, error: 'smtp down' });
    const result = await finalizeLinkAcceptedQuote(TENANT, QUOTE_ID, acceptance);

    expect(result.documentId).toBe('doc-signed');
    expect(result.emailSent).toBe(false);
    expect(result.errors.join(' ')).toMatch(/smtp down/);
    expect(createActivity).not.toHaveBeenCalled();
  });

  it('reports a thrown email error without throwing', async () => {
    sendEmail.mockRejectedValue(new Error('boom'));
    const result = await finalizeLinkAcceptedQuote(TENANT, QUOTE_ID, acceptance);

    expect(result.emailSent).toBe(false);
    expect(result.errors.join(' ')).toMatch(/boom/);
  });

  it('does not email twice: a second run reuses the signed document and skips the send', async () => {
    const first = await finalizeLinkAcceptedQuote(TENANT, QUOTE_ID, acceptance);
    expect(first.emailSent).toBe(true);
    expect(createActivity).toHaveBeenCalledWith(
      expect.anything(),
      TENANT,
      expect.objectContaining({ activity_type: 'signer_confirmation_sent' })
    );

    listActivities.mockResolvedValue([{ activity_type: 'signer_confirmation_sent' }]);
    const second = await finalizeLinkAcceptedQuote(TENANT, QUOTE_ID, acceptance);
    expect(second).toEqual({ documentId: 'doc-signed', emailSent: false, errors: [] });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('refuses to run before the decision is committed', async () => {
    quoteGetById.mockResolvedValue({ quote_id: QUOTE_ID, status: 'sent' });
    const result = await finalizeLinkAcceptedQuote(TENANT, QUOTE_ID, acceptance);

    expect(result.errors[0]).toMatch(/not accepted/);
    expect(generateAndStore).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('does not email when the acceptance carries no signer email', async () => {
    const result = await finalizeLinkAcceptedQuote(TENANT, QUOTE_ID, { ...acceptance, signerEmail: null });

    expect(result.documentId).toBe('doc-signed');
    expect(result.emailSent).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('never throws even when loading the quote fails', async () => {
    quoteGetById.mockRejectedValue(new Error('db gone'));
    await expect(finalizeLinkAcceptedQuote(TENANT, QUOTE_ID, acceptance)).resolves.toMatchObject({
      emailSent: false,
      errors: [expect.stringMatching(/db gone/)],
    });
  });
});
