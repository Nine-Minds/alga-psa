'use server';

import {
  getClientPortalInvoicePaymentLink as _getClientPortalInvoicePaymentLink,
  verifyClientPortalPayment as _verifyClientPortalPayment,
} from '../clientPaymentActions';

export async function getClientPortalInvoicePaymentLink(
  ...args: Parameters<typeof _getClientPortalInvoicePaymentLink>
): ReturnType<typeof _getClientPortalInvoicePaymentLink> {
  return _getClientPortalInvoicePaymentLink(...args);
}

export async function verifyClientPortalPayment(
  ...args: Parameters<typeof _verifyClientPortalPayment>
): ReturnType<typeof _verifyClientPortalPayment> {
  return _verifyClientPortalPayment(...args);
}
