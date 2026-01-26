import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    // Main entry (buildable lib/models/services only)
    'index': 'src/index.ts',
    // Lib utilities (buildable)
    'lib/externalMappingWorkflowEvents': 'src/lib/externalMappingWorkflowEvents.ts',
    'lib/qbo/types': 'src/lib/qbo/types.ts',
    'lib/qbo/qboUtils': 'src/lib/qbo/qboUtils.ts',
    'lib/qbo/qboClientService': 'src/lib/qbo/qboClientService.ts',
    'lib/qbo/qboLookupActions': 'src/lib/qbo/qboLookupActions.ts',
    'lib/xero/xeroClientService': 'src/lib/xero/xeroClientService.ts',
    // Models
    'models/index': 'src/models/index.ts',
    // Services (buildable)
    'services/index': 'src/services/index.ts',
    'services/email/index': 'src/services/email/index.ts',
    'services/email/EmailProviderService': 'src/services/email/EmailProviderService.ts',
    'services/email/GmailWebhookService': 'src/services/email/GmailWebhookService.ts',
    'services/email/providers/index': 'src/services/email/providers/index.ts',
    'services/email/providers/GmailAdapter': 'src/services/email/providers/GmailAdapter.ts',
    'services/xeroCsvClientSyncService': 'src/services/xeroCsvClientSyncService.ts',
    'services/xeroCsvTaxImportService': 'src/services/xeroCsvTaxImportService.ts',
    // Calendar services
    'services/calendar/CalendarProviderService': 'src/services/calendar/CalendarProviderService.ts',
    'services/calendar/CalendarSyncService': 'src/services/calendar/CalendarSyncService.ts',
    'services/calendar/CalendarWebhookMaintenanceService': 'src/services/calendar/CalendarWebhookMaintenanceService.ts',
    'services/calendar/CalendarWebhookProcessor': 'src/services/calendar/CalendarWebhookProcessor.ts',
    'services/calendar/providers/base/BaseCalendarAdapter': 'src/services/calendar/providers/base/BaseCalendarAdapter.ts',
    'services/calendar/providers/GoogleCalendarAdapter': 'src/services/calendar/providers/GoogleCalendarAdapter.ts',
    'services/calendar/providers/MicrosoftCalendarAdapter': 'src/services/calendar/providers/MicrosoftCalendarAdapter.ts',
    // Utils (buildable)
    'utils/calendar/eventMapping': 'src/utils/calendar/eventMapping.ts',
    'utils/calendar/oauthHelpers': 'src/utils/calendar/oauthHelpers.ts',
    'utils/calendar/oauthStateStore': 'src/utils/calendar/oauthStateStore.ts',
    'utils/calendar/recurrenceConverter': 'src/utils/calendar/recurrenceConverter.ts',
    'utils/calendar/redirectUri': 'src/utils/calendar/redirectUri.ts',
    'utils/email/oauthHelpers': 'src/utils/email/oauthHelpers.ts',
    'utils/email/webhookHelpers': 'src/utils/email/webhookHelpers.ts',
    // Webhooks (buildable)
    'webhooks/calendar/google': 'src/webhooks/calendar/google.ts',
    'webhooks/calendar/microsoft': 'src/webhooks/calendar/microsoft.ts',
    'webhooks/email/google': 'src/webhooks/email/google.ts',
    'webhooks/email/microsoft': 'src/webhooks/email/microsoft.ts',
    'webhooks/email/test': 'src/webhooks/email/test.ts',
    'webhooks/stripe/index': 'src/webhooks/stripe/index.ts',
    'webhooks/stripe/payments': 'src/webhooks/stripe/payments.ts',
    // Email domains (buildable)
    'email/index': 'src/email/index.ts',
    'email/domains/index': 'src/email/domains/index.ts',
    'email/domains/entry': 'src/email/domains/entry.ts',
    'email/domains/providers/ResendEmailProvider': 'src/email/domains/providers/ResendEmailProvider.ts',
    'email/domains/services/ManagedDomainService': 'src/email/domains/services/ManagedDomainService.ts',
    'email/domains/services/dnsLookup': 'src/email/domains/services/dnsLookup.ts',
    // Note: email/providers and email/settings contain runtime components with 'use client'
    // and should be imported via '@alga-psa/integrations/email/providers/entry' etc. (runtime)
    // Component types and schemas (buildable - no 'use client')
    'components/email/types': 'src/components/email/types.ts',
    'components/email/emailProviderDefaults': 'src/components/email/emailProviderDefaults.ts',
    'components/email/providers/gmail/schemas': 'src/components/email/providers/gmail/schemas.ts',
    'components/accounting-mappings/types': 'src/components/accounting-mappings/types.ts',
    // Note: CSV mapping modules import server actions, so they're runtime code
    // Import via '@alga-psa/integrations/components/csv/csvMappingModules' (runtime)
    // Routes (buildable)
    'routes/api/integrations/qbo/callback': 'src/routes/api/integrations/qbo/callback.ts',
    'routes/api/integrations/qbo/connect': 'src/routes/api/integrations/qbo/connect.ts',
    'routes/api/integrations/xero/callback': 'src/routes/api/integrations/xero/callback.ts',
    'routes/api/integrations/xero/connect': 'src/routes/api/integrations/xero/connect.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  bundle: true,
  splitting: true,
  sourcemap: false,
  clean: true,
  outDir: 'dist',
  external: [
    // All @alga-psa packages and @shared should be external (resolved at runtime)
    /^@alga-psa\/.*/,
    /^@shared\/.*/,
    /^@ee\/.*/,
    'react',
    'react-dom',
    'next',
    'next/navigation',
    'next/cache',
    'next-auth',
    'next-auth/react',
    'knex',
    'axios',
    'node-quickbooks',
    'zod',
    'uuid',
    'googleapis',
    'google-auth-library',
    '@googleapis/calendar',
    '@googleapis/gmail',
    '@googleapis/pubsub',
    'stripe',
    'resend',
    'dns/promises',
  ],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
