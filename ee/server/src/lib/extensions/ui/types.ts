/**
 * ext-v2 UI Types
 *
 * Legacy descriptor-era types have been removed. Host-side UI rendering is no longer supported.
 * Only keep the ExtensionContextValue used by ExtensionProvider.
 */
import { ReactNode } from 'react';

/**
 * Extension context
 */
export interface ExtensionContextValue {
  tenant: {
    id: string;
    name: string;
  };
  user: {
    id: string;
    name: string;
    email: string;
  } | null;
  hasPermission: (permission: string) => boolean;
  storage?: {
    get: <T>(key: string) => Promise<T | null>;
    set: <T>(key: string, value: T) => Promise<void>;
    remove: (key: string) => Promise<void>;
  };
}

/**
 * Optional: props/state for an error boundary, if used by consumers.
 * If not needed, these can be removed later.
 */
export interface ExtensionErrorBoundaryProps {
  extensionId: string;
  children: ReactNode;
  fallback?: ReactNode | ((error: Error) => ReactNode);
  onError?: (error: Error, info: { componentStack: string }) => void;
}

export interface ExtensionErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}