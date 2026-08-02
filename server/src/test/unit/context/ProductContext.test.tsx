/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProductProvider, useProduct } from '../../../context/ProductContext';

const useSession = vi.fn();

vi.mock('next-auth/react', () => ({
  useSession: (...args: unknown[]) => useSession(...args),
}));

describe('ProductContext', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('NEXT_PUBLIC_EDITION', 'community');
    useSession.mockReturnValue({
      status: 'authenticated',
      data: {
        user: {
          product_code: 'psa',
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ProductProvider>{children}</ProductProvider>
  );

  it('defaults to psa when product_code is absent', () => {
    useSession.mockReturnValue({
      status: 'authenticated',
      data: { user: {} },
    });

    const { result } = renderHook(() => useProduct(), { wrapper });
    expect(result.current.productCode).toBe('psa');
    expect(result.current.isPsa).toBe(true);
    expect(result.current.isMisconfigured).toBe(false);
  });

  it('resolves algadesk when configured', () => {
    useSession.mockReturnValue({
      status: 'authenticated',
      data: { user: { product_code: 'algadesk' } },
    });

    const { result } = renderHook(() => useProduct(), { wrapper });
    expect(result.current.productCode).toBe('algadesk');
    expect(result.current.isAlgaDesk).toBe(true);
  });

  it('exposes the build edition alongside the product', () => {
    vi.stubEnv('NEXT_PUBLIC_EDITION', 'enterprise');

    const { result } = renderHook(() => useProduct(), { wrapper });
    expect(result.current.edition).toBe('enterprise');
  });

  it('fails closed to psa and marks misconfigured for unknown product code', () => {
    useSession.mockReturnValue({
      status: 'authenticated',
      data: { user: { product_code: 'legacy' } },
    });

    const { result } = renderHook(() => useProduct(), { wrapper });
    expect(result.current.productCode).toBe('psa');
    expect(result.current.isMisconfigured).toBe(true);
  });
});
