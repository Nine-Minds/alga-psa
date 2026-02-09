import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: unknown) => fn,
}));

import { __previewCompileCacheTestUtils } from './invoiceTemplatePreview';

describe('invoiceTemplatePreview compile cache', () => {
  beforeEach(() => {
    __previewCompileCacheTestUtils.clear();
  });

  it('reuses artifacts for unchanged source hash keys', () => {
    __previewCompileCacheTestUtils.set('hash-a', {
      wasmBinary: Buffer.from('wasm-a'),
      compileCommand: 'compile-a',
    });

    const cached = __previewCompileCacheTestUtils.get('hash-a');
    expect(cached).toBeTruthy();
    expect(cached?.compileCommand).toBe('compile-a');
    expect(cached?.wasmBinary.toString()).toBe('wasm-a');
    expect(__previewCompileCacheTestUtils.size()).toBe(1);
  });

  it('evicts oldest entries once cache exceeds limit', () => {
    for (let index = 0; index < 36; index += 1) {
      __previewCompileCacheTestUtils.set(`hash-${index}`, {
        wasmBinary: Buffer.from(`wasm-${index}`),
        compileCommand: `compile-${index}`,
      });
    }

    expect(__previewCompileCacheTestUtils.size()).toBe(32);
    expect(__previewCompileCacheTestUtils.get('hash-0')).toBeNull();
    expect(__previewCompileCacheTestUtils.get('hash-35')?.compileCommand).toBe('compile-35');
  });
});
