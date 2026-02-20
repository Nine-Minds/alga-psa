export const shouldShowEntraSyncAction = (
  edition: string | undefined,
  isClientSyncFlagEnabled: boolean
): boolean => {
  return edition === 'enterprise' && isClientSyncFlagEnabled;
};
