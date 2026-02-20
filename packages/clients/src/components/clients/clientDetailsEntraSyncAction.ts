export const shouldShowEntraSyncAction = (
  edition: string | undefined,
  isClientSyncFlagEnabled: boolean,
  client?: { entra_tenant_id?: string | null } | null
): boolean => {
  const mappedTenantId = String(client?.entra_tenant_id || '').trim();
  return edition === 'enterprise' && isClientSyncFlagEnabled && mappedTenantId.length > 0;
};
