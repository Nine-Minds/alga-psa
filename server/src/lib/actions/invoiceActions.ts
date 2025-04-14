'use server'

import { NumberingService } from 'server/src/lib/services/numberingService';
import { BillingEngine } from 'server/src/lib/billing/billingEngine';
import CompanyBillingPlan from 'server/src/lib/models/clientBilling';
import { applyCreditToInvoice } from 'server/src/lib/actions/creditActions';
import { Knex } from 'knex';
import { Session } from 'next-auth';
import {
  IInvoiceTemplate,
  ICustomField,
  IConditionalRule,
  IInvoiceAnnotation,
  InvoiceViewModel,
  IInvoiceItem,
  IInvoice,
  DiscountType,
  PreviewInvoiceResponse
} from 'server/src/interfaces/invoice.interfaces';
import { IBillingResult, IBillingCharge, IBucketCharge, IUsageBasedCharge, ITimeBasedCharge, IFixedPriceCharge, BillingCycleType, ICompanyBillingCycle } from 'server/src/interfaces/billing.interfaces';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import { getServerSession } from "next-auth/next";
import { options } from "server/src/app/api/auth/[...nextauth]/options";
import Invoice from 'server/src/lib/models/invoice';
import { parseInvoiceTemplate } from 'server/src/lib/invoice-dsl/templateLanguage';
import { createTenantKnex } from 'server/src/lib/db';
import { Temporal } from '@js-temporal/polyfill';
import { PDFGenerationService } from 'server/src/services/pdf-generation.service';
import { toPlainDate, toISODate, toISOTimestamp, formatDateOnly } from 'server/src/lib/utils/dateTimeUtils';
import { StorageService } from 'server/src/lib/storage/StorageService';
import { ISO8601String } from 'server/src/types/types.d';
import { TaxService } from 'server/src/lib/services/taxService';
import { ITaxCalculationResult } from 'server/src/interfaces/tax.interfaces';
import { v4 as uuidv4 } from 'uuid';
import { auditLog } from 'server/src/lib/logging/auditLog';
import * as invoiceService from 'server/src/lib/services/invoiceService';
import { getCompanyDetails, persistInvoiceItems, updateInvoiceTotalsAndRecordTransaction } from 'server/src/lib/services/invoiceService';

export interface ManualInvoiceUpdate { // Add export
  service_id?: string;
  description?: string;
  quantity?: number;
  rate?: number;
  item_id: string;
  is_discount?: boolean;
  discount_type?: DiscountType;
  discount_percentage?: number;
  applies_to_item_id?: string;
  is_taxable?: boolean; // Keep for purely manual items without service
}

interface ManualItemsUpdate {
  newItems: IInvoiceItem[];
  updatedItems: ManualInvoiceUpdate[];
  removedItemIds: string[];
  invoice_number?: string;
}

// This file is intentionally left almost blank after refactoring.
// It keeps the necessary imports and interface definitions that might be shared
// or were originally defined here.

// TODO: Review if these interfaces should move to 'server/src/interfaces/invoice.interfaces.ts'
