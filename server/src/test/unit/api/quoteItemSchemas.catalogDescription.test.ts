import { describe, expect, it } from 'vitest';
import {
  createQuoteApiSchema,
  createQuoteItemSchema,
  updateQuoteItemSchema,
} from '../../../lib/api/schemas/quoteSchemas';

const SERVICE_ID = '11111111-1111-4111-8111-111111111111';

const forgedItem = {
  service_id: SERVICE_ID,
  description: 'Managed Firewall Service',
  quantity: 1,
  unit_price: 25000,
  catalog_description: 'CALLER FORGED SNAPSHOT',
};

describe('quote API item schemas: catalog_description is server-captured only', () => {
  it('createQuoteItemSchema strips a caller-supplied catalog_description', () => {
    const result = createQuoteItemSchema.safeParse(forgedItem);

    expect(result.success).toBe(true);
    if (result.success) {
      expect('catalog_description' in result.data).toBe(false);
    }
  });

  it('updateQuoteItemSchema strips a caller-supplied catalog_description', () => {
    const result = updateQuoteItemSchema.safeParse({
      quantity: 2,
      unit_price: 30000,
      catalog_description: 'CALLER FORGED SNAPSHOT',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect('catalog_description' in result.data).toBe(false);
    }
  });

  it('createQuoteApiSchema strips catalog_description from inline items', () => {
    const result = createQuoteApiSchema.safeParse({
      title: 'Managed services proposal',
      items: [
        forgedItem,
        { ...forgedItem, service_id: null, description: 'Custom one-time audit' },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items?.length).toBe(2);
      for (const item of result.data.items ?? []) {
        expect('catalog_description' in item).toBe(false);
      }
    }
  });
});
