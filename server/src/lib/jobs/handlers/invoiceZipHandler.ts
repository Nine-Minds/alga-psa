import { JobService, JobStepResult } from '@/services/job.service';
import { getTenantDetails } from '@/lib/actions/tenantActions';
import { getInvoiceForRendering } from '@/lib/actions/invoiceActions';
import { uploadDocument } from '@/lib/actions/document-actions/documentActions';
import type { TenantCompany } from '@/lib/types';
/// <reference types="formdata-node" />
// @ts-ignore - Types exist but aren't properly exposed in package.json
const { FormData } = require('formdata-node');
import fs from 'fs/promises';
import { StorageService } from '@/lib/storage/StorageService';
import { ZipGenerationService } from '@/services/zip-generation.service';
import { PDFGenerationService } from '@/services/pdf-generation.service';
import { JobStatus } from '@/types/job.d';

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

  private async processSingleInvoice(invoiceId: string, tenant: string): Promise<{file_id: string, storage_path: string, invoice_number: string}> {
    const pdfService = new PDFGenerationService(this.storageService, {
      tenant
    });
    
    // Get invoice details first
    const invoice = await getInvoiceForRendering(invoiceId);
    if (!invoice || !invoice.invoice_number) {
      throw new Error(`Failed to get invoice details or invoice number for invoice ${invoiceId}`);
    }

    // Generate and store PDF with invoice number
    const fileRecord = await pdfService.generateAndStore({
      invoiceId,
      invoiceNumber: invoice.invoice_number,
      version: 1
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
    
    console.log(`Starting ZIP bundle job: Processing ${invoiceIds.length} invoice(s) for tenant ${tenantId}`);

    try {
      const fileRecords: {file_id: string, storage_path: string, invoice_number: string}[] = [];
      
      // Process individual invoices
      for (let i = 0; i < invoiceIds.length; i++) {
        const invoiceId = invoiceIds[i];
        const step = steps[i];
        
        // Start processing invoice
        const processingResult: JobStepResult = {
          step: step.type,
          status: 'started',
          invoiceId,
          details: `Processing invoice ${i + 1} of ${invoiceIds.length}`
        };
        
        await this.jobService.updateJobStatus(jobServiceId, JobStatus.Processing, {
          tenantId,
          pgBossJobId,
          stepResult: processingResult
        });
        
        const fileRecord = await this.processSingleInvoice(invoiceId, tenantId);
        fileRecords.push(fileRecord);
        
        // Complete invoice processing
        const completedResult: JobStepResult = {
          step: step.type,
          status: 'completed',
          invoiceId,
          file_id: fileRecord.file_id,
          details: `Generated PDF for Invoice #${fileRecord.invoice_number}`
        };
        
        await this.jobService.updateJobStatus(jobServiceId, JobStatus.Processing, {
          tenantId,
          pgBossJobId,
          stepResult: completedResult
        });
      }

      // Process ZIP creation step
      const zipStep = steps[steps.length - 1];
      
      // Start ZIP creation
      const zipStartResult: JobStepResult = {
        step: zipStep.type,
        status: 'started',
        details: `Creating ZIP archive for ${fileRecords.length} invoice(s)`
      };
      
      await this.jobService.updateJobStatus(jobServiceId, JobStatus.Processing, {
        tenantId,
        pgBossJobId,
        stepResult: zipStartResult
      });
      
      const zipFilePath = await this.zipService.generateZipFromFileRecords(fileRecords);
      
      // Get tenant's default company
      const { companies } = await getTenantDetails();
      const defaultCompany = companies.find(c => c.is_default);
      if (!defaultCompany) {
        throw new Error('No default company found for tenant');
      }

      // Read zip file contents
      const zipBuffer = await fs.readFile(zipFilePath);
      
      // Create FormData object for upload
      const formData = new FormData();
      const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
      const fileName = `invoice_bundle_${timestamp}.zip`;
      formData.append('file', new Blob([zipBuffer], {
        type: 'application/zip'
      }), fileName);

      // Upload to document system with company association
      const uploadResult = await uploadDocument(formData, {
        userId: data.requesterId,
        companyId: defaultCompany.company_id
      });

      if (!uploadResult.success || !uploadResult.document) {
        throw new Error(uploadResult.error || 'Failed to upload zip document');
      }

      // Complete ZIP creation
      const zipCompleteResult: JobStepResult = {
        step: zipStep.type,
        status: 'completed',
        file_id: uploadResult.document.file_id,
        storage_path: uploadResult.document.storage_path,
        details: `Created and uploaded ZIP archive '${fileName}' containing ${fileRecords.length} invoice(s)`
      };
      
      await this.jobService.updateJobStatus(jobServiceId, JobStatus.Processing, {
        tenantId,
        pgBossJobId,
        stepResult: zipCompleteResult
      });
      
      // Mark entire job as completed
      await this.jobService.updateJobStatus(jobServiceId, JobStatus.Completed, {
        tenantId,
        pgBossJobId,
        details: `Successfully processed and bundled ${fileRecords.length} invoice(s) into ZIP archive`
      });
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.jobService.updateJobStatus(jobServiceId, JobStatus.Failed, {
        error: `Failed to create invoice bundle: ${errorMessage}`,
        tenantId,
        pgBossJobId
      });
      throw error;
    }
  }
}