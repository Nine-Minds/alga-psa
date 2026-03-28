import { toast } from 'react-hot-toast';
import { ShieldAlert } from 'lucide-react';
import React from 'react';

// --- Permission error return type for server actions ---

/**
 * Represents a permission error returned from a server action.
 * Next.js strips thrown error messages during serialization, so permission
 * errors must be returned as plain objects to reach the client intact.
 */
export interface ActionPermissionError {
  readonly permissionError: string;
}

/**
 * Represents a user-safe error returned from a server action.
 * Use this for expected business-rule failures that should reach the client intact.
 */
export interface ActionMessageError {
  readonly actionError: string;
}

/**
 * Type guard: checks if a server action result is a permission error.
 */
export function isActionPermissionError(value: unknown): value is ActionPermissionError {
  const candidate = value as Record<string, unknown>;
  return (
    typeof value === 'object' &&
    value !== null &&
    'permissionError' in value &&
    typeof candidate.permissionError === 'string'
  );
}

/**
 * Type guard: checks if a server action result is a user-safe action error.
 */
export function isActionMessageError(value: unknown): value is ActionMessageError {
  const candidate = value as Record<string, unknown>;
  return (
    typeof value === 'object' &&
    value !== null &&
    'actionError' in value &&
    typeof candidate.actionError === 'string'
  );
}

/**
 * Creates a permission error return value for server actions.
 * Use instead of `throw new Error('Permission denied: ...')`.
 */
export function permissionError(message: string): ActionPermissionError {
  return { permissionError: message };
}

/**
 * Creates a user-safe error return value for server actions.
 */
export function actionError(message: string): ActionMessageError {
  return { actionError: message };
}

// --- Error detection utilities ---

/**
 * Check if an error is a permission-related error.
 * Handles Error instances, strings, and ActionPermissionError objects.
 */
export function isPermissionError(error: unknown): boolean {
  if (isActionPermissionError(error)) {
    return error.permissionError.includes('Permission denied');
  }
  if (typeof error === 'string') {
    return error.includes('Permission denied');
  }
  if (error instanceof Error) {
    return error.message.includes('Permission denied');
  }
  return false;
}

/**
 * Extract a user-friendly message from an error
 */
export function getErrorMessage(error: unknown): string {
  if (isActionPermissionError(error)) {
    return error.permissionError;
  }
  if (isActionMessageError(error)) {
    return error.actionError;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'An unexpected error occurred';
}

/**
 * Handle errors with appropriate UI feedback.
 * Shows permission errors with a ShieldAlert icon and other errors normally.
 */
export function handleError(error: unknown, fallbackMessage?: string): void {
  const message = getErrorMessage(error);

  if (isPermissionError(error)) {
    // Show permission errors with an Alert-style layout
    toast.custom((t) => (
      React.createElement('div', {
        className: `${t.visible ? 'animate-enter' : 'animate-leave'} max-w-md w-full bg-alert-destructive-bg shadow-lg rounded-lg pointer-events-auto flex items-start p-4 border border-destructive/30`,
      }, [
        React.createElement(ShieldAlert, {
          key: 'icon',
          className: 'h-4 w-4 text-red-500 mt-0.5 flex-shrink-0'
        }),
        React.createElement('div', {
          key: 'content',
          className: 'ml-3 flex-1',
        },
          React.createElement('p', {
            className: 'text-sm leading-relaxed text-destructive',
          }, message)
        )
      ])
    ), {
      duration: 5000,
    });
  } else {
    // Show other errors normally
    toast.error(fallbackMessage || message);
  }

  // Always log to console for debugging
  console.error(error);
}

/**
 * Wrap an async function to automatically handle errors
 */
export function withErrorHandling<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  fallbackMessage?: string
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (error) {
      handleError(error, fallbackMessage);
      throw error; // Re-throw to allow component-specific handling if needed
    }
  }) as T;
}

/**
 * React hook for error handling in components
 */
export function useErrorHandler() {
  return {
    handleError,
    isPermissionError,
    getErrorMessage,
    isActionPermissionError,
  };
}

/**
 * Format permission error messages consistently
 */
export function formatPermissionError(action: string, resource?: string): string {
  if (resource) {
    return `Permission denied: You don't have permission to ${action} ${resource}`;
  }
  return `Permission denied: You don't have permission to ${action}`;
}

/**
 * @deprecated Use `permissionError()` instead, which returns a value rather than throwing.
 * Thrown errors lose their messages during Next.js server action serialization.
 */
export function throwPermissionError(action: string, additionalInfo?: string): never {
  const baseMessage = `Permission denied: You don't have permission to ${action}`;
  const fullMessage = additionalInfo ? `${baseMessage}. ${additionalInfo}` : baseMessage;
  throw new Error(fullMessage);
}
