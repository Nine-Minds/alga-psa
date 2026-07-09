import {
  generateInvoiceForSelectionInput,
} from '@alga-psa/billing/actions/invoiceGeneration';
import type {
  IRecurringDueSelectionInput,
  IRecurringRunExecutionWindowIdentity,
} from '@alga-psa/types';

export interface GenerateInvoiceData extends Record<string, unknown> {
  tenantId: string;
  clientId: string;
  executionWindow: IRecurringRunExecutionWindowIdentity;
  selectorInput: IRecurringDueSelectionInput;
}

export async function generateInvoiceHandler(data: GenerateInvoiceData): Promise<void> {
  const executionWindow = data.executionWindow;

  if (!data.selectorInput) {
    throw new Error('Recurring invoice job is missing selectorInput.');
  }

  if (
    data.selectorInput.executionWindow.identityKey !== executionWindow?.identityKey
  ) {
    throw new Error(
      `Recurring invoice job selectorInput identity ${data.selectorInput.executionWindow.identityKey} does not match executionWindow ${executionWindow?.identityKey}.`,
    );
  }

  try {
    const result = await generateInvoiceForSelectionInput(data.selectorInput);
    if (
      result &&
      typeof result === 'object' &&
      (
        typeof (result as { actionError?: unknown }).actionError === 'string' ||
        typeof (result as { permissionError?: unknown }).permissionError === 'string'
      )
    ) {
      throw new Error(
        'permissionError' in (result as unknown as Record<string, unknown>)
          ? String((result as unknown as { permissionError: string }).permissionError)
          : String((result as unknown as { actionError: string }).actionError),
      );
    }
  } catch (error) {
    console.error(
      `Failed to generate invoice for recurring execution window ${executionWindow?.identityKey}:`,
      error,
    );
    throw error; // Re-throw to let pg-boss handle the failure
  }
}
