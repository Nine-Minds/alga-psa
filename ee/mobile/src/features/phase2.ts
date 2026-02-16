function parseBool(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return value.trim().toLowerCase() === "true";
}

// Phase 2 modules must be explicitly enabled in development only.
// Production builds hard-disable them to avoid accidental exposure.
export const phase2Features = {
  notifications: __DEV__ ? parseBool(process.env.EXPO_PUBLIC_PHASE2_NOTIFICATIONS) : false,
  selfHostedBaseUrl: __DEV__ ? parseBool(process.env.EXPO_PUBLIC_PHASE2_SELF_HOSTED) : false,
} as const;

