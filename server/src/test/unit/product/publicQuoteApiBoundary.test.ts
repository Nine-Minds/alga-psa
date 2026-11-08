import { describe, expect, it } from 'vitest';
import {
  getApiMetadataProducts,
  isApiVisibleInMetadata,
  resolveProductApiBehavior,
} from '../../../lib/productSurfaceRegistry';

describe('public quote API product boundary', () => {
  it.each(['pdf', 'decision'])('keeps token-based %s outside API metadata while enforcing the billing product boundary', (operation) => {
    const route = `/api/quote/${'A'.repeat(43)}/${operation}`;

    expect(resolveProductApiBehavior('psa', route)).toBe('allowed');
    expect(resolveProductApiBehavior('algadesk', route)).toBe('denied');
    expect(resolveProductApiBehavior('co_managed', route)).toBe('denied');
    expect(isApiVisibleInMetadata('psa', route)).toBe(false);
    expect(isApiVisibleInMetadata('algadesk', route)).toBe(false);
    expect(isApiVisibleInMetadata('co_managed', route)).toBe(false);
    expect(getApiMetadataProducts(route)).toEqual([]);
  });
});
