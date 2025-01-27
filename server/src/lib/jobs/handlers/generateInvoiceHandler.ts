import { finalizeInvoice } from '../../actions/invoiceActions';

export interface GenerateInvoiceData extends Record<string, unknown> {
  tenantId: string;
  companyId: string;
  billingCycleId: string;
}

export async function generateInvoiceHandler(data: GenerateInvoiceData): Promise<void> {
  const { billingCycleId } = data;
  
  try {
    // Generate invoice using the existing invoice generation logic
    await finalizeInvoice(billingCycleId);
  } catch (error) {
    console.error(`Failed to generate invoice for billing cycle ${billingCycleId}:`, error);
    throw error; // Re-throw to let pg-boss handle the failure
  }
}
