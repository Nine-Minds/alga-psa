import { toast } from 'react-hot-toast';
import { ShieldAlert } from 'lucide-react';
import React from 'react';

// --- Permission error return type for server actions ---

/**
 * Marker prefix on *thrown* permission errors. Internal, never shown translated —
 * returned payloads are classified by shape instead (see `isPermissionError`).
 */
export const PERMISSION_DENIED_PREFIX = 'Permission denied';

/** Message thrown by actions that ran without a session. Internal, not user copy. */
export const NOT_AUTHENTICATED_MESSAGE = 'user is not logged in';

/**
 * A thrown error that says *why* it failed without making the sentence load-bearing.
 * Prefer this over `throw new Error('Permission denied: …')` at new throw sites: the
 * mappers that turn a caught error into an `actionError` can then branch on `code`.
 */
export class CodedError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly messageKey?: string,
    readonly messageParams?: Record<string, string | number>,
  ) {
    super(message);
    this.name = 'CodedError';
  }
}

/** The `code` of a thrown {@link CodedError}, if the error carries one. */
export function errorCodeOf(error: unknown): string | undefined {
  return error instanceof CodedError ? error.code : undefined;
}

/**
 * Whether a *thrown* error denotes a permission or authentication failure.
 *
 * Checks the code first; the English prefixes remain as the fallback for the throw
 * sites that have not been converted yet. They are safe there because a thrown
 * message never crosses the localization boundary — only returned payloads do.
 */
export function isAuthorizationThrow(error: unknown): boolean {
  const code = errorCodeOf(error);
  if (code === 'PERMISSION_DENIED' || code === 'NOT_AUTHENTICATED') {
    return true;
  }
  if (error instanceof Error) {
    return error.message.includes(PERMISSION_DENIED_PREFIX) || error.message === NOT_AUTHENTICATED_MESSAGE;
  }
  return false;
}

/**
 * Represents a permission error returned from a server action.
 * Next.js strips thrown error messages during serialization, so permission
 * errors must be returned as plain objects to reach the client intact.
 */
export type ActionPermissionErrorShape = {
  readonly permissionError: string;
};

export type ActionPermissionError = never;

/**
 * Represents a user-safe error returned from a server action.
 * Use this for expected business-rule failures that should reach the client intact.
 */
export type ActionMessageErrorShape = {
  readonly actionError: string;
};

export type ActionMessageError = never;

/**
 * Type guard: checks if a server action result is a permission error.
 */
export function isActionPermissionError(value: unknown): value is ActionPermissionErrorShape {
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
export function isActionMessageError(value: unknown): value is ActionMessageErrorShape {
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
  return { permissionError: message } as ActionPermissionError;
}

/**
 * Creates a user-safe error return value for server actions.
 */
export function actionError(message: string): ActionMessageError {
  return { actionError: message } as ActionMessageError;
}

// --- Error detection utilities ---

/**
 * Check if an error is a permission-related error.
 *
 * A returned payload is classified by its *shape*: anything carrying
 * `permissionError` is one, whatever the string says. Matching the prose here was
 * a latent break — the message is localized before it reaches the client, so
 * `.includes('Permission denied')` stopped being true the moment a user switched
 * to German, and it failed silently.
 *
 * Thrown `Error`s and bare strings have no shape to read, so the English prefix
 * stays as their only signal. Those messages are internal and are not translated.
 */
export function isPermissionError(error: unknown): boolean {
  if (isActionPermissionError(error)) {
    return true;
  }
  if (typeof error === 'string') {
    return error.includes(PERMISSION_DENIED_PREFIX);
  }
  if (error instanceof Error) {
    return error.message.includes(PERMISSION_DENIED_PREFIX);
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
