import { describe, expect, it } from 'vitest';
import {
  createQuoteApiSchema,
  createQuoteItemSchema,
  updateQuoteApiSchema,
  updateQuoteItemSchema,
} from '../../../lib/api/schemas/quoteSchemas';

const SERVICE_ID = '11111111-1111-4111-8111-111111111111';

const forgedItem = {
  service_id: SERVICE_ID,
  description: 'Managed Firewall Service',
  quantity: 1,
  unit_price: 25000,
  catalog_description: 'Edited wording',
};

describe('quote API item schemas: catalog_description is an explicit, capped write', () => {
  it('accepts and normalizes section titles on create and update', () => {
    const create = createQuoteApiSchema.safeParse({
      title: 'Managed services proposal',
      recurring_section_title: '  Retainer  ',
      onetime_section_title: '   ',
    });
    const update = updateQuoteApiSchema.safeParse({
      recurring_section_title: '  Retainer  ',
      onetime_section_title: '   ',
    });

    expect(create.success).toBe(true);
    expect(update.success).toBe(true);
    if (create.success) {
      expect(create.data.recurring_section_title).toBe('Retainer');
      expect(create.data.onetime_section_title).toBeNull();
    }
    if (update.success) {
      expect(update.data.recurring_section_title).toBe('Retainer');
      expect(update.data.onetime_section_title).toBeNull();
    }
  });

  it('createQuoteItemSchema accepts catalog_description, allows null, and caps it at 4000 characters', () => {
    const result = createQuoteItemSchema.safeParse(forgedItem);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.catalog_description).toBe('Edited wording');

    expect(createQuoteItemSchema.safeParse({ ...forgedItem, catalog_description: null }).success).toBe(true);
    expect(createQuoteItemSchema.safeParse({ ...forgedItem, catalog_description: 'x'.repeat(4000) }).success).toBe(true);
    expect(createQuoteItemSchema.safeParse({ ...forgedItem, catalog_description: 'x'.repeat(4001) }).success).toBe(false);
  });

  it('updateQuoteItemSchema accepts catalog_description, and omitting it leaves the key absent', () => {
    const result = updateQuoteItemSchema.safeParse({ quantity: 2, catalog_description: 'Edited wording' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.catalog_description).toBe('Edited wording');

    const absent = updateQuoteItemSchema.safeParse({ quantity: 2 });
    expect(absent.success).toBe(true);
    if (absent.success) expect('catalog_description' in absent.data).toBe(false);

    expect(updateQuoteItemSchema.safeParse({ catalog_description: 'x'.repeat(4001) }).success).toBe(false);
  });

  it('catalog_description_edited is never accepted (stripped by create and update)', () => {
    for (const schema of [createQuoteItemSchema, updateQuoteItemSchema]) {
      const result = schema.safeParse({ ...forgedItem, catalog_description_edited: true });
      expect(result.success).toBe(true);
      if (result.success) expect('catalog_description_edited' in result.data).toBe(false);
    }
  });

  // alga-2026-0002902: a defaulted `true` was indistinguishable from an
  // explicit caller choice, so every quote line was created taxable even when
  // its service had no tax rate. The schema must leave the key absent.
  it('createQuoteItemSchema does not inject is_taxable when the caller omits it', () => {
    const result = createQuoteItemSchema.safeParse({
      service_id: SERVICE_ID,
      description: 'Managed Firewall Service',
      quantity: 1,
      unit_price: 25000,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.is_taxable).toBeUndefined();
    }
  });

  it('createQuoteItemSchema keeps an explicit is_taxable choice', () => {
    for (const isTaxable of [true, false]) {
      const result = createQuoteItemSchema.safeParse({
        service_id: SERVICE_ID,
        description: 'Managed Firewall Service',
        quantity: 1,
        unit_price: 25000,
        is_taxable: isTaxable,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.is_taxable).toBe(isTaxable);
      }
    }
  });

  it('createQuoteApiSchema keeps catalog_description on inline items and strips the flag', () => {
    const result = createQuoteApiSchema.safeParse({
      title: 'Managed services proposal',
      items: [
        { ...forgedItem, catalog_description_edited: true },
        { ...forgedItem, service_id: null, description: 'Custom one-time audit' },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items?.length).toBe(2);
      for (const item of result.data.items ?? []) {
        expect(item.catalog_description).toBe('Edited wording');
        expect('catalog_description_edited' in item).toBe(false);
      }
    }
  });
});
