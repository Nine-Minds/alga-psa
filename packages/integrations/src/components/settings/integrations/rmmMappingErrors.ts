type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

/**
 * The mapping actions answer with plain English strings, which the settings
 * UIs put straight on screen. These are the ones an operator can actually
 * provoke, said in their own language; anything else falls through unchanged
 * so a genuine API error is not swallowed.
 */
export function rmmMappingErrorMessage(
  t: TranslateFn,
  error: string | null | undefined,
  fallback: string
): string {
  if (!error) return fallback;

  switch (error) {
    case 'Invalid people mode':
      return t('integrations.rmm.errors.invalidPeopleMode', {
        defaultValue: 'That is not a valid people mode.',
      });
    case 'Selected billing profile is not available for this client':
      return t('integrations.rmm.errors.billingProfileUnavailable', {
        defaultValue: 'That billing profile is not available for this client.',
      });
    case 'Mapping not found':
      return t('integrations.rmm.errors.mappingNotFound', {
        defaultValue: 'That mapping no longer exists. Refresh and try again.',
      });
    case 'Client not found':
      return t('integrations.rmm.errors.clientNotFound', {
        defaultValue: 'That client no longer exists. Refresh and try again.',
      });
    case 'Contact does not belong to this client':
      return t('integrations.rmm.errors.contactNotForClient', {
        defaultValue: 'That contact does not belong to the client this site is mapped to.',
      });
    case 'Forbidden':
      return t('integrations.rmm.errors.forbidden', {
        defaultValue: 'You do not have permission to change this.',
      });
    default:
      return error;
  }
}
