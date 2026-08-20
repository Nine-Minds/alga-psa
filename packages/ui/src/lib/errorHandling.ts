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

/** Interpolation values for a localized action-error message. */
export type ActionMessageParams = Record<string, string | number>;

/**
 * Represents a permission error returned from a server action.
 * Next.js strips thrown error messages during serialization, so permission
 * errors must be returned as plain objects to reach the client intact.
 *
 * `messageKey` is the localization seam: the `withAuth` boundary rewrites the
 * English string to the caller's locale before the payload reaches the client,
 * and keeps the key on the payload so the rewrite is idempotent and log lines
 * still have something stable to read.
 */
export type ActionPermissionErrorShape = {
  readonly permissionError: string;
  readonly messageKey?: string;
  readonly messageParams?: ActionMessageParams;
};

export type ActionPermissionError = never;

/**
 * Represents a user-safe error returned from a server action.
 * Use this for expected business-rule failures that should reach the client intact.
 */
export type ActionMessageErrorShape = {
  readonly actionError: string;
  readonly messageKey?: string;
  readonly messageParams?: ActionMessageParams;
};

export type ActionMessageError = never;

/**
 * What the type guards narrow to. Deliberately the *minimal* shapes: widening them
 * with the optional localization fields breaks negative narrowing for the ~30 modules
 * that declare their own `{ readonly actionError: string }` union member, and does so
 * as a type error rather than at runtime.
 */
type ActionPermissionErrorMatch = { readonly permissionError: string };
type ActionMessageErrorMatch = { readonly actionError: string };

/**
 * Type guard: checks if a server action result is a permission error.
 */
export function isActionPermissionError(value: unknown): value is ActionPermissionErrorMatch {
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
export function isActionMessageError(value: unknown): value is ActionMessageErrorMatch {
  const candidate = value as Record<string, unknown>;
  return (
    typeof value === 'object' &&
    value !== null &&
    'actionError' in value &&
    typeof candidate.actionError === 'string'
  );
}

/** The localization key an action attached to its error, if any. */
export function getActionErrorMessageKey(value: unknown): string | undefined {
  const candidate = value as { messageKey?: unknown };
  return typeof candidate?.messageKey === 'string' ? candidate.messageKey : undefined;
}

/** The interpolation values an action attached to its error, if any. */
export function getActionErrorMessageParams(value: unknown): ActionMessageParams | undefined {
  const candidate = value as { messageParams?: unknown };
  return candidate?.messageParams && typeof candidate.messageParams === 'object'
    ? (candidate.messageParams as ActionMessageParams)
    : undefined;
}

/**
 * Creates a permission error return value for server actions.
 * Use instead of `throw new Error('Permission denied: ...')`.
 *
 * Pass a namespaced `key` (e.g. `'msp/clients:errors.notAllowed'`) to have the
 * boundary localize the message. Stays synchronous either way.
 */
export function permissionError(
  message: string,
  key?: string,
  params?: ActionMessageParams,
): ActionPermissionError {
  return { permissionError: message, ...(key ? { messageKey: key } : {}), ...(params ? { messageParams: params } : {}) } as ActionPermissionError;
}

/**
 * Creates a user-safe error return value for server actions.
 *
 * Pass a namespaced `key` (e.g. `'msp/clients:errors.duplicateName'`) to have the
 * boundary localize the message. Stays synchronous either way.
 */
export function actionError(
  message: string,
  key?: string,
  params?: ActionMessageParams,
): ActionMessageError {
  return { actionError: message, ...(key ? { messageKey: key } : {}), ...(params ? { messageParams: params } : {}) } as ActionMessageError;
}

/**
 * The structural subset of a Zod issue needed at an action boundary.
 *
 * Keeping this structural avoids making the UI package depend on Zod. Custom
 * schema issues carry their catalogue entry in `params`; built-in issues are
 * classified by their stable issue code instead of their English prose.
 */
export type ActionValidationIssue = {
  readonly code?: unknown;
  readonly path?: ReadonlyArray<string | number>;
  readonly message?: unknown;
  readonly received?: unknown;
  readonly params?: {
    readonly messageKey?: unknown;
    readonly messageParams?: unknown;
  };
};

function validationIssueField(issue: ActionValidationIssue): string {
  const path = issue.path?.map(String).filter(Boolean).join('.');
  return path || 'input';
}

/**
 * Converts one validation issue into a localizable action error.
 *
 * Custom Zod issues should attach `params.messageKey` and optional
 * `params.messageParams`. Built-in issues cannot carry params in Zod 3, so this
 * maps their stable code to app-wide validation copy. Unknown/custom keyless
 * issues deliberately degrade to a generic localized message rather than
 * sending their English `message` through the boundary.
 */
export function actionErrorFromValidationIssue(issue: ActionValidationIssue): ActionMessageError {
  const field = validationIssueField(issue);
  const customKey = issue.params?.messageKey;
  const customParams = issue.params?.messageParams;

  if (typeof customKey === 'string') {
    return actionError(
      typeof issue.message === 'string' ? issue.message : `${field} has an invalid value.`,
      customKey,
      customParams && typeof customParams === 'object'
        ? customParams as ActionMessageParams
        : undefined,
    );
  }

  if (issue.code === 'invalid_type' && issue.received === 'undefined') {
    return actionError(`${field} is required.`, 'common:errors.validation.required', { field });
  }
  if (issue.code === 'invalid_type') {
    return actionError(`${field} has the wrong type.`, 'common:errors.validation.invalidType', { field });
  }
  if (issue.code === 'invalid_string') {
    return actionError(`${field} has an invalid format.`, 'common:errors.validation.invalidFormat', { field });
  }
  if (issue.code === 'too_small') {
    return actionError(
      `${field} is below the minimum allowed value or length.`,
      'common:errors.validation.tooSmall',
      { field },
    );
  }
  if (issue.code === 'too_big') {
    return actionError(
      `${field} exceeds the maximum allowed value or length.`,
      'common:errors.validation.tooLarge',
      { field },
    );
  }
  if (issue.code === 'invalid_enum_value' || issue.code === 'invalid_literal') {
    return actionError(
      `${field} has an unsupported value.`,
      'common:errors.validation.unsupportedValue',
      { field },
    );
  }

  return actionError(`${field} has an invalid value.`, 'common:errors.validation.invalidValue', { field });
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
 * Thrown errors are recognized only through the explicit `CodedError` channel;
 * bare strings are never treated as discriminators.
 */
export function isPermissionError(error: unknown): boolean {
  if (isActionPermissionError(error)) {
    return true;
  }
  return errorCodeOf(error) === 'PERMISSION_DENIED';
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
  throw new CodedError(fullMessage, 'PERMISSION_DENIED');
}
