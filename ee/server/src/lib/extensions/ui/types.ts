/**
 * Types for UI Extension Framework
 */
import { ReactNode } from 'react';
import { 
  ExtensionComponentType, 
  TabExtensionProps,
  NavigationItemProps,
  DashboardWidgetProps,
  CustomPageProps
} from '../types';

/**
 * Base extension component props
 */
export interface BaseExtensionComponentProps {
  extensionId: string;
}

/**
 * Extension slot props
 */
export interface ExtensionSlotProps {
  name: string;
  filter?: (component: any) => boolean;
  props?: Record<string, any>;
}

/**
 * Extension error boundary props
 */
export interface ExtensionErrorBoundaryProps {
  extensionId: string;
  children: ReactNode;
  fallback?: ReactNode | ((error: Error) => ReactNode);
  onError?: (error: Error, info: { componentStack: string }) => void;
}

/**
 * Extension error boundary state
 */
export interface ExtensionErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Extension renderer props
 */
export interface ExtensionRendererProps {
  extensionId: string;
  componentPath: string;
  slotProps?: Record<string, any>;
  defaultProps?: Record<string, any>;
  onRender?: (timing: number) => void;
  onError?: (error: Error) => void;
}

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
 * Extension component metrics
 */
export interface ExtensionMetrics {
  renders: Array<{
    extensionId: string;
    componentPath: string;
    renderTime: number;
    timestamp: number;
  }>;
  errors: Array<{
    extensionId: string;
    componentPath: string;
    error: string;
    timestamp: number;
  }>;
}

/**
 * Tab extension component props
 */
export interface TabExtensionComponentProps extends BaseExtensionComponentProps, TabExtensionProps {
  // Additional tab-specific props
  isActive: boolean;
}

/**
 * Navigation item component props
 */
export interface NavigationItemComponentProps extends BaseExtensionComponentProps, NavigationItemProps {
  // Additional navigation-specific props
  isActive: boolean;
  isSidebarOpen: boolean;
}

/**
 * Dashboard widget component props
 */
export interface DashboardWidgetComponentProps extends BaseExtensionComponentProps, DashboardWidgetProps {
  // Additional widget-specific props
  data?: any;
  isLoading?: boolean;
  refresh?: () => void;
}

/**
 * Custom page component props
 */
export interface CustomPageComponentProps extends BaseExtensionComponentProps, CustomPageProps {
  // Additional page-specific props
  params?: Record<string, string>;
  searchParams?: Record<string, string>;
}