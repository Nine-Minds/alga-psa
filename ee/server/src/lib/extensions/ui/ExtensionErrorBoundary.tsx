/**
 * Extension Error Boundary
 * 
 * Catches errors in extension components to prevent them from crashing the host application
 */
'use client';

import React from 'react';
import { logger, ExtensionErrorBoundaryProps, ExtensionErrorBoundaryState } from '@alga-psa/shared/extension-utils';

/**
 * Default fallback UI for extension errors
 */
const DefaultErrorFallback = ({ error, extensionId }: { error: Error, extensionId: string }) => (
  <div
    className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm"
    data-extension-error={extensionId}
  >
    <div className="font-medium text-destructive">Extension Error</div>
    <div className="mt-2 text-destructive/80">
      {error.message || 'An error occurred in this extension'}
    </div>
    <div className="mt-1 text-destructive/70 text-xs">{extensionId}</div>
  </div>
);

/**
 * Error boundary component for extensions
 * 
 * Catches errors thrown by extension components and prevents them
 * from crashing the host application.
 */
export class ExtensionErrorBoundary extends React.Component<
  ExtensionErrorBoundaryProps,
  ExtensionErrorBoundaryState
> {
  constructor(props: ExtensionErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): ExtensionErrorBoundaryState {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // Log the error
    logger.error('Extension error', {
      extensionId: this.props.extensionId,
      error: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });

    // Call onError callback if provided
    if (this.props.onError) {
      this.props.onError(error, info);
    }
  }

  render() {
    const { hasError, error } = this.state;
    const { children, fallback, extensionId } = this.props;

    if (hasError && error) {
      // If a custom fallback is provided, use it
      if (fallback) {
        if (typeof fallback === 'function') {
          return (fallback as any)({ error });
        }
        return fallback;
      }

      // Otherwise use the default fallback
      return <DefaultErrorFallback error={error} extensionId={extensionId} />;
    }

    return children;
  }
}