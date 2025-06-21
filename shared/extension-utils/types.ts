/**
 * Extension system types
 * 
 * Centralized type definitions for the extension system
 */

import React from 'react';

// Basic types that don't depend on EE-specific code
export interface HandlerContext {
  navigate: (path: string) => void;
  extensionId: string;
  [key: string]: any;
}

// Extension error boundary types (simplified for shared use)
export interface ExtensionErrorBoundaryProps {
  extensionId: string;
  children: React.ReactNode;
  fallback?: React.ComponentType<{ error: Error }> | React.ReactNode;
  onError?: (error: Error, info: { componentStack: string }) => void;
}

export interface ExtensionErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}