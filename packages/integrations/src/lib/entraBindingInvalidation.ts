/**
 * A Direct Entra refresh token is issued to a particular application. It cannot
 * safely survive rebinding the `entra` consumer to another Microsoft app
 * registration, so a profile change tears down the stored direct token set and
 * drives the active direct connection to "reconnect required". A no-op re-save
 * of the same profile changes nothing.
 *
 * The connection repository and token store are EE modules reached through the
 * `@enterprise` alias; CE resolves them to no-op stubs (and never surfaces the
 * `entra` consumer in the first place).
 */
export async function invalidateEntraDirectConnectionOnRebind(params: {
  tenant: string;
  previousProfileId: string | null;
  nextProfileId: string;
}): Promise<void> {
  if (params.previousProfileId === params.nextProfileId) {
    return;
  }

  const { getActiveEntraPartnerConnection, updateEntraConnectionValidation } = await import(
    '@enterprise/lib/integrations/entra/connectionRepository'
  );
  const connection = await getActiveEntraPartnerConnection(params.tenant);
  if (connection?.connection_type !== 'direct') {
    return;
  }

  const { clearEntraDirectTokenSet } = await import('@enterprise/lib/integrations/entra/auth/tokenStore');
  await clearEntraDirectTokenSet(params.tenant);
  await updateEntraConnectionValidation({
    tenant: params.tenant,
    connectionType: 'direct',
    status: 'validation_failed',
    snapshot: {
      code: 'profile_rebound',
      message: 'The Microsoft app registration changed. Reconnect Entra to grant consent to the new app.',
      checkedAt: new Date().toISOString(),
    },
  });
}
