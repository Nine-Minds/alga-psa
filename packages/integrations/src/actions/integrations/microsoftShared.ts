export const MICROSOFT_PROFILE_CONSUMERS = ['msp_sso', 'email', 'calendar', 'teams', 'entra'] as const;

export type MicrosoftProfileConsumer = typeof MICROSOFT_PROFILE_CONSUMERS[number];

export const DEFAULT_MICROSOFT_PROFILE_CAPABILITIES: MicrosoftProfileConsumer[] = [
  'msp_sso', 'email', 'calendar', 'teams',
];

/**
 * Display copy of the Entra direct delegated scopes surfaced by the CE-resident
 * Microsoft metadata builder. The authoritative list is
 * ENTRA_DIRECT_DELEGATED_SCOPES in the EE tree
 * (ee/server/src/lib/integrations/entra/auth/directScopes.ts); this module must
 * not import across that boundary, so a contract test asserts the two lists
 * stay identical.
 */
export const ENTRA_DIRECT_DISPLAY_SCOPES = [
  'https://graph.microsoft.com/User.Read',
  'https://graph.microsoft.com/ManagedTenants.Read.All',
  'https://graph.microsoft.com/Directory.Read.All',
  'offline_access',
] as const;

export function isSupportedMicrosoftProfileConsumer(value: string): value is MicrosoftProfileConsumer {
  return (MICROSOFT_PROFILE_CONSUMERS as readonly string[]).includes(value);
}

export function normalizeMicrosoftProfileCapabilities(
  value: unknown,
  fallback: MicrosoftProfileConsumer[] = DEFAULT_MICROSOFT_PROFILE_CAPABILITIES
): MicrosoftProfileConsumer[] {
  let rawValue = value;
  if (typeof rawValue === 'string') {
    try {
      rawValue = JSON.parse(rawValue);
    } catch {
      rawValue = null;
    }
  }

  if (!Array.isArray(rawValue)) {
    return [...fallback];
  }

  const capabilities = new Set<MicrosoftProfileConsumer>();
  for (const capability of rawValue) {
    if (typeof capability === 'string' && isSupportedMicrosoftProfileConsumer(capability)) {
      capabilities.add(capability);
    }
  }

  return [...capabilities];
}

export function hasMicrosoftProfileCapability(
  capabilities: readonly MicrosoftProfileConsumer[],
  consumerType: MicrosoftProfileConsumer
): boolean {
  return capabilities.includes(consumerType);
}
