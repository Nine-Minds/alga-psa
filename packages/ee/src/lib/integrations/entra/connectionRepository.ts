export type EntraConnectionType = 'direct' | 'cipp';

export interface EntraConnectionValidationSnapshot {
  message: string;
  code?: string;
  checkedAt: string;
  details?: Record<string, unknown>;
}

export interface EntraPartnerConnectionRow {
  tenant: string;
  connection_id: string;
  connection_type: EntraConnectionType;
  status: string;
  is_active: boolean;
}

/**
 * CE stub. The Entra integration is Enterprise-only, so no connection ever
 * exists here; callers reached through the `@enterprise` alias must treat the
 * absent connection as a no-op.
 */
export async function getActiveEntraPartnerConnection(
  _tenant: string
): Promise<EntraPartnerConnectionRow | null> {
  return null;
}

export async function updateEntraConnectionValidation(
  _params: {
    tenant: string;
    connectionType: EntraConnectionType;
    status: string;
    snapshot?: EntraConnectionValidationSnapshot | null;
  }
): Promise<void> {
  // No Entra connections exist in Community Edition.
}
