/**
 * Validation Utilities
 * Common validation functions for tenant access and data validation
 */

/**
 * Validate tenant access for a user
 */
export async function validateTenantAccess(
  tenantId: string,
  userId?: string
): Promise<void> {
  // TODO: Implement actual tenant access validation
  // This should check if the user has access to the specified tenant
  if (!tenantId) {
    throw new Error('Tenant ID is required');
  }
  
  // For now, just validate the format
  if (!isValidUUID(tenantId)) {
    throw new Error('Invalid tenant ID format');
  }
  
  console.warn(`Tenant access validation not fully implemented for tenant: ${tenantId}`);
}

/**
 * Check if a string is a valid UUID
 */
export function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

