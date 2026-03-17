import { generateInvoice } from '@alga-psa/billing/actions/invoiceGeneration';
import type {
  IRecurringDueSelectionInput,
  IRecurringRunExecutionWindowIdentity,
} from '@alga-psa/types';
import { buildClientBillingCycleExecutionWindow } from '@alga-psa/shared/billingClients/recurringRunExecutionIdentity';

export interface GenerateInvoiceData extends Record<string, unknown> {
  tenantId: string;
  clientId: string;
  billingCycleId?: string;
  executionWindow?: IRecurringRunExecutionWindowIdentity;
  selectorInput?: IRecurringDueSelectionInput;
}

export async function generateInvoiceHandler(data: GenerateInvoiceData): Promise<void> {
  const executionWindow =
    data.executionWindow ??
    (data.billingCycleId
      ? buildClientBillingCycleExecutionWindow({
          billingCycleId: data.billingCycleId,
          clientId: data.clientId,
        })
      : undefined);

  if (!data.billingCycleId) {
    throw new Error(
      executionWindow
        ? `Recurring execution window ${executionWindow.identityKey} is defined but no billingCycleId bridge was provided.`
      : 'Recurring invoice job is missing both executionWindow and billingCycleId.',
    );
  }

  if (
    data.selectorInput &&
    data.selectorInput.executionWindow.identityKey !== executionWindow?.identityKey
  ) {
    throw new Error(
      `Recurring invoice job selectorInput identity ${data.selectorInput.executionWindow.identityKey} does not match executionWindow ${executionWindow?.identityKey}.`,
    );
  }

  try {
    // Generate invoice using the existing invoice generation logic
    await generateInvoice(data.billingCycleId);
  } catch (error) {
    console.error(
      `Failed to generate invoice for recurring execution window ${executionWindow?.identityKey ?? data.billingCycleId}:`,
      error,
    );
    throw error; // Re-throw to let pg-boss handle the failure
  }
}
