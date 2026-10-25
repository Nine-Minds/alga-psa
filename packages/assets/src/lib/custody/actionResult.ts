import { ZodError } from 'zod';
import {
  getActionErrorMessageKey,
  getActionErrorMessageParams,
  isActionMessageError,
  type ActionMessageParams,
} from '@alga-psa/ui/lib/errorHandling';
import { assetActionErrorFrom } from '../../actions/assetActionErrors';
import { isCustodyError, type CustodyErrorCode } from './errors';

/** What custody server actions return. Refusals are values (Next masks thrown messages in production). */
export type CustodyActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: CustodyErrorCode | 'validation'; message: string; messageKey?: string; messageParams?: ActionMessageParams; issues?: Array<{ path: Array<string | number>; message: string }> } };

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
    // Asset-layer failures (e.g. an invalid asset type thrown as structured JSON) already have a localizable
    // mapping; reuse it so the caller gets a message plus i18n key instead of a rethrown raw payload.
    const mapped = assetActionErrorFrom(error);
    if (mapped && isActionMessageError(mapped)) {
      const messageKey = getActionErrorMessageKey(mapped);
      const messageParams = getActionErrorMessageParams(mapped);
      return {
        success: false,
        error: {
          code: 'validation',
          message: (mapped as { actionError: string }).actionError,
          ...(messageKey ? { messageKey } : {}),
          ...(messageParams ? { messageParams } : {}),
        },
      };
    }
    throw error;
  }
}
