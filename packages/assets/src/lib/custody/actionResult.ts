import { ZodError } from 'zod';
import { isCustodyError, type CustodyErrorCode } from './errors';

/** What custody server actions return. Refusals are values (Next masks thrown messages in production). */
export type CustodyActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: CustodyErrorCode | 'validation'; message: string; issues?: Array<{ path: Array<string | number>; message: string }> } };

export async function toCustodyResult<T>(run: () => Promise<T>): Promise<CustodyActionResult<T>> {
  try {
    return { success: true, data: await run() };
  } catch (error) {
    if (isCustodyError(error)) {
      return { success: false, error: { code: error.code, message: error.message } };
    }
    if (error instanceof ZodError) {
      return {
        success: false,
        error: {
          code: 'validation',
          message: error.issues[0]?.message ?? 'Invalid input',
          issues: error.issues.map((i) => ({ path: i.path, message: i.message })),
        },
      };
    }
    throw error;
  }
}
