import { JobService } from '@/services/job.service';
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

  private async processSingleInvoice(invoiceId: string): Promise<{file_id: string, storage_path: string}> {
    const pdfService = new PDFGenerationService(this.storageService);
    const invoice = await getInvoiceForRendering(invoiceId);
    const fileRecord = await pdfService.generateAndStore({
      invoiceId,
      invoiceNumber: invoice.invoice_number,
      version: 1
    });
    
    return {
      file_id: fileRecord.file_id,
      storage_path: fileRecord.storage_path
    };
  }

  public async handleInvoiceZipJob(jobId: string, data: InvoiceZipJobData): Promise<void> {
    const { jobServiceId, invoiceIds, tenantId } = data;
    
    try {
      const steps = await this.jobService.getJobDetails(jobServiceId);
      
      const fileRecords: {file_id: string, storage_path: string}[] = [];
      
      // Process individual invoices
      for (const [index, invoiceId] of invoiceIds.entries()) {
        const step = steps[index];
        
        await this.jobService.updateStepStatus(
          jobServiceId,
          step.detail_id,
          JobStatus.Processing,
          { tenantId: data.tenantId }
        );
        
        const fileRecord = await this.processSingleInvoice(invoiceId);
        fileRecords.push(fileRecord);
        
        await this.jobService.updateStepStatus(
          jobServiceId,
          step.detail_id,
          JobStatus.Completed,
          { tenantId: data.tenantId }
        );
      }

      // Process ZIP creation step
      const zipStep = steps[steps.length - 1];
      
      await this.jobService.updateStepStatus(
        jobServiceId,
        zipStep.detail_id,
        JobStatus.Processing,
        { tenantId: data.tenantId }
      );
      
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
      formData.append('file', new Blob([zipBuffer], {
        type: 'application/zip'
      }), `invoice_bundle_${timestamp}.zip`);

      // Upload to document system with company association
      const uploadResult = await uploadDocument(formData, {
        userId: data.requesterId,
        companyId: defaultCompany.company_id
      });

      if (!uploadResult.success || !uploadResult.document) {
        throw new Error(uploadResult.error || 'Failed to upload zip document');
      }

      // Update job status with document info
      await this.jobService.updateStepStatus(
        jobServiceId,
        zipStep.detail_id,
        JobStatus.Completed,
        {
          tenantId: data.tenantId,
          path: zipFilePath,
          document_id: uploadResult.document.document_id,
          file_id: uploadResult.document.file_id,
          company_id: defaultCompany.company_id,
          storage_path: uploadResult.document.storage_path
        }
      );
      
      await this.jobService.updateJobStatus(
        jobServiceId,
        JobStatus.Completed,
        { tenantId }
      );
      
    } catch (error) {
      await this.jobService.updateJobStatus(
        jobServiceId,
        JobStatus.Failed,
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          tenantId
        }
      );
      throw error;
    }
  }
}