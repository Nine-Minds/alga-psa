'use server'

import {
  IInvoiceCharge,
  DiscountType,
} from '@alga-psa/types';

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
  newItems: IInvoiceCharge[];
  updatedItems: ManualInvoiceUpdate[];
  removedItemIds: string[];
  invoice_number?: string;
}

// This file is intentionally left almost blank after refactoring.
// It keeps the necessary imports and interface definitions that might be shared
// or were originally defined here.

// TODO: Review if these interfaces should move to '@alga-psa/types'
