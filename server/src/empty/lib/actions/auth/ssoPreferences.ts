export interface SsoPreferences {
  autoLinkInternal: boolean;
  autoLinkClient: boolean;
}

export async function getSsoPreferencesAction(): Promise<SsoPreferences> {
  return {
    autoLinkInternal: false,
    autoLinkClient: false,
  };
}

export async function updateSsoPreferencesAction(
  _updates: Partial<SsoPreferences>
): Promise<SsoPreferences> {
  return {
    autoLinkInternal: false,
    autoLinkClient: false,
  };
}
