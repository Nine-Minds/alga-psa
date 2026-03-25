import { describe, expect, it } from 'vitest';
import type { IQuote, IQuoteListItem, QuoteStatus } from '@alga-psa/types';
import {
  createQuoteItemSchema,
  createQuoteSchema,
  quoteStatusTransitionSchema,
} from '../../src/schemas/quoteSchemas';

describe('Quote types and schemas', () => {
  it('T009: IQuote interface includes the expected core fields', () => {
    const quote: IQuote = {
      tenant: 'tenant-1',
      quote_id: 'quote-1',
      quote_number: 'Q-0001',
      client_id: 'client-1',
      title: 'Managed Services Proposal',
      quote_date: '2026-03-13T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      status: 'draft',
      version: 1,
      subtotal: 10000,
      discount_total: 0,
      tax: 0,
      total_amount: 10000,
      currency_code: 'USD',
      is_template: false,
    };

    expect(quote.title).toBe('Managed Services Proposal');
    expect(quote.total_amount).toBe(10000);
  });

  it('T010: QuoteStatus includes the Phase 1 lifecycle statuses', () => {
    const statuses: QuoteStatus[] = [
      'draft',
      'sent',
      'accepted',
      'rejected',
      'expired',
      'converted',
      'cancelled',
      'superseded',
      'archived',
    ];

    expect(statuses).toEqual(expect.arrayContaining([
      'draft',
      'sent',
      'accepted',
      'rejected',
      'expired',
      'converted',
      'cancelled',
      'superseded',
    ]));
  });

  it('T011: IQuoteListItem includes joined client fields and display values', () => {
    const listItem: IQuoteListItem = {
      tenant: 'tenant-1',
      quote_id: 'quote-1',
      quote_number: 'Q-0001',
      client_id: 'client-1',
      client_name: 'Acme Co',
      title: 'Managed Services Proposal',
      quote_date: '2026-03-13T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      status: 'draft',
      version: 1,
      subtotal: 10000,
      discount_total: 0,
      tax: 0,
      total_amount: 10000,
      currency_code: 'USD',
      is_template: false,
      display_quote_number: 'Q-0001',
    };

    expect(listItem.client_name).toBe('Acme Co');
    expect(listItem.display_quote_number).toBe('Q-0001');
  });

  it('T012: createQuoteSchema requires client_id, title, quote_date, valid_until', () => {
    const baseMissingFields = createQuoteSchema.safeParse({});
    const missingClient = createQuoteSchema.safeParse({
      title: 'Proposal',
      quote_date: '2026-03-13T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
    });

    expect(baseMissingFields.success).toBe(false);
    expect(baseMissingFields.error?.issues.map((issue) => issue.path.join('.'))).toEqual(
      expect.arrayContaining(['title', 'quote_date', 'valid_until'])
    );
    expect(missingClient.success).toBe(false);
    expect(missingClient.error?.issues.some((issue) => issue.path.join('.') === 'client_id')).toBe(true);
  });

  it('T013: createQuoteSchema rejects valid_until before quote_date', () => {
    const result = createQuoteSchema.safeParse({
      client_id: '11111111-1111-4111-8111-111111111111',
      title: 'Proposal',
      quote_date: '2026-03-20T00:00:00.000Z',
      valid_until: '2026-03-19T00:00:00.000Z',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path.join('.') === 'valid_until')).toBe(true);
  });

  it('T014: createQuoteItemSchema requires description and quantity > 0', () => {
    const result = createQuoteItemSchema.safeParse({
      quote_id: '11111111-1111-4111-8111-111111111111',
      description: '',
      quantity: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual(
      expect.arrayContaining(['description', 'quantity'])
    );
  });

  it('T015: status transition validation allows draft→sent but rejects draft→accepted', () => {
    expect(quoteStatusTransitionSchema.safeParse({ currentStatus: 'draft', nextStatus: 'sent' }).success).toBe(true);
    expect(quoteStatusTransitionSchema.safeParse({ currentStatus: 'draft', nextStatus: 'accepted' }).success).toBe(false);
  });

  it('T016: status transition validation allows sent terminal choices', () => {
    expect(quoteStatusTransitionSchema.safeParse({ currentStatus: 'sent', nextStatus: 'accepted' }).success).toBe(true);
    expect(quoteStatusTransitionSchema.safeParse({ currentStatus: 'sent', nextStatus: 'rejected' }).success).toBe(true);
    expect(quoteStatusTransitionSchema.safeParse({ currentStatus: 'sent', nextStatus: 'expired' }).success).toBe(true);
    expect(quoteStatusTransitionSchema.safeParse({ currentStatus: 'sent', nextStatus: 'cancelled' }).success).toBe(true);
  });

  it('T017: status transition validation allows accepted→converted but rejects converted→draft', () => {
    expect(quoteStatusTransitionSchema.safeParse({ currentStatus: 'accepted', nextStatus: 'converted' }).success).toBe(true);
    expect(quoteStatusTransitionSchema.safeParse({ currentStatus: 'converted', nextStatus: 'draft' }).success).toBe(false);
  });
});
