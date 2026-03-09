'use client';

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { usePathname } from 'next/navigation';

export type AIChatRecordType =
  | 'ticket'
  | 'project'
  | 'client'
  | 'contact'
  | 'asset';

export interface AIChatUiContext {
  pathname: string;
  screen: {
    key: string;
    label: string;
  };
  record?: {
    type: AIChatRecordType;
    id: string;
  };
}

export interface AIChatContextOverride {
  pathname?: string;
  screen?: Partial<AIChatUiContext['screen']>;
  record?: AIChatUiContext['record'];
}

type AIChatContextValue = {
  uiContext: AIChatUiContext;
  setOverride: (override: AIChatContextOverride | null) => void;
};

const AIChatContext = createContext<AIChatContextValue | null>(null);

function toTitleCase(value: string): string {
  return value
    .split(/[-_]/g)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function deriveScreenFromPathname(pathname: string | null): AIChatUiContext['screen'] {
  const fallback = {
    key: 'msp',
    label: 'MSP Portal',
  };

  if (!pathname) {
    return fallback;
  }

  const stripped = pathname.replace(/^\/+|\/+$/g, '');
  const segments = stripped.split('/').filter(Boolean);
  if (segments.length === 0) {
    return fallback;
  }

  const withoutPortal = segments[0] === 'msp' ? segments.slice(1) : segments;
  if (withoutPortal.length === 0) {
    return fallback;
  }

  const [primary, secondary] = withoutPortal;
  const key = secondary ? `${primary}.${secondary}` : primary;

  if (primary === 'dashboard') {
    return { key, label: 'Dashboard' };
  }
  if (primary === 'tickets') {
    return { key, label: secondary ? 'Ticket Details' : 'Tickets' };
  }
  if (primary === 'projects') {
    return { key, label: secondary ? 'Project Details' : 'Projects' };
  }
  if (primary === 'clients') {
    return { key, label: secondary ? 'Client Details' : 'Clients' };
  }
  if (primary === 'contacts') {
    return { key, label: secondary ? 'Contact Details' : 'Contacts' };
  }
  if (primary === 'assets') {
    return { key, label: secondary ? 'Asset Details' : 'Assets' };
  }
  if (primary === 'billing') {
    return { key, label: 'Billing' };
  }
  if (primary === 'settings') {
    return { key, label: secondary ? `Settings: ${toTitleCase(secondary)}` : 'Settings' };
  }
  if (primary === 'chat') {
    return { key, label: 'Chat' };
  }

  return {
    key,
    label: toTitleCase(secondary ?? primary),
  };
}

export function AIChatContextProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [override, setOverride] = useState<AIChatContextOverride | null>(null);

  const uiContext = useMemo<AIChatUiContext>(() => {
    const resolvedPath = override?.pathname ?? pathname ?? '/msp';
    const derivedScreen = deriveScreenFromPathname(resolvedPath);

    return {
      pathname: resolvedPath,
      screen: {
        key: override?.screen?.key ?? derivedScreen.key,
        label: override?.screen?.label ?? derivedScreen.label,
      },
      ...(override?.record ? { record: override.record } : {}),
    };
  }, [override, pathname]);

  const value = useMemo<AIChatContextValue>(
    () => ({
      uiContext,
      setOverride,
    }),
    [uiContext],
  );

  return <AIChatContext.Provider value={value}>{children}</AIChatContext.Provider>;
}

export function useAIChatContext(): AIChatUiContext {
  const context = useContext(AIChatContext);
  if (!context) {
    throw new Error('useAIChatContext must be used within AIChatContextProvider');
  }

  return context.uiContext;
}

export function useAIChatContextOverride(override: AIChatContextOverride | null) {
  const context = useContext(AIChatContext);

  useEffect(() => {
    if (!context) {
      return;
    }

    context.setOverride(override);
    return () => {
      context.setOverride(null);
    };
  }, [context, override]);
}

export function AIChatContextBoundary({
  children,
  value,
}: {
  children: React.ReactNode;
  value: AIChatContextOverride;
}) {
  const stableValue = useMemo<AIChatContextOverride>(
    () => ({
      pathname: value.pathname,
      screen: value.screen,
      record: value.record,
    }),
    [value.pathname, value.record?.id, value.record?.type, value.screen?.key, value.screen?.label],
  );

  useAIChatContextOverride(stableValue);
  return <>{children}</>;
}
