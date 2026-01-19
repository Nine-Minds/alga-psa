import { JobService, JobStepResult } from 'server/src/services/job.service';
import { getTenantDetails } from '@alga-psa/tenancy/actions';
import { getInvoiceForRendering } from '@alga-psa/billing/actions/invoiceQueries';
import { uploadDocument } from '@alga-psa/documents/actions/documentActions';
import type { TenantCompany } from 'server/src/lib/types';
/// <reference types="formdata-node" />
// @ts-ignore - Types exist but aren't properly exposed in package.json
const { FormData } = require('formdata-node');
import fs from 'fs/promises';
import { StorageService } from 'server/src/lib/storage/StorageService';
import { ZipGenerationService } from 'server/src/services/zip-generation.service';
import { PDFGenerationService, createPDFGenerationService } from 'server/src/services/pdf-generation.service';
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
    
    // Get invoice details first
    const invoice = await getInvoiceForRendering(invoiceId);
    if (!invoice || !invoice.invoice_number) {
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
      
      // Get tenant's default client
      const { clients } = await getTenantDetails();
      const defaultClient = clients.find(c => c.is_default);
      if (!defaultClient) {
        throw new Error('No default client found for tenant');
      }

      // Read zip file contents
      const zipBuffer = await fs.readFile(zipFilePath);
      
      // Create FormData object for upload
      const formData = new FormData();
      const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
      const fileName = `invoice_bundle_${timestamp}.zip`;
      formData.append('file', new Blob([new Uint8Array(zipBuffer)], {
        type: 'application/zip'
      }), fileName);

      // Upload to document system with client association
      const uploadResult = await uploadDocument(formData, {
        userId: data.requesterId,
        clientId: defaultClient.client_id
      });

      if (!uploadResult.success) {
        throw new Error(uploadResult.error || 'Failed to upload zip document');
      }

      // Complete ZIP creation
      const zipCompleteDetails = {
        file_id: uploadResult.document.file_id,
        storage_path: uploadResult.document.storage_path,
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
