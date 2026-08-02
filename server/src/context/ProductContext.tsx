'use client';

import React, { createContext, useContext, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { ProductCode, resolveProductCode } from '@alga-psa/types';

export type ProductEdition = 'community' | 'enterprise';

interface ProductContextValue {
  productCode: ProductCode;
  edition: ProductEdition;
  isMisconfigured: boolean;
  isPsa: boolean;
  isAlgaDesk: boolean;
  isLoading: boolean;
}

const ProductContext = createContext<ProductContextValue | undefined>(undefined);

interface ProductProviderProps {
  children: React.ReactNode;
}

export function ProductProvider({ children }: ProductProviderProps) {
  const { data: session, status } = useSession();
  const isLoading = status === 'loading';
  const edition: ProductEdition = process.env.NEXT_PUBLIC_EDITION === 'enterprise'
    ? 'enterprise'
    : 'community';

  const { productCode, isMisconfigured } = useMemo(() => {
    return resolveProductCode(session?.user?.product_code);
  }, [session?.user]);

  const value = useMemo<ProductContextValue>(
    () => ({
      productCode,
      edition,
      isMisconfigured,
      isPsa: productCode === 'psa',
      isAlgaDesk: productCode === 'algadesk',
      isLoading,
    }),
    [edition, isLoading, isMisconfigured, productCode],
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
