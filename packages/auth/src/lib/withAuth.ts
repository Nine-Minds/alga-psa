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
import { runWithTenant } from '@alga-psa/db';
import { getCurrentUser } from './getCurrentUser';

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
 *   return await knex('my_table').where({ tenant: ctx.tenant }).first();
 * });
 *
 * // With arguments
 * export const updateItem = withAuth(async (user, ctx, itemId: string, data: ItemData) => {
 *   const { knex } = await createTenantKnex();
 *   return await knex('items').where({ item_id: itemId, tenant: ctx.tenant }).update(data);
 * });
 * ```
 */
export function withAuth<TArgs extends unknown[], TResult>(
  action: (user: IUserWithRoles, ctx: AuthContext, ...args: TArgs) => Promise<TResult>,
  options?: WithAuthOptions
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    const user = await getCurrentUser();

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

    // Use runWithTenant to set AsyncLocalStorage context
    // This ensures createTenantKnex() works without explicit tenant argument
    return runWithTenant(user.tenant, () => action(user, ctx, ...args));
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
 *   return await knex('my_table').where({ tenant: ctx.tenant }).first();
 * });
 * ```
 */
export function withOptionalAuth<TArgs extends unknown[], TResult>(
  action: (user: IUserWithRoles | null, ctx: AuthContext | null, ...args: TArgs) => Promise<TResult>
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    const user = await getCurrentUser();

    if (!user) {
      return action(null, null, ...args);
    }

    const ctx: AuthContext = {
      tenant: user.tenant,
    };

    return runWithTenant(user.tenant, () => action(user, ctx, ...args));
  };
}

/**
 * Wraps a server action with authentication check only (no tenant context).
 * Use this for actions that don't need database access but need authentication.
 *
 * @example
 * ```typescript
 * export const getUserInfo = withAuthCheck(async (user) => {
 *   return { name: user.first_name, email: user.email };
 * });
 * ```
 */
export function withAuthCheck<TArgs extends unknown[], TResult>(
  action: (user: IUserWithRoles, ...args: TArgs) => Promise<TResult>
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    const user = await getCurrentUser();

    if (!user) {
      throw new AuthenticationError();
    }

    return action(user, ...args);
  };
}
