// This handler runs inside a background job: there is no request scope, so it
// must never call withAuth server actions (their getCurrentUser reads request
// headers). Everything here talks to the database and storage directly, acting
// as the requester recorded in the job data.
import { JobService, JobStepResult } from 'server/src/services/job.service';
import { getConnection, tenantDb, withTransaction } from '@alga-psa/db';
import { Document as DocumentModel, DocumentAssociation } from '@alga-psa/documents/models';
import type { IDocument } from '@alga-psa/types';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import { StorageService } from '@alga-psa/storage/StorageService';
import { ZipGenerationService } from 'server/src/services/zip-generation.service';
import { PDFGenerationService, createPDFGenerationService } from '@alga-psa/billing/services';
import { JobStatus } from 'server/src/types/job';

export interface InvoiceZipJobData extends Record<string, unknown> {
  jobServiceId: string;
  invoiceIds: string[];
  tenantId: string;
  requesterId: string;
  steps: {
    stepName: string;
    type: string;
    metadata: {
      invoiceId?: string;
      tenantId: string;
    };
  }[];
  metadata: {
    user_id: string;
    invoice_count: number;
    tenantId: string;
  };
}

export class InvoiceZipJobHandler {
  private jobService: JobService;
  private storageService: StorageService;
  private zipService: ZipGenerationService;

  constructor(jobService: JobService, storageService: StorageService) {
    this.jobService = jobService;
    this.storageService = storageService;
    this.zipService = new ZipGenerationService(storageService);
  }

  private async processSingleInvoice(invoiceId: string, tenant: string, requesterId: string): Promise<{file_id: string, storage_path: string, invoice_number: string}> {
    // Use the factory function to create the PDF generation service
    const pdfService = createPDFGenerationService(tenant);

    const knex = await getConnection(tenant);
    const invoice = await tenantDb(knex, tenant).table('invoices')
      .where({ invoice_id: invoiceId })
      .first<{ invoice_number?: string | null } | undefined>('invoice_number');
    if (!invoice?.invoice_number) {
      throw new Error(`Failed to get invoice details or invoice number for invoice ${invoiceId}`);
    }

    // Generate and store PDF with invoice number
    const fileRecord = await pdfService.generateAndStore({
      invoiceId,
      invoiceNumber: invoice.invoice_number,
      version: 1,
      userId: requesterId
    });

    return {
      file_id: fileRecord.file_id,
      storage_path: fileRecord.storage_path,
      invoice_number: invoice.invoice_number
    };
  }

  /**
   * The zip's document type, so the exported bundle carries the same type/icon
   * as an uploaded archive. Mirrors PDFGenerationService.resolvePdfDocumentType.
   */
  private async resolveZipDocumentType(
    knex: Knex,
    tenant: string
  ): Promise<(Pick<IDocument, 'type_id'> & Partial<Pick<IDocument, 'shared_type_id'>>) | null> {
    try {
      const db = tenantDb(knex, tenant);

      const tenantType = await db.table('document_types')
        .where({ type_name: 'application/zip' })
        .first<{ type_id: string } | undefined>('type_id');
      if (tenantType?.type_id) {
        return { type_id: tenantType.type_id };
      }

      const sharedType = await db.table('shared_document_types')
        .where({ type_name: 'application/zip' })
        .first<{ type_id: string } | undefined>('type_id');
      if (sharedType?.type_id) {
        return { type_id: null, shared_type_id: sharedType.type_id };
      }
    } catch (error) {
      console.error('Failed to resolve the ZIP document type:', error);
    }

    return null;
  }

  public async handleInvoiceZipJob(pgBossJobId: string, data: InvoiceZipJobData): Promise<void> { 
    if (!data.jobServiceId) {
      throw new Error('jobServiceId is required in job data');
    }

    const { jobServiceId, invoiceIds, tenantId, steps } = data;
    let zipDetailId: string | undefined;
    
    console.log(`Starting ZIP bundle job: Processing ${invoiceIds.length} invoice(s) for tenant ${tenantId}`);

    try {
      const fileRecords: {file_id: string, storage_path: string, invoice_number: string}[] = [];
      
      // Process individual invoices
      for (let i = 0; i < invoiceIds.length; i++) {
        const invoiceId = invoiceIds[i];
        const step = steps[i];
        
        // Start processing invoice
        const processingDetails = {
          invoiceId,
          details: `Processing invoice ${i + 1} of ${invoiceIds.length}`
        };
        
        // Create job detail record and get its ID
        const detailId = await this.jobService.createJobDetail(
          jobServiceId,
          step.stepName,
          'processing',
          processingDetails
        );
        
        await this.jobService.updateJobStatus(jobServiceId, JobStatus.Processing, {
          tenantId,
          pgBossJobId,
          stepResult: {
            step: step.type,
            status: 'started',
            ...processingDetails
          }
        });
        
        const fileRecord = await this.processSingleInvoice(invoiceId, tenantId, data.requesterId);
        fileRecords.push(fileRecord);
        
        // Complete invoice processing
        const completedDetails = {
          invoiceId,
          file_id: fileRecord.file_id,
          details: `Generated PDF for Invoice #${fileRecord.invoice_number}`
        };
        
        // Update the existing job detail record
        await this.jobService.updateJobDetailRecord(
          detailId,
          'completed',
          completedDetails
        );
        
        await this.jobService.updateJobStatus(jobServiceId, JobStatus.Processing, {
          tenantId,
          pgBossJobId,
          stepResult: {
            step: step.type,
            status: 'completed',
            ...completedDetails
          }
        });
      }

      // Process ZIP creation step
      const zipStep = steps[steps.length - 1];
      let zipDetailId: string | undefined;
      
      // Start ZIP creation
      const zipStartDetails = {
        details: `Creating ZIP archive for ${fileRecords.length} invoice(s)`
      };

      // Create job detail record for ZIP creation
      zipDetailId = await this.jobService.createJobDetail(
        jobServiceId,
        zipStep.stepName,
        'processing',
        zipStartDetails
      );
      
      await this.jobService.updateJobStatus(jobServiceId, JobStatus.Processing, {
        tenantId,
        pgBossJobId,
        stepResult: {
          step: zipStep.type,
          status: 'started',
          ...zipStartDetails
        }
      });
      
      const zipFilePath = await this.zipService.generateZipFromFileRecords(fileRecords);

      const knex = await getConnection(tenantId);

      // Tenant's default client, straight from the database.
      const scopedDb = tenantDb(knex, tenantId);
      const defaultClientQuery = scopedDb.table('tenant_companies as tc')
        .where('tc.is_default', true)
        .whereNull('tc.deleted_at')
        .select('tc.client_id')
        .first<{ client_id: string } | undefined>();
      const defaultClient = await defaultClientQuery;
      if (!defaultClient) {
        throw new Error('No default client found for tenant');
      }

      // Read zip file contents and store the archive as a document owned by
      // the user who requested the export.
      const zipBuffer = await fs.readFile(zipFilePath);
      const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
      const fileName = `invoice_bundle_${timestamp}.zip`;

      const storedFile = await StorageService.uploadFile(tenantId, zipBuffer, fileName, {
        mime_type: 'application/zip',
        uploaded_by_id: data.requesterId,
      });

      const zipDocumentType = await this.resolveZipDocumentType(knex, tenantId);
      const documentId = uuidv4();
      await withTransaction(knex, async (trx: Knex.Transaction) => {
        await DocumentModel.insert(trx, {
          ...(zipDocumentType ?? { type_id: null }),
          document_id: documentId,
          document_name: fileName,
          user_id: data.requesterId,
          created_by: data.requesterId,
          order_number: 0,
          tenant: tenantId,
          file_id: storedFile.file_id,
          storage_path: storedFile.storage_path,
          mime_type: 'application/zip',
          file_size: storedFile.file_size,
          is_client_visible: false,
        } as IDocument);

        await DocumentAssociation.create(trx, {
          document_id: documentId,
          entity_id: defaultClient.client_id,
          entity_type: 'client',
          tenant: tenantId,
        });
      });

      // Complete ZIP creation
      const zipCompleteDetails = {
        file_id: storedFile.file_id,
        storage_path: storedFile.storage_path,
        details: `Created and uploaded ZIP archive '${fileName}' containing ${fileRecords.length} invoice(s)`
      };

      // Update the existing job detail record for ZIP creation
      await this.jobService.updateJobDetailRecord(
        zipDetailId,
        'completed',
        zipCompleteDetails
      );
      
      await this.jobService.updateJobStatus(jobServiceId, JobStatus.Processing, {
        tenantId,
        pgBossJobId,
        stepResult: {
          step: zipStep.type,
          status: 'completed',
          ...zipCompleteDetails
        }
      });
      
      // Mark entire job as completed
      await this.jobService.updateJobStatus(jobServiceId, JobStatus.Completed, {
        tenantId,
        pgBossJobId,
        details: `Successfully processed and bundled ${fileRecords.length} invoice(s) into ZIP archive`
      });
      
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const failureDetails = {
        error: `Failed to create invoice bundle: ${errorMessage}`
      };

      // Update the ZIP step's job detail record to failed if it exists
      if (typeof zipDetailId !== 'undefined') {
        await this.jobService.updateJobDetailRecord(
          zipDetailId,
          'failed',
          failureDetails
        );
      }

      await this.jobService.updateJobStatus(jobServiceId, JobStatus.Failed, {
        error: failureDetails.error,
        tenantId,
        pgBossJobId
      });
      throw error;
    }
  }
}
