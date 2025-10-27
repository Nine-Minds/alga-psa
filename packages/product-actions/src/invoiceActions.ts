'use server'

import { withTransaction } from '@alga-psa/shared/db';
import { Knex } from 'knex';
import { NumberingService } from '@server/lib/services/numberingService';
import { BillingEngine } from '@server/lib/billing/billingEngine';
import ClientContractLine from '@server/lib/models/clientContractLine';
import { applyCreditToInvoice } from '@product/actions/creditActions';
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
import { IBillingResult, IBillingCharge, IBucketCharge, IUsageBasedCharge, ITimeBasedCharge, IFixedPriceCharge, BillingCycleType, IClientContractLineCycle } from 'server/src/interfaces/billing.interfaces';
import { IClient } from 'server/src/interfaces/client.interfaces';
import Invoice from '@server/lib/models/invoice';
import { parseInvoiceTemplate } from '@server/lib/invoice-dsl/templateLanguage';
import { createTenantKnex } from '@server/lib/db';
import { Temporal } from '@js-temporal/polyfill';
import { PDFGenerationService } from 'server/src/services/pdf-generation.service';
import { toPlainDate, toISODate, toISOTimestamp, formatDateOnly } from '@server/lib/utils/dateTimeUtils';
import { StorageService } from '@server/lib/storage/StorageService';
import { ISO8601String } from 'server/src/types/types.d';
import { TaxService } from '@server/lib/services/taxService';
import { ITaxCalculationResult } from 'server/src/interfaces/tax.interfaces';
import { v4 as uuidv4 } from 'uuid';
import { auditLog } from '@server/lib/logging/auditLog';
import * as invoiceService from '@server/lib/services/invoiceService';
import { getClientDetails, persistInvoiceItems, updateInvoiceTotalsAndRecordTransaction } from '@server/lib/services/invoiceService';

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
