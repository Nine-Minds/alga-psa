/**
 * @alga-psa/auth - Server Action Authentication Wrapper
 *
 * Provides a higher-order function that wraps server actions with
 * authentication and tenant context setup.
 *
 * This is the recommended pattern for server actions that need database access:
 *
 * ```typescript
 * export const myAction = withAuth(async (user, ctx) => {
 *   // ctx.tenant is already set in AsyncLocalStorage
 *   const { knex } = await createTenantKnex(); // Just works - no explicit tenant needed
 *   return await myBusinessLogic(knex);
 * });
 * ```
 *
 * Benefits:
 * - Sets tenant context once at the boundary, not in every action
 * - Handles authentication checks consistently
 * - Uses runWithTenant() for reliable context propagation (works with turbopack)
 * - Provides typed access to the authenticated user
 */

import type { IUserWithRoles } from '@alga-psa/types';
import { getAdminConnection, runWithTenant } from '@alga-psa/db';
import {
  coManagedAcceptancePendingError,
  isCoManagedAwaitingAcceptanceLazily,
} from '@alga-psa/licensing/lifecycle';
import { getCurrentUserWithRevocationCheck } from './getCurrentUser';
import { actionError } from '@alga-psa/ui/lib/errorHandling';
import { coManagedRefusalMessageKey, isCoManagedLifecycleError } from '@alga-psa/licensing/lifecycle-error';
import { localizeActionError } from './localizeActionError';

/**
 * A co-managed lifecycle refusal (write admission) is an expected outcome, not a
 * fault. Next.js strips thrown messages at the serialization boundary, so it is
 * RETURNED as an action error, from inside runWithTenant so localizeActionError
 * can translate its messageKey. Anything else is rethrown untouched.
 */
async function runLocalized<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await localizeActionError(await run());
  } catch (error) {
    if (isCoManagedLifecycleError(error)) {
      return (await localizeActionError(actionError(error.message, coManagedRefusalMessageKey(error)))) as unknown as T;
    }
    throw error;
  }
}

/**
 * Context provided to authenticated actions
 */
export interface AuthContext {
  /** The tenant ID from the authenticated user's session */
  tenant: string;
}

/**
 * Error thrown when authentication fails
 */
export class AuthenticationError extends Error {
  constructor(message: string = 'User not authenticated') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

/**
 * Options for the withAuth wrapper
 */
export interface WithAuthOptions {
  /**
   * If true, returns null instead of throwing when user is not authenticated.
   * Useful for actions that have different behavior for authenticated vs anonymous users.
   */
  allowUnauthenticated?: boolean;
  /**
   * The action is part of reviewing and accepting a co-managed relationship
   * (or a personal preference the review screen reads), so it runs while the
   * workspace awaits acceptance. Every other browser-invoked action is refused
   * until then.
   */
  allowBeforeCoManagedAcceptance?: boolean;
}

/**
 * A browser-invoked server action or an API request, as opposed to a direct
 * call while a page renders. The middleware stamps x-pathname on every request
 * it forwards, overwriting any client value.
 */
async function isActionOrApiRequest(): Promise<boolean> {
  try {
    const { headers } = await import('next/headers.js');
    const requestHeaders = await headers();
    const contentType = requestHeaders.get('content-type') ?? '';
    const isMultipartSubmission = /^multipart\/form-data(?:\s*;|$)/i.test(contentType);
    return (
      Boolean(requestHeaders.get('next-action')) ||
      isMultipartSubmission ||
      (requestHeaders.get('x-pathname') ?? '').startsWith('/api/')
    );
  } catch {
    return false;
  }
}

/**
 * Until the customer accepts, a co-managed workspace is the MSP's proposal:
 * only the review and acceptance screen may be used. The screen and layout
 * render server-side, so direct calls while rendering are unaffected; any
 * other action invoked from the browser or through the API is refused.
 *
 * Steady state costs no statement for any tenant: the answer is a per-process
 * cache, and the admin connection (whose acquisition runs a probe query) is
 * requested lazily, only on a cache miss.
 */
async function assertCoManagedWorkspaceUsable(tenant: string, options?: WithAuthOptions): Promise<void> {
  if (options?.allowBeforeCoManagedAcceptance || !(await isActionOrApiRequest())) return;
  if (await isCoManagedAwaitingAcceptanceLazily(() => getAdminConnection(), tenant)) {
    throw coManagedAcceptancePendingError();
  }
}

/**
 * Wraps a server action with authentication and tenant context.
 *
 * The wrapped action:
 * 1. Gets the current user from the session
 * 2. Sets up tenant context via AsyncLocalStorage using runWithTenant()
 * 3. Calls the original action with the user and context
 *
 * @example
 * ```typescript
 * // Basic usage - throws if not authenticated
 * export const getMyData = withAuth(async (user, ctx) => {
 *   const { knex } = await createTenantKnex();
 *   return await tenantDb(knex, ctx.tenant).table('my_table').first();
 * });
 *
 * // With arguments
 * export const updateItem = withAuth(async (user, ctx, itemId: string, data: ItemData) => {
 *   const { knex } = await createTenantKnex();
 *   return await tenantDb(knex, ctx.tenant).table('items')
 *     .where({ item_id: itemId })
 *     .update(data);
 * });
 * ```
 */
export function withAuth<TArgs extends unknown[], TResult>(
  action: (user: IUserWithRoles, ctx: AuthContext, ...args: TArgs) => Promise<TResult>,
  options?: WithAuthOptions
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    const user = await getCurrentUserWithRevocationCheck();

    if (!user) {
      if (options?.allowUnauthenticated) {
        // For allowUnauthenticated, we can't run with tenant context
        // The action must handle this case
        throw new AuthenticationError('withAuth with allowUnauthenticated requires a user');
      }
      throw new AuthenticationError();
    }

    const ctx: AuthContext = {
      tenant: user.tenant,
    };

    await assertCoManagedWorkspaceUsable(user.tenant, options);

    // Use runWithTenant to set AsyncLocalStorage context
    // This ensures createTenantKnex() works without explicit tenant argument.
    // localizeActionError runs inside it because resolving the caller's locale
    // reads tenant_settings; it is a no-op unless the payload carries a messageKey.
    return runWithTenant(user.tenant, () => runLocalized(() => action(user, ctx, ...args)));
  };
}

/**
 * Variant of withAuth that allows unauthenticated access.
 * Returns null for user and ctx if not authenticated.
 *
 * @example
 * ```typescript
 * export const getPublicOrPrivateData = withOptionalAuth(async (user, ctx) => {
 *   if (!user) {
 *     return { publicData: 'only' };
 *   }
 *   const { knex } = await createTenantKnex();
 *   return await tenantDb(knex, ctx.tenant).table('my_table').first();
 * });
 * ```
 */
export function withOptionalAuth<TArgs extends unknown[], TResult>(
  action: (user: IUserWithRoles | null, ctx: AuthContext | null, ...args: TArgs) => Promise<TResult>,
  options?: WithAuthOptions
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    const user = await getCurrentUserWithRevocationCheck();

    if (!user) {
      // No tenant to run inside; locale resolution falls back to the cookie,
      // Accept-Language, then the default.
      return localizeActionError(await action(null, null, ...args));
    }

    const ctx: AuthContext = {
      tenant: user.tenant,
    };

    await assertCoManagedWorkspaceUsable(user.tenant, options);

    return runWithTenant(user.tenant, () => runLocalized(() => action(user, ctx, ...args)));
  };
}

/**
 * Wraps a server action with authentication check only (no tenant context).
 * Use this for actions that don't need database access but need authentication.
 *
 * Deliberately not localized: neither caller returns an action-error payload, and
 * without tenant context there is no `tenant_settings` to resolve a locale from.
 *
 * @example
 * ```typescript
 * export const getUserInfo = withAuthCheck(async (user) => {
 *   return { name: user.first_name, email: user.email };
 * });
 * ```
 */
export function withAuthCheck<TArgs extends unknown[], TResult>(
  action: (user: IUserWithRoles, ...args: TArgs) => Promise<TResult>,
  options?: WithAuthOptions
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    const user = await getCurrentUserWithRevocationCheck();

    if (!user) {
      throw new AuthenticationError();
    }

    await assertCoManagedWorkspaceUsable(user.tenant, options);

    return action(user, ...args);
  };
}
