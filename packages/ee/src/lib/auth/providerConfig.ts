export interface SsoProviderOption {
  id: 'google' | 'azure-ad';
  name: string;
  description: string;
  configured: boolean;
}

export async function getSsoProviderOptions(): Promise<SsoProviderOption[]> {
  return [
    {
      id: 'google',
      name: 'Google Workspace',
      description: 'Let users sign in with their Google-managed identity.',
      configured: false,
    },
    {
      id: 'azure-ad',
      name: 'Microsoft 365 (Azure AD)',
      description: 'Allow Azure Active Directory accounts to access Alga PSA.',
      configured: false,
    },
  ];
}
