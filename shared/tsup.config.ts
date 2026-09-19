import { defineConfig } from 'tsup';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/** Entry map for every buildable module directly under billingClients/. */
function billingClientEntries(): Record<string, string> {
  return Object.fromEntries(
    readdirSync(join(here, 'billingClients'), { withFileTypes: true })
      .filter(e => e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.d.ts') && !e.name.includes('.test.'))
      .map(e => e.name.slice(0, -3))
      .map(name => [`billingClients/${name}`, `billingClients/${name}.ts`]),
  );
}

export default defineConfig({
  entry: {
    'lib/ticketCommentAttachments': 'lib/ticketCommentAttachments.ts',
    'lib/ticketCommentAttachmentToken': 'lib/ticketCommentAttachmentToken.ts',
    'index': 'index.ts',
    'types/index': 'types/index.ts',
    'core/logger': 'core/logger.ts',
    'core/secretProvider': 'core/secretProvider.ts',
    'core/deploymentProfile': 'core/deploymentProfile.ts',
    'db/index': 'db/index.ts',
    'db/admin': 'db/admin.ts',
    'db/connection': 'db/connection.ts',
    'db/tenant': 'db/tenant.ts',
    'events/publisher': 'events/publisher.ts',
    'utils/encryption': 'utils/encryption.ts',
    'utils/retryUtils': 'utils/retryUtils.ts',
    'utils/tenantSlug': 'utils/tenantSlug.ts',
    'utils/appointmentDateTime': 'utils/appointmentDateTime.ts',
    'services/email/microsoftEmailProviderConfig': 'services/email/microsoftEmailProviderConfig.ts',
    'services/email/providers/MicrosoftGraphAdapter': 'services/email/providers/MicrosoftGraphAdapter.ts',
    'services/diagnostics/index': 'services/diagnostics/index.ts',
    'services/entra/entraCallbackUrl': 'services/entra/entraCallbackUrl.ts',
    'workflow/index': 'workflow/index.ts',
    'workflow/runtime/index': 'workflow/runtime/index.ts',
    'workflow/persistence/index': 'workflow/persistence/index.ts',
    'workflow/streams/index': 'workflow/streams/index.ts',
    'workflow/streams/eventBusSchema': 'workflow/streams/eventBusSchema.ts',
    'workflow/streams/redisStreamClient': 'workflow/streams/redisStreamClient.ts',
    'workflow/streams/workflowEventPublishHelpers': 'workflow/streams/workflowEventPublishHelpers.ts',
    'workflow/streams/workflowEventSchema': 'workflow/streams/workflowEventSchema.ts',
    'workflow/streams/domainEventBuilders/appointmentEventBuilders': 'workflow/streams/domainEventBuilders/appointmentEventBuilders.ts',
    'workflow/streams/domainEventBuilders/assetEventBuilders': 'workflow/streams/domainEventBuilders/assetEventBuilders.ts',
    'workflow/streams/domainEventBuilders/capacityThresholdEventBuilders': 'workflow/streams/domainEventBuilders/capacityThresholdEventBuilders.ts',
    'workflow/streams/domainEventBuilders/clientEventBuilders': 'workflow/streams/domainEventBuilders/clientEventBuilders.ts',
    'workflow/streams/domainEventBuilders/contactEventBuilders': 'workflow/streams/domainEventBuilders/contactEventBuilders.ts',
    'workflow/streams/domainEventBuilders/contractEventBuilders': 'workflow/streams/domainEventBuilders/contractEventBuilders.ts',
    'workflow/streams/domainEventBuilders/creditNoteEventBuilders': 'workflow/streams/domainEventBuilders/creditNoteEventBuilders.ts',
    'workflow/streams/domainEventBuilders/crmInteractionNoteEventBuilders': 'workflow/streams/domainEventBuilders/crmInteractionNoteEventBuilders.ts',
    'workflow/streams/domainEventBuilders/documentAssociationEventBuilders': 'workflow/streams/domainEventBuilders/documentAssociationEventBuilders.ts',
    'workflow/streams/domainEventBuilders/documentGeneratedEventBuilders': 'workflow/streams/domainEventBuilders/documentGeneratedEventBuilders.ts',
    'workflow/streams/domainEventBuilders/documentStorageEventBuilders': 'workflow/streams/domainEventBuilders/documentStorageEventBuilders.ts',
    'workflow/streams/domainEventBuilders/emailFeedbackEventBuilders': 'workflow/streams/domainEventBuilders/emailFeedbackEventBuilders.ts',
    'workflow/streams/domainEventBuilders/externalMappingEventBuilders': 'workflow/streams/domainEventBuilders/externalMappingEventBuilders.ts',
    'workflow/streams/domainEventBuilders/inboundEmailReplyEventBuilders': 'workflow/streams/domainEventBuilders/inboundEmailReplyEventBuilders.ts',
    'workflow/streams/domainEventBuilders/integrationConnectionEventBuilders': 'workflow/streams/domainEventBuilders/integrationConnectionEventBuilders.ts',
    'workflow/streams/domainEventBuilders/integrationSyncEventBuilders': 'workflow/streams/domainEventBuilders/integrationSyncEventBuilders.ts',
    'workflow/streams/domainEventBuilders/integrationTokenEventBuilders': 'workflow/streams/domainEventBuilders/integrationTokenEventBuilders.ts',
    'workflow/streams/domainEventBuilders/integrationWebhookEventBuilders': 'workflow/streams/domainEventBuilders/integrationWebhookEventBuilders.ts',
    'workflow/streams/domainEventBuilders/mediaEventBuilders': 'workflow/streams/domainEventBuilders/mediaEventBuilders.ts',
    'workflow/streams/domainEventBuilders/notificationEventBuilders': 'workflow/streams/domainEventBuilders/notificationEventBuilders.ts',
    'workflow/streams/domainEventBuilders/projectLifecycleEventBuilders': 'workflow/streams/domainEventBuilders/projectLifecycleEventBuilders.ts',
    'workflow/streams/domainEventBuilders/projectTaskEventBuilders': 'workflow/streams/domainEventBuilders/projectTaskEventBuilders.ts',
    'workflow/streams/domainEventBuilders/recurringBillingRunEventBuilders': 'workflow/streams/domainEventBuilders/recurringBillingRunEventBuilders.ts',
    'workflow/streams/domainEventBuilders/scheduleBlockEventBuilders': 'workflow/streams/domainEventBuilders/scheduleBlockEventBuilders.ts',
    'workflow/streams/domainEventBuilders/surveyEventBuilders': 'workflow/streams/domainEventBuilders/surveyEventBuilders.ts',
    'workflow/streams/domainEventBuilders/tagEventBuilders': 'workflow/streams/domainEventBuilders/tagEventBuilders.ts',
    'workflow/streams/domainEventBuilders/technicianDispatchEventBuilders': 'workflow/streams/domainEventBuilders/technicianDispatchEventBuilders.ts',
    'workflow/secrets/index': 'workflow/secrets/index.ts',
    'workflow/workers/index': 'workflow/workers/index.ts',
    'workflow/services/index': 'workflow/services/index.ts',
    'extension-utils/index': 'extension-utils/index.ts',
    'models/clientModel': 'models/clientModel.ts',
    'models/contactModel': 'models/contactModel.ts',
    'models/kbArticleModel': 'models/kbArticleModel.ts',
    'models/scheduleEntry': 'models/scheduleEntry.ts',
    'models/tagModel': 'models/tagModel.ts',
    'models/ticketModel': 'models/ticketModel.ts',
    'models/userModel': 'models/userModel.ts',
    'utils/recurrenceUtils': 'utils/recurrenceUtils.ts',
    'extensions/domain': 'extensions/domain.ts',
    'extensions/installs': 'extensions/installs.ts',
    'extensions/types': 'extensions/types.ts',
    'billingClients/resolveFixedLineRate': 'billingClients/resolveFixedLineRate.ts',
    // Whole directory, not a hand-picked list. Every module under
    // billingClients/ is reachable as a public subpath (package.json maps
    // ./billingClients/* -> ./dist/billingClients/*.js), and consumers that
    // resolve through the exports map rather than being transpiled from source
    // -- packages/jobs' vitest run, the plain-Node workflow and temporal
    // workers, packages/co-managed's dist build -- get "Cannot find package"
    // for anything missing here. Enumerating by hand meant every new
    // billingClients module was one more chance to forget.
    ...billingClientEntries(),
    'lib/boardTicketDefaults': 'lib/boardTicketDefaults.ts',
    'lib/commentAudience': 'lib/commentAudience.ts',
    'lib/quoteTerms': 'lib/quoteTerms.ts',
    'lib/email/senderAuthVerification': 'lib/email/senderAuthVerification.ts',
    'lib/tickets/responseStateSettings': 'lib/tickets/responseStateSettings.ts',
    'lib/tickets/clientPortalVisibility': 'lib/tickets/clientPortalVisibility.ts',
    'lib/tickets/clientPortalVisibility.server': 'lib/tickets/clientPortalVisibility.server.ts',
    'lib/ticketActivity/index': 'lib/ticketActivity/index.ts',
    'lib/ticketActivity/types': 'lib/ticketActivity/types.ts',
    'lib/ticketActivity/writeTicketActivity': 'lib/ticketActivity/writeTicketActivity.ts',
    'lib/ticketActivity/readTicketActivity': 'lib/ticketActivity/readTicketActivity.ts',
    'lib/ticketActivity/curatedTicketDiff': 'lib/ticketActivity/curatedTicketDiff.ts',
    'lib/businessHours/businessHoursSegmentation': 'lib/businessHours/businessHoursSegmentation.ts',
    'lib/sla/organizationSlaClock': 'lib/sla/organizationSlaClock.ts',
    'lib/sla/organizationSlaStore': 'lib/sla/organizationSlaStore.ts',
    'lib/sla/organizationSlaNotifications': 'lib/sla/organizationSlaNotifications.ts',
    'lib/sla/organizationSlaLock': 'lib/sla/organizationSlaLock.ts',
    'lib/sla/slaPolicyResolver': 'lib/sla/slaPolicyResolver.ts',
    // Exported in package.json as dist targets, so plain-Node consumers (the
    // workflow/temporal workers and packages/co-managed's dist build, which
    // imports lib/ticketCloseRules) resolve them through dist rather than
    // being transpiled from source. Without entries the dist files are never
    // generated and the import fails at worker startup.
    'core/index': 'core/index.ts',
    'lib/ticketChecklists/index': 'lib/ticketChecklists/index.ts',
    'lib/ticketCloseRules/index': 'lib/ticketCloseRules/index.ts',
  },
  format: ['esm'],
  dts: false,
  bundle: true,
  splitting: true,
  sourcemap: false,
  clean: true,
  outDir: 'dist',
  external: [
    'react',
    'react-dom',
    'knex',
    'pg',
    'redis',
    'winston',
    'winston-daily-rotate-file',
    'uuid',
    'zod',
    'dotenv',
    'axios',
    'jsonata',
    'turndown',
    'node-vault',
    'googleapis',
    'google-auth-library',
    '@js-temporal/polyfill',
    /^@alga-psa\//,
  ],
  noExternal: [
    /^@shared\//,
  ],
});
