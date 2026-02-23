import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';

/**
 * Core implementation for generating image URLs from file IDs.
 * Handles different storage providers (local vs. S3).
 * This is an internal helper that uses the tenant from AsyncLocalStorage context.
 *
 * @param file_id The ID of the file in external_files
 * @param useTransaction Whether to use database transaction (default: true)
 * @returns A promise resolving to the image URL string, or null if an error occurs or the file is not found/an image
 */
async function getImageUrlCore(file_id: string, useTransaction: boolean = true): Promise<string | null> {
  try {
    const { knex, tenant } = await createTenantKnex();

    if (!tenant) {
      console.error('getImageUrlCore: No tenant found');
      return null;
    }

    // Fetch minimal file details to check MIME type and existence
    const fileDetails = useTransaction
      ? await withTransaction(knex, async (trx: Knex.Transaction) => {
          return await trx('external_files')
            .select('mime_type', 'storage_path')
            .where({ file_id, tenant })
            .first();
        })
      : await knex('external_files')
          .select('mime_type', 'storage_path')
          .where({ file_id, tenant })
          .first();

    if (!fileDetails) {
      console.warn(`getImageUrlCore: File not found for file_id: ${file_id}`);
      return null;
    }

    // Check if the file is an image
    if (!fileDetails.mime_type?.startsWith('image/')) {
      console.warn(`getImageUrlCore: File ${file_id} is not an image (mime_type: ${fileDetails.mime_type})`);
      return null;
    }

    // Always use the API endpoint approach for consistency
    // This works for both local and S3/MinIO storage providers
    // The /api/documents/view endpoint handles fetching from the actual storage
    return `/api/documents/view/${file_id}`;
  } catch (error) {
    console.error(`getImageUrlCore: Error generating URL for file_id ${file_id}:`, error);
    return null;
  }
}

/**
 * Generates a URL for accessing an image file by its ID without authentication checks.
 * This is the INTERNAL API that bypasses user authentication and permission validation.
 *
 * Use this function when:
 * - System-level operations that don't require user context
 * - Internal service calls where authentication is handled elsewhere
 * - Background processes and workflows
 * - Avatar utilities and other trusted internal operations
 *
 * SECURITY WARNING: This function bypasses all user authentication and permission checks.
 * Only use in trusted contexts where access control is handled at a higher level.
 *
 * @param file_id The ID of the file in external_files
 * @param tenant Optional tenant - if provided, skips getCurrentUser call (avoids circular dependency)
 * @returns A promise resolving to the image URL string, or null if an error occurs or the file is not found/an image
 */
export async function getImageUrlInternal(file_id: string, tenant?: string): Promise<string | null> {
  // For internal use, we can use runWithTenant if tenant is provided
  return await getImageUrlCore(file_id, false);
}
