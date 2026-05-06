'use client';

import React, { createContext, useContext, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { ProductCode, resolveProductCode } from '@alga-psa/types';

interface ProductContextValue {
  productCode: ProductCode;
  isMisconfigured: boolean;
  isPsa: boolean;
  isAlgadesk: boolean;
  isLoading: boolean;
}

const ProductContext = createContext<ProductContextValue | undefined>(undefined);

interface ProductProviderProps {
  children: React.ReactNode;
}

export function ProductProvider({ children }: ProductProviderProps) {
  const { data: session, status } = useSession();
  const isLoading = status === 'loading';

  const { productCode, isMisconfigured } = useMemo(() => {
    return resolveProductCode((session?.user as { product_code?: string } | undefined)?.product_code);
  }, [session?.user]);

  const value = useMemo<ProductContextValue>(
    () => ({
      productCode,
      isMisconfigured,
      isPsa: productCode === 'psa',
      isAlgadesk: productCode === 'algadesk',
      isLoading,
    }),
    [isLoading, isMisconfigured, productCode],
  );

  return <ProductContext.Provider value={value}>{children}</ProductContext.Provider>;
}

export function useProduct(): ProductContextValue {
  const context = useContext(ProductContext);
  if (!context) {
    throw new Error('useProduct must be used within a ProductProvider');
  }
  return context;
}
