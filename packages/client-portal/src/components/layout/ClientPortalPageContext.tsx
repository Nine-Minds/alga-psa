'use client';

import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export interface PageHeaderState {
  breadcrumb?: ReactNode;
  title?: string;
  primaryAction?: ReactNode;
}

interface ClientPortalPageContextValue {
  header: PageHeaderState;
  setHeader: (next: PageHeaderState) => void;
}

const ClientPortalPageContext = createContext<ClientPortalPageContextValue | null>(null);

export function ClientPortalPageProvider({ children }: { children: ReactNode }) {
  const [header, setHeaderState] = useState<PageHeaderState>({});

  const setHeader = useCallback((next: PageHeaderState) => {
    setHeaderState(next);
  }, []);

  const value = useMemo(() => ({ header, setHeader }), [header, setHeader]);

  return (
    <ClientPortalPageContext.Provider value={value}>
      {children}
    </ClientPortalPageContext.Provider>
  );
}

export function useClientPortalHeader() {
  const ctx = useContext(ClientPortalPageContext);
  if (!ctx) {
    throw new Error('useClientPortalHeader must be used inside ClientPortalPageProvider');
  }
  return ctx;
}

export function useSetClientPortalHeader(header: PageHeaderState, deps: ReadonlyArray<unknown> = []) {
  const ctx = useContext(ClientPortalPageContext);
  useEffect(() => {
    if (!ctx) return;
    ctx.setHeader(header);
    return () => ctx.setHeader({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
