import { expect } from 'vitest';

/**
 * Options for error assertion
 */
export interface ErrorAssertionOptions {
  /**
   * Expected error message
   * If provided, will check exact message match
   */
  message?: string;

  /**
   * Expected error message pattern
   * If provided, will check if message matches regex
   */
  messagePattern?: RegExp;

  /**
   * Expected error name/type
   * @default 'Error'
   */
  name?: string;

  /**
   * Whether to check error properties
   */
  properties?: Record<string, unknown>;
}

/**
 * Asserts that a function throws an error
 * @param fn Function that should throw
 * @param options Error assertion options
 */
export async function expectError(
  fn: () => unknown | Promise<unknown>,
  options: ErrorAssertionOptions = {}
): Promise<void> {
  const {
    message,
    messagePattern,
    name = 'Error',
    properties
  } = options;

  try {
    await fn();
    throw new Error('Expected function to throw an error');
  } catch (err) {
    if (!(err instanceof Error)) {
      throw new Error(`Expected error to be instance of Error, got ${typeof err}`);
    }

    const error = err as Error;

    // Check error type
    expect(error).toBeInstanceOf(Error);
    expect(error.constructor.name).toBe(name);

    // Check error message
    if (message) {
      expect(error.message).toBe(message);
    }
    if (messagePattern) {
      expect(error.message).toMatch(messagePattern);
    }

    // Check error properties
    if (properties) {
      Object.entries(properties).forEach(([key, value]) => {
        expect(error).toHaveProperty(key, value);
      });
    }
  }
}

/**
 * Creates error assertion helpers for specific error types
 * @param errorType Error class to test for
 * @returns Object with error assertion helpers
 */
export function createErrorAssertions<T extends Error>(errorType: new (...args: any[]) => T) {
  return {
    /**
     * Asserts that a function throws the specific error type
     */
    expectError: async (
      fn: () => unknown | Promise<unknown>,
      options: Omit<ErrorAssertionOptions, 'name'> = {}
    ) => {
      await expectError(fn, {
        ...options,
        name: errorType.name
      });
    },

    /**
     * Creates an assertion for a specific error message
     */
    expectErrorMessage: (message: string) => 
      async (fn: () => unknown | Promise<unknown>) => {
        await expectError(fn, {
          message,
          name: errorType.name
        });
      },

    /**
     * Creates an assertion for a specific error pattern
     */
    expectErrorPattern: (pattern: RegExp) =>
      async (fn: () => unknown | Promise<unknown>) => {
        await expectError(fn, {
          messagePattern: pattern,
          name: errorType.name
        });
      }
  };
}

/**
 * Common error patterns for validation
 */
export const ValidationPatterns = {
  Required: (field: string) => new RegExp(`${field}.*required`, 'i'),
  Invalid: (field: string) => new RegExp(`${field}.*invalid`, 'i'),
  NotFound: (entity: string) => new RegExp(`${entity}.*not found`, 'i'),
  Duplicate: (field: string) => new RegExp(`${field}.*already exists`, 'i'),
  Permission: () => /permission denied|unauthorized|forbidden/i,
};

/**
 * Creates test cases for common validation errors
 * @param execute Function that executes the operation
 * @param field Field being validated
 * @returns Object with test case functions
 */
export function createValidationTests(
  execute: (value: any) => Promise<unknown>,
  field: string
) {
  return {
    /**
     * Tests that the field is required
     */
    testRequired: async () => {
      await expectError(
        () => execute(null),
        {
          messagePattern: ValidationPatterns.Required(field)
        }
      );
    },

    /**
     * Tests that the field must be valid
     * @param invalidValue Invalid value to test
     */
    testInvalid: async (invalidValue: any) => {
      await expectError(
        () => execute(invalidValue),
        {
          messagePattern: ValidationPatterns.Invalid(field)
        }
      );
    },

    /**
     * Tests that the field must be unique
     * @param duplicateValue Value that already exists
     */
    testUnique: async (duplicateValue: any) => {
      await expectError(
        () => execute(duplicateValue),
        {
          messagePattern: ValidationPatterns.Duplicate(field)
        }
      );
    }
  };
}

/**
 * Helper to test permission-related errors
 * @param execute Function that should be denied
 */
export async function expectPermissionDenied(
  execute: () => Promise<unknown>
): Promise<void> {
  await expectError(
    execute,
    {
      messagePattern: ValidationPatterns.Permission()
    }
  );
}

/**
 * Helper to test entity not found errors
 * @param execute Function that should fail to find entity
 * @param entityType Type of entity (e.g., 'User', 'Project')
 */
export async function expectNotFound(
  execute: () => Promise<unknown>,
  entityType: string
): Promise<void> {
  await expectError(
    execute,
    {
      messagePattern: ValidationPatterns.NotFound(entityType)
    }
  );
}