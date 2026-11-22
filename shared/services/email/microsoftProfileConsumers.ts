// Pure constants and functions (no server imports): Microsoft profile consumers and their
// edition visibility. Lives in shared so both integrations and ee-calendar can import it.
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

const CE_VISIBLE_MICROSOFT_CONSUMERS: MicrosoftProfileConsumer[] = ['msp_sso', 'email'];
const EE_VISIBLE_MICROSOFT_CONSUMERS: MicrosoftProfileConsumer[] = ['msp_sso', 'email', 'calendar', 'teams', 'entra'];

export function isMicrosoftConsumerEnterpriseEdition(): boolean {
  const edition = (process.env.EDITION ?? '').toLowerCase();
  const publicEdition = (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase();

  return edition === 'ee' || edition === 'enterprise' || publicEdition === 'enterprise';
}

export function getVisibleMicrosoftConsumerTypes(
  isEnterpriseEdition = isMicrosoftConsumerEnterpriseEdition()
): MicrosoftProfileConsumer[] {
  return isEnterpriseEdition
    ? [...EE_VISIBLE_MICROSOFT_CONSUMERS]
    : [...CE_VISIBLE_MICROSOFT_CONSUMERS];
}

export function isVisibleMicrosoftConsumerType(
  consumerType: string,
  isEnterpriseEdition = isMicrosoftConsumerEnterpriseEdition()
): consumerType is MicrosoftProfileConsumer {
  return getVisibleMicrosoftConsumerTypes(isEnterpriseEdition).includes(
    consumerType as MicrosoftProfileConsumer
  );
}

/**
 * The single definition of what the AlgaPSA-supplied Microsoft app serves on
 * this build: `email` always, `calendar` only where the calendar package is
 * present (the same EE edition gate that makes the Calendar consumer visible).
 * Setup, consent-time binding, reconciliation and status surfaces all read this.
 */
export function getMicrosoftPlatformAppServedConsumers(
  visibleConsumers: readonly MicrosoftProfileConsumer[] = getVisibleMicrosoftConsumerTypes()
): MicrosoftProfileConsumer[] {
  return visibleConsumers.includes('calendar') ? ['email', 'calendar'] : ['email'];
}
