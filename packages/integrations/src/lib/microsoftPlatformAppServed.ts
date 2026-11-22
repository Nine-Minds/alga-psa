// Client-safe: re-exports pure definitions, never the server-only platform-app module.
export {
  getMicrosoftPlatformAppServedConsumers,
  MICROSOFT_PLATFORM_PROFILE_DISPLAY_NAME,
  MICROSOFT_TENANT_APP_DEFAULT_DISPLAY_NAME,
} from '@alga-psa/shared/services/email/microsoftProfileConsumers';
