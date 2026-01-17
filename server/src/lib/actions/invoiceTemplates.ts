'use server';

import type { IInvoiceTemplate } from '@alga-psa/types';
import {
  compileAndSaveTemplate as compileAndSaveTemplateImpl,
  getDefaultTemplate as getDefaultTemplateImpl,
  getInvoiceTemplate as getInvoiceTemplateImpl,
  getInvoiceTemplates as getInvoiceTemplatesImpl,
  saveInvoiceTemplate as saveInvoiceTemplateImpl,
  setClientTemplate as setClientTemplateImpl,
} from '@alga-psa/billing/actions/invoiceTemplates';

export async function getInvoiceTemplates(): Promise<IInvoiceTemplate[]> {
  return getInvoiceTemplatesImpl();
}

export async function getInvoiceTemplate(
  ...args: Parameters<typeof getInvoiceTemplateImpl>
): ReturnType<typeof getInvoiceTemplateImpl> {
  return getInvoiceTemplateImpl(...args);
}

export async function getDefaultTemplate(): Promise<IInvoiceTemplate | null> {
  return getDefaultTemplateImpl();
}

export async function setClientTemplate(clientId: string, templateId: string | null): Promise<void> {
  return setClientTemplateImpl(clientId, templateId);
}

export async function saveInvoiceTemplate(
  ...args: Parameters<typeof saveInvoiceTemplateImpl>
): ReturnType<typeof saveInvoiceTemplateImpl> {
  return saveInvoiceTemplateImpl(...args);
}

export async function compileAndSaveTemplate(
  ...args: Parameters<typeof compileAndSaveTemplateImpl>
): ReturnType<typeof compileAndSaveTemplateImpl> {
  return compileAndSaveTemplateImpl(...args);
}
