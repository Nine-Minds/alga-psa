import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { projectPaymentStateForInvoiceStatus } from '../../../lib/eventBus/subscribers/projectBillingPaymentStatusSubscriber';

describe('project billing payment status subscriber', () => {
  it('maps settlement, reversal, and replacement invoice states', () => {
    expect(projectPaymentStateForInvoiceStatus('sent')).toBe('outstanding');
    expect(projectPaymentStateForInvoiceStatus('partially_applied')).toBe('outstanding');
    expect(projectPaymentStateForInvoiceStatus('paid')).toBe('satisfied');
    expect(projectPaymentStateForInvoiceStatus('cancelled')).toBe('replacement_needed');
    expect(projectPaymentStateForInvoiceStatus('VOID')).toBe('replacement_needed');
  });

  it('derives events only for explicitly flagged linked schedule entries', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/lib/eventBus/subscribers/projectBillingPaymentStatusSubscriber.ts'),
      'utf8',
    );
    const registry = readFileSync(
      resolve(process.cwd(), 'src/lib/eventBus/subscribers/index.ts'),
      'utf8',
    );

    expect(source).toContain(".andWhere('entry.invoice_id', invoiceId)");
    expect(source).toContain(".andWhere('entry.requires_payment_before_work', true)");
    expect(source).toContain("eventType: 'PROJECT_BILLING_PAYMENT_STATUS_CHANGED'");
    expect(source).toContain('if (previousState === newState) return');
    expect(registry).toContain("{ name: 'projectBillingPaymentStatus', register: registerProjectBillingPaymentStatusSubscriber }");
    expect(registry).toContain("{ name: 'projectBillingPaymentStatus', register: unregisterProjectBillingPaymentStatusSubscriber }");
  });
});
