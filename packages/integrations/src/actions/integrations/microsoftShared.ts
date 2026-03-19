export const MICROSOFT_PROFILE_CONSUMERS = ['msp_sso', 'email', 'calendar', 'teams'] as const;

export type MicrosoftProfileConsumer = typeof MICROSOFT_PROFILE_CONSUMERS[number];
