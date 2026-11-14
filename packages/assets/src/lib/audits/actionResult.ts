import { ZodError } from 'zod';
import { isAssetAuditError, type AssetAuditErrorCode } from './errors';

/**
 * What the audit server actions return. Refusals are values, not throws: Next
 * masks a thrown message in production, and these messages ("Audit is
 * completed", "Asset not found") are exactly what the surface should show.
 */
export type AssetAuditActionResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: {
        code: AssetAuditErrorCode | 'validation';
        message: string;
        issues?: Array<{ path: Array<string | number>; message: string }>;
      };
    };

export async function toAuditResult<T>(run: () => Promise<T>): Promise<AssetAuditActionResult<T>> {
  try {
    return { success: true, data: await run() };
  } catch (error) {
    if (isAssetAuditError(error)) {
      return { success: false, error: { code: error.code, message: error.message } };
    }
    if (error instanceof ZodError) {
      return {
        success: false,
        error: {
          code: 'validation',
          message: error.issues[0]?.message ?? 'Invalid input',
          issues: error.issues.map((issue) => ({ path: issue.path.map(String), message: issue.message })),
        },
      };
    }
    throw error;
  }
}
