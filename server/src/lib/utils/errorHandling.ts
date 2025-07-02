import { toast } from 'react-hot-toast';
import { ShieldAlert } from 'lucide-react';
import React from 'react';

/**
 * Check if an error is a permission-related error
 */
export function isPermissionError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Permission denied');
}

/**
 * Extract a user-friendly message from an error
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'An unexpected error occurred';
}

/**
 * Handle errors with appropriate UI feedback
 * Shows permission errors with a warning icon and other errors normally
 */
export function handleError(error: unknown, fallbackMessage?: string): void {
  const message = getErrorMessage(error);
  
  if (isPermissionError(error)) {
    // Show permission errors with an Alert-style layout
    toast.custom((t) => (
      React.createElement('div', {
        className: `${t.visible ? 'animate-enter' : 'animate-leave'} max-w-md w-full bg-red-50 shadow-lg rounded-lg pointer-events-auto flex items-start p-4 border border-red-200`,
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
            className: 'text-sm leading-relaxed text-red-800',
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
 * Server-side utility to throw consistent permission errors
 */
export function throwPermissionError(action: string, additionalInfo?: string): never {
  const baseMessage = `Permission denied: You don't have permission to ${action}`;
  const fullMessage = additionalInfo ? `${baseMessage}. ${additionalInfo}` : baseMessage;
  throw new Error(fullMessage);
}