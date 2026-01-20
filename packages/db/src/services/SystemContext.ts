/**
 * System Context for Server-Side Operations
 *
 * This module provides secure system contexts that can only be created
 * and used in server-side operations, preventing client-side abuse.
 */

import { AsyncLocalStorage } from 'async_hooks';
import { ServiceContext } from './BaseService';

// Async context storage for tracking system operations
const systemOperationContext = new AsyncLocalStorage<{ isSystemOperation: boolean }>();

// Brand for type safety
const SYSTEM_CONTEXT_BRAND = Symbol('SystemContext');

/**
 * System context that can only be created server-side
 */
export interface SystemServiceContext extends ServiceContext {
  [SYSTEM_CONTEXT_BRAND]: true;
  userId: '00000000-0000-0000-0000-000000000000';
}

/**
 * Regular user context (cannot have system UUID)
 */
export interface UserServiceContext extends ServiceContext {
  userId: string;
}

/**
 * Create a system context for automated operations
 * This can only be called from server-side code
 */
export function createSystemContext(tenant: string): SystemServiceContext {
  // Verify we're in a system operation context
  const context = systemOperationContext.getStore();
  if (!context?.isSystemOperation) {
    throw new Error('System context can only be created within runAsSystem()');
  }

  return {
    [SYSTEM_CONTEXT_BRAND]: true,
    userId: '00000000-0000-0000-0000-000000000000',
    tenant,
    user: null
  };
}

/**
 * Run a function as a system operation
 * This enables the creation of system contexts within the function
 */
export async function runAsSystem<T>(
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  console.log(`Running system operation: ${operation}`);
  return systemOperationContext.run({ isSystemOperation: true }, fn);
}

/**
 * Type guard to check if a context is a system context
 */
export function isSystemContext(context: ServiceContext): context is SystemServiceContext {
  return (context as SystemServiceContext)[SYSTEM_CONTEXT_BRAND] === true;
}

/**
 * Validate that a context with system UUID is properly authorized
 */
export function validateSystemContext(context: ServiceContext): void {
  if (context.userId === '00000000-0000-0000-0000-000000000000') {
    if (!isSystemContext(context)) {
      throw new Error('Invalid system context: Zero UUID used without proper system context');
    }

    const execContext = systemOperationContext.getStore();
    if (!execContext?.isSystemOperation) {
      throw new Error('System context used outside of runAsSystem()');
    }
  }
}
