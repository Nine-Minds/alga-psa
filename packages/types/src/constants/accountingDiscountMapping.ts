/**
 * Automatic contract discounts land on invoices as lines with no service, so
 * they cannot ride a service mapping. Each accounting realm instead carries one
 * `discount` mapping, keyed by a fixed id, naming the item (QuickBooks, Xero)
 * or revenue account (Xero) the discount posts to.
 */
export const DISCOUNT_MAPPING_ENTITY_TYPE = 'discount';
export const AUTOMATIC_DISCOUNT_MAPPING_ID = 'automatic_discount';
