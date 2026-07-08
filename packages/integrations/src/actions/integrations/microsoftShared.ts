export const MICROSOFT_PROFILE_CONSUMERS = ['msp_sso', 'email', 'calendar', 'teams'] as const;

export type MicrosoftProfileConsumer = typeof MICROSOFT_PROFILE_CONSUMERS[number];

export const DEFAULT_MICROSOFT_PROFILE_CAPABILITIES: MicrosoftProfileConsumer[] = [
  ...MICROSOFT_PROFILE_CONSUMERS,
];

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
