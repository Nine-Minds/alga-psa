import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  // JobService instance collaborators
  createJobDetail: vi.fn(),
  updateJobDetailRecord: vi.fn(),
  updateJobStatus: vi.fn(),
  jobServiceCreate: vi.fn(),
  // Email
  sendInvoiceEmail: vi.fn(),
  getEmailService: vi.fn(),
  // PDF generation
  generateAndStore: vi.fn(),
  createPDFGenerationService: vi.fn(),
  publishGeneratedDocumentsToClient: vi.fn(),
  // Storage
  downloadFile: vi.fn(),
  // Clients
  getClientById: vi.fn(),
  getContactByContactNameId: vi.fn(),
  // DB connection (knex passed through to fetchTenantParty)
  getConnection: vi.fn(),
  // Tenant party (sender company name lookup)
  fetchTenantParty: vi.fn(),
  // Billing actions
  getInvoiceForRendering: vi.fn(),
  // Shared billing-recipient resolver and invoice-email link context
  resolveInvoiceBillingRecipient: vi.fn(),
  getInvoiceEmailLinkContext: vi.fn(),
  // fs
  writeFile: vi.fn(),
  unlink: vi.fn(),
  // logger
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('server/src/services/job.service', () => ({
  JobService: { create: mocks.jobServiceCreate },
}));

vi.mock('@alga-psa/billing/services', () => ({
  createPDFGenerationService: mocks.createPDFGenerationService,
  publishGeneratedDocumentsToClient: mocks.publishGeneratedDocumentsToClient,
  PDFGenerationService: class {},
  resolveInvoiceBillingRecipient: mocks.resolveInvoiceBillingRecipient,
}));

vi.mock('server/src/services/emailService', () => ({
  getEmailService: mocks.getEmailService,
}));

vi.mock('@alga-psa/storage/StorageService', () => ({
  StorageService: { downloadFile: mocks.downloadFile },
}));

vi.mock('@alga-psa/clients/actions', () => ({
  getClientById: mocks.getClientById,
  getContactByContactNameId: mocks.getContactByContactNameId,
}));

vi.mock('fs/promises', () => {
  const api = { writeFile: mocks.writeFile, unlink: mocks.unlink };
  return { default: api, ...api };
});

vi.mock('server/src/lib/db/db', () => ({
  getConnection: mocks.getConnection,
}));

vi.mock('@alga-psa/billing/actions/invoiceQueries', () => ({
  getInvoiceForRendering: mocks.getInvoiceForRendering,
}));

vi.mock('@alga-psa/billing/actions/invoiceEmailLinkContext', () => ({
  getInvoiceEmailLinkContext: mocks.getInvoiceEmailLinkContext,
}));

vi.mock('@alga-psa/billing/lib/adapters/tenantPartyAdapter', () => ({
  fetchTenantParty: mocks.fetchTenantParty,
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}));

import { InvoiceEmailHandler, type InvoiceEmailJobData } from 'server/src/lib/jobs/handlers/invoiceEmailHandler';
import { JobStatus } from 'server/src/types/job';

const TENANT = 'tenant-1';

function buildJobData(overrides: Partial<InvoiceEmailJobData> = {}): InvoiceEmailJobData {
  return {
    jobServiceId: 'job-service-1',
    tenantId: TENANT,
    invoiceIds: ['invoice-1'],
    steps: [
      { stepName: 'PDF Generation 1', type: 'pdf_generation', metadata: { invoiceId: 'invoice-1', tenantId: TENANT } },
      { stepName: 'Email Sending 1', type: 'email_sending', metadata: { invoiceId: 'invoice-1', tenantId: TENANT } },
    ],
    metadata: { user_id: 'user-1', tenantId: TENANT },
    ...overrides,
  };
}

function buildInvoice(overrides: Record<string, unknown> = {}) {
  return {
    invoice_id: 'invoice-1',
    invoice_number: 'INV-100',
    client_id: 'client-1',
    status: 'sent',
    ...overrides,
  } as any;
}

function buildClient(overrides: Record<string, unknown> = {}) {
  return {
    client_id: 'client-1',
    client_name: 'Acme Corp',
    location_email: 'location@acme.test',
    location_address: '1 Main St',
    billing_contact_id: null,
    billing_email: null,
    ...overrides,
  } as any;
}

describe('InvoiceEmailHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    mocks.jobServiceCreate.mockResolvedValue({
      createJobDetail: mocks.createJobDetail,
      updateJobDetailRecord: mocks.updateJobDetailRecord,
      updateJobStatus: mocks.updateJobStatus,
    });
    mocks.createJobDetail
      .mockResolvedValueOnce('pdf-detail-1')
      .mockResolvedValueOnce('email-detail-1');
    mocks.updateJobDetailRecord.mockResolvedValue(undefined);
    mocks.updateJobStatus.mockResolvedValue(undefined);

    mocks.getEmailService.mockResolvedValue({ sendInvoiceEmail: mocks.sendInvoiceEmail });
    mocks.sendInvoiceEmail.mockResolvedValue(true);

    mocks.createPDFGenerationService.mockReturnValue({ generateAndStore: mocks.generateAndStore });
    mocks.generateAndStore.mockResolvedValue({ file_id: 'file-1', document_id: 'doc-1' });
    mocks.publishGeneratedDocumentsToClient.mockResolvedValue(1);

    mocks.downloadFile.mockResolvedValue({ buffer: Buffer.from('%PDF-1.4 test') });
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.unlink.mockResolvedValue(undefined);

    mocks.getInvoiceForRendering.mockResolvedValue(buildInvoice());
    mocks.getClientById.mockResolvedValue(buildClient());
    mocks.getContactByContactNameId.mockResolvedValue(null);
    mocks.resolveInvoiceBillingRecipient.mockResolvedValue({
      clientId: 'client-1',
      clientName: 'Acme Corp',
      recipientEmail: 'location@acme.test',
      recipientName: 'Acme Corp',
      recipientSource: 'billing_location',
    });
    mocks.getInvoiceEmailLinkContext.mockResolvedValue({
      paymentUrl: 'https://pay.example/invoice-1',
      portalUrl: 'https://portal.example/client-portal/billing?tab=invoices&invoiceId=invoice-1',
    });

    // Sender company name comes from the tenant party adapter
    mocks.getConnection.mockResolvedValue(vi.fn());
    mocks.fetchTenantParty.mockResolvedValue({
      name: 'MSP Co',
      address: null,
      email: null,
      phone: null,
      logo_url: null,
    });
  });

  describe('input validation', () => {
    it('should throw when jobServiceId is missing', async () => {
      await expect(
        InvoiceEmailHandler.handle('pg-1', buildJobData({ jobServiceId: '' as any })),
      ).rejects.toThrow('jobServiceId is required in job data');
      expect(mocks.jobServiceCreate).not.toHaveBeenCalled();
    });

    it('should throw when tenantId is missing', async () => {
      await expect(
        InvoiceEmailHandler.handle('pg-1', buildJobData({ tenantId: '' as any })),
      ).rejects.toThrow('Tenant ID is required');
    });

    it('should throw when no invoice IDs are provided', async () => {
      await expect(
        InvoiceEmailHandler.handle('pg-1', buildJobData({ invoiceIds: [] })),
      ).rejects.toThrow('No invoice IDs provided');
    });
  });

  describe('happy path', () => {
    it('should generate a PDF, send the email with payment link, and complete the job', async () => {
      await InvoiceEmailHandler.handle('pg-1', buildJobData());

      // PDF generated for the right tenant/invoice with the acting user
      expect(mocks.createPDFGenerationService).toHaveBeenCalledWith(TENANT);
      expect(mocks.generateAndStore).toHaveBeenCalledTimes(1);
      expect(mocks.generateAndStore).toHaveBeenCalledWith({
        invoiceId: 'invoice-1',
        invoiceNumber: 'INV-100',
        version: 1,
        userId: 'user-1',
      });

      // Stored PDF is downloaded and written to a temp file before sending
      expect(mocks.downloadFile).toHaveBeenCalledWith('file-1');
      expect(mocks.writeFile).toHaveBeenCalledTimes(1);
      const tempPath = mocks.writeFile.mock.calls[0][0] as string;
      expect(tempPath).toContain('INV-100');

      // Email sent exactly once with recipient + payment/portal links + tenant company name
      expect(mocks.sendInvoiceEmail).toHaveBeenCalledTimes(1);
      const [emailInvoice, emailPath, emailOptions] = mocks.sendInvoiceEmail.mock.calls[0];
      expect(emailInvoice.recipientEmail).toBe('location@acme.test');
      expect(emailInvoice.tenantId).toBe(TENANT);
      expect(emailInvoice.client).toEqual({ name: 'Acme Corp', logo: '', address: '1 Main St' });
      expect(emailPath).toBe(tempPath);
      expect(emailOptions).toEqual({
        paymentLink: 'https://pay.example/invoice-1',
        portalLink: 'https://portal.example/client-portal/billing?tab=invoices&invoiceId=invoice-1',
        companyName: 'MSP Co',
      });

      // Temp file always cleaned up
      expect(mocks.unlink).toHaveBeenCalledWith(tempPath);

      // Job lifecycle: both steps tracked, then completed
      expect(mocks.createJobDetail).toHaveBeenCalledTimes(2);
      expect(mocks.updateJobDetailRecord).toHaveBeenCalledWith('pdf-detail-1', 'completed', expect.objectContaining({ file_id: 'file-1' }));
      expect(mocks.updateJobDetailRecord).toHaveBeenCalledWith('email-detail-1', 'completed', expect.objectContaining({ recipientEmail: 'location@acme.test' }));
      const finalStatusCall = mocks.updateJobStatus.mock.calls.at(-1)!;
      expect(finalStatusCall[0]).toBe('job-service-1');
      expect(finalStatusCall[1]).toBe(JobStatus.Completed);
      expect(mocks.updateJobStatus).not.toHaveBeenCalledWith('job-service-1', JobStatus.Failed, expect.anything());
    });

    it('should attach the stored document and publish it to the client only after a successful send', async () => {
      await InvoiceEmailHandler.handle('pg-1', buildJobData());

      // One render per send: generateAndStore reuses the filed document.
      expect(mocks.generateAndStore).toHaveBeenCalledTimes(1);
      expect(mocks.generateAndStore.mock.calls[0][0]).not.toHaveProperty('regenerate', true);
      expect(mocks.downloadFile).toHaveBeenCalledWith('file-1');

      expect(mocks.publishGeneratedDocumentsToClient).toHaveBeenCalledWith(TENANT, 'invoice', 'invoice-1');
      const publishOrder = mocks.publishGeneratedDocumentsToClient.mock.invocationCallOrder[0];
      const sendOrder = mocks.sendInvoiceEmail.mock.invocationCallOrder[0];
      expect(publishOrder).toBeGreaterThan(sendOrder);
    });

    it('should leave the generated document MSP-only when the send fails', async () => {
      mocks.sendInvoiceEmail.mockResolvedValue(false);

      await expect(InvoiceEmailHandler.handle('pg-1', buildJobData())).rejects.toThrow(
        'Failed to send invoice email',
      );

      expect(mocks.publishGeneratedDocumentsToClient).not.toHaveBeenCalled();
    });

    it('should use the shared billing-recipient resolver result (billing contact preferred)', async () => {
      mocks.resolveInvoiceBillingRecipient.mockResolvedValue({
        clientId: 'client-1',
        clientName: 'Acme Corp',
        recipientEmail: 'contact@acme.test',
        recipientName: 'Jane Contact',
        recipientSource: 'billing_contact',
      });

      await InvoiceEmailHandler.handle('pg-1', buildJobData());

      expect(mocks.resolveInvoiceBillingRecipient).toHaveBeenCalledWith({
        knexOrTrx: expect.anything(),
        tenantId: TENANT,
        clientId: 'client-1',
      });
      expect(mocks.sendInvoiceEmail.mock.calls[0][0].recipientEmail).toBe('contact@acme.test');
      expect(mocks.sendInvoiceEmail.mock.calls[0][0].contact).toEqual({ name: 'Jane Contact', address: '1 Main St' });
    });

    it('should pass through the billing_email fallback from the shared resolver', async () => {
      mocks.resolveInvoiceBillingRecipient.mockResolvedValue({
        clientId: 'client-1',
        clientName: 'Acme Corp',
        recipientEmail: 'billing@acme.test',
        recipientName: 'Acme Corp',
        recipientSource: 'billing_email',
      });

      await InvoiceEmailHandler.handle('pg-1', buildJobData());

      expect(mocks.getContactByContactNameId).not.toHaveBeenCalled();
      expect(mocks.sendInvoiceEmail.mock.calls[0][0].recipientEmail).toBe('billing@acme.test');
    });

    it('should not request a payment link for paid invoices', async () => {
      mocks.getInvoiceForRendering.mockResolvedValue(buildInvoice({ status: 'paid' }));
      mocks.getInvoiceEmailLinkContext.mockResolvedValue({});

      await InvoiceEmailHandler.handle('pg-1', buildJobData());

      // The handler passes the invoice's eligibility fields through so the
      // shared link-context helper can gate on status; the helper returns no
      // URLs for a paid invoice and the email is sent without any CTA links.
      expect(mocks.getInvoiceEmailLinkContext).toHaveBeenCalledWith(
        TENANT,
        expect.objectContaining({ status: 'paid' }),
      );
      expect(mocks.sendInvoiceEmail.mock.calls[0][2]).toEqual({
        paymentLink: undefined,
        portalLink: undefined,
        companyName: 'MSP Co',
      });
    });

    it('should still send the email when payment link generation fails', async () => {
      mocks.getInvoiceEmailLinkContext.mockResolvedValue({
        paymentError: new Error('payment provider down'),
        portalUrl: 'https://portal.example/client-portal/billing?tab=invoices&invoiceId=invoice-1',
      });

      await InvoiceEmailHandler.handle('pg-1', buildJobData());

      expect(mocks.loggerWarn).toHaveBeenCalledWith(
        '[InvoiceEmailHandler] Failed to generate payment link',
        expect.objectContaining({ error: expect.any(Error) }),
      );
      expect(mocks.sendInvoiceEmail).toHaveBeenCalledTimes(1);
      expect(mocks.sendInvoiceEmail.mock.calls[0][2].paymentLink).toBeUndefined();
      // The portal fallback is still forwarded on creation failure.
      expect(mocks.sendInvoiceEmail.mock.calls[0][2].portalLink).toBe(
        'https://portal.example/client-portal/billing?tab=invoices&invoiceId=invoice-1',
      );
      const finalStatusCall = mocks.updateJobStatus.mock.calls.at(-1)!;
      expect(finalStatusCall[1]).toBe(JobStatus.Completed);
    });
  });

  describe('error paths', () => {
    it('should mark the job failed and re-throw when no recipient email can be resolved', async () => {
      mocks.resolveInvoiceBillingRecipient.mockResolvedValue({
        clientId: 'client-1',
        clientName: 'Acme Corp',
        recipientEmail: '',
        recipientName: 'Acme Corp',
        recipientSource: 'none',
      });

      await expect(
        InvoiceEmailHandler.handle('pg-1', buildJobData()),
      ).rejects.toThrow('No valid email address found for Acme Corp (Invoice #INV-100)');

      expect(mocks.sendInvoiceEmail).not.toHaveBeenCalled();
      expect(mocks.generateAndStore).not.toHaveBeenCalled();
      expect(mocks.updateJobStatus).toHaveBeenCalledWith('job-service-1', JobStatus.Failed, expect.objectContaining({
        tenantId: TENANT,
        pgBossJobId: 'pg-1',
        error: expect.stringContaining('No valid email address found'),
      }));
    });

    it('should record failure on both step details and fail the job when the email transport reports failure', async () => {
      mocks.sendInvoiceEmail.mockResolvedValue(false);

      await expect(
        InvoiceEmailHandler.handle('pg-1', buildJobData()),
      ).rejects.toThrow('Failed to send invoice email');

      // Only one email attempt: no duplicate sends after the failure.
      expect(mocks.sendInvoiceEmail).toHaveBeenCalledTimes(1);

      const contextualError = 'Failed to process Invoice #INV-100 for Acme Corp: Failed to send invoice email';
      expect(mocks.updateJobDetailRecord).toHaveBeenCalledWith('pdf-detail-1', 'failed', expect.objectContaining({ error: contextualError }));
      expect(mocks.updateJobDetailRecord).toHaveBeenCalledWith('email-detail-1', 'failed', expect.objectContaining({ error: contextualError }));
      expect(mocks.updateJobStatus).toHaveBeenCalledWith('job-service-1', JobStatus.Failed, expect.objectContaining({
        error: contextualError,
      }));
      // The handler must never report completion for a failed run.
      expect(mocks.updateJobStatus).not.toHaveBeenCalledWith('job-service-1', JobStatus.Completed, expect.anything());

      // Temp file is still cleaned up even when sending fails.
      expect(mocks.unlink).toHaveBeenCalledTimes(1);
    });

    it('should surface PDF generation failures with invoice context', async () => {
      mocks.generateAndStore.mockRejectedValue(new Error('pdf renderer crashed'));

      await expect(
        InvoiceEmailHandler.handle('pg-1', buildJobData()),
      ).rejects.toThrow('pdf renderer crashed');

      expect(mocks.sendInvoiceEmail).not.toHaveBeenCalled();
      expect(mocks.updateJobDetailRecord).toHaveBeenCalledWith('pdf-detail-1', 'failed', expect.objectContaining({
        error: 'Failed to process Invoice #INV-100 for Acme Corp: pdf renderer crashed',
      }));
      expect(mocks.updateJobStatus).toHaveBeenCalledWith('job-service-1', JobStatus.Failed, expect.anything());
    });

    // BUG (reported): pdfDetailId/emailDetailId are declared once outside the per-invoice loop in
    // server/src/lib/jobs/handlers/invoiceEmailHandler.ts (lines 57-58). When a later invoice fails
    // before its own createJobDetail calls run (e.g. getInvoiceForRendering returns null), the catch
    // block (lines 301-324) updates the PREVIOUS invoice's detail records to 'failed' even though that
    // invoice was already processed and marked 'completed'. Skipped until the product bug is fixed.
    it('should not overwrite a completed invoice\'s step details when a later invoice fails early', async () => {
      mocks.getInvoiceForRendering
        .mockResolvedValueOnce(buildInvoice()) // invoice-1 succeeds
        .mockResolvedValueOnce(null) // invoice-2 fails before job details are created
        .mockResolvedValueOnce(null); // catch-block re-fetch for error context
      mocks.createJobDetail.mockReset();
      mocks.createJobDetail
        .mockResolvedValueOnce('pdf-detail-1')
        .mockResolvedValueOnce('email-detail-1');

      const data = buildJobData({
        invoiceIds: ['invoice-1', 'invoice-2'],
        steps: [
          { stepName: 'PDF 1', type: 'pdf_generation', metadata: { invoiceId: 'invoice-1', tenantId: TENANT } },
          { stepName: 'Email 1', type: 'email_sending', metadata: { invoiceId: 'invoice-1', tenantId: TENANT } },
          { stepName: 'PDF 2', type: 'pdf_generation', metadata: { invoiceId: 'invoice-2', tenantId: TENANT } },
          { stepName: 'Email 2', type: 'email_sending', metadata: { invoiceId: 'invoice-2', tenantId: TENANT } },
        ],
      });

      await expect(InvoiceEmailHandler.handle('pg-1', data)).rejects.toThrow();

      // Invoice 1 completed; its detail records must not be flipped back to 'failed'.
      expect(mocks.updateJobDetailRecord).not.toHaveBeenCalledWith('pdf-detail-1', 'failed', expect.anything());
      expect(mocks.updateJobDetailRecord).not.toHaveBeenCalledWith('email-detail-1', 'failed', expect.anything());
    });
  });
});
