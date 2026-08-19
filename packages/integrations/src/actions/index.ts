/**
 * @alga-psa/integrations - Actions
 */

export {
  getQboItems,
  getQboAccounts,
  getQboClasses,
  getQboDepartments,
  getQboConnectionStatus,
  saveQboCredentials,
  disconnectQbo,
  getQboTaxCodes,
  getQboAutomatedSalesTaxMode,
  setQboAutomatedSalesTaxMode,
  getQboTerms,
  getQboCustomers,
  resetQboCatalogCacheForTenant,
  getTenantQboCredentials,
  type QboConnectionSummary,
  type QboConnectionStatus,
  type QboCredentialStatus,
  type QboItem,
  type QboTaxCode,
  type QboTerm,
  type QboCustomer,
  type QboAccount,
  type QboClass,
  type QboDepartment
} from './qboActions';
export {
  getCalendarProviders,
  createCalendarProvider,
  updateCalendarProvider,
  deleteCalendarProvider,
  syncCalendarProvider,
  syncScheduleEntryToCalendar,
  syncExternalEventToSchedule,
  resolveCalendarConflict,
  getScheduleEntrySyncStatus,
  initiateCalendarOAuth,
  getGoogleAuthUrl,
  getMicrosoftAuthUrl,
  retryMicrosoftCalendarSubscriptionRenewal
} from './calendarActions';
export {
  getExternalEntityMappings,
  createExternalEntityMapping,
  updateExternalEntityMapping,
  deleteExternalEntityMapping,
  type CreateMappingData,
  type ExternalEntityMapping,
  type UpdateMappingData
} from './externalMappingActions';
export {
  configureGmailProvider,
  type ConfigureGmailProviderResult
} from './email-actions/configureGmailProvider';
export {
  getEmailProviders,
  upsertEmailProvider,
  createEmailProvider,
  updateEmailProvider,
  deleteEmailProvider,
  resyncImapProvider,
  testEmailProviderConnection,
  retryMicrosoftSubscriptionRenewal,
  runMicrosoft365Diagnostics
} from './email-actions/emailProviderActions';
export {
  pauseEmailProvider,
  resumeEmailProvider,
  type EmailProviderPauseActionResult
} from './email-actions/inboundPauseActions';
export {
  getEmailDomains,
  addEmailDomain,
  verifyEmailDomain,
  deleteEmailDomain
} from './email-actions/emailDomainActions';
export {
  getEmailSettings,
  getMicrosoftOutboundMailboxes,
  updateEmailSettings,
  testOutboundEmail
} from './email-actions/emailSettingsActions';
export type {
  EmailSettingsView,
  MicrosoftOutboundMailboxOption,
} from './email-actions/emailSettingsActions';
export {
  getInboundTicketDefaults,
  createInboundTicketDefaults,
  updateInboundTicketDefaults,
  deleteInboundTicketDefaults
} from './email-actions/inboundTicketDefaultsActions';
export {
  getTicketFieldOptions,
  getAvailableStatuses,
  getCategoriesByBoard
} from './email-actions/ticketFieldOptionsActions';
export {
  setupPubSub
} from './email-actions/setupPubSub';
export {
  initiateEmailOAuth
} from './email-actions/oauthActions';
export {
  getXeroCsvSettings,
  saveXeroCsvSettings,
  updateXeroCsvSettings,
  previewXeroCsvTaxImport,
  executeXeroCsvTaxImport,
  exportClientsToXeroCsv,
  previewXeroCsvClientImport,
  executeXeroCsvClientImport,
  type XeroCsvSettings
} from './integrations/xeroCsvActions';
export {
  getGoogleIntegrationStatus,
  saveGoogleIntegrationSettings,
  resetGoogleProvidersToDisconnected
} from './integrations/googleActions';
export {
  getMicrosoftIntegrationStatus,
  getMicrosoftConsumerSetupStatus,
  getMicrosoftEmailIssuerOptions,
  listMicrosoftProfiles,
  listMicrosoftConsumerBindings,
  createMicrosoftProfile,
  setMicrosoftConsumerBinding,
  updateMicrosoftProfile,
  archiveMicrosoftProfile,
  deleteMicrosoftProfile,
  setDefaultMicrosoftProfile,
  resolveMicrosoftProfileForConsumer,
  saveMicrosoftIntegrationSettings,
  resetMicrosoftProvidersToDisconnected,
  runMicrosoftEmailIssuerBackfill
} from './integrations/microsoftActions';
export {
  getMicrosoftEmailSetupOptions,
  getMicrosoftEmailAdminConsentUrl,
  configureMicrosoftEmailPlatformApplication,
  createMicrosoftEmailApplication,
  type MicrosoftEmailSetupOptionsResult,
  type MicrosoftEmailSetupCompletionResult,
} from './integrations/microsoftEmailSetupActions';
export {
  listMspSsoLoginDomains,
  listMspSsoDomainClaims,
  saveMspSsoLoginDomains,
  requestMspSsoDomainClaim,
  refreshMspSsoDomainClaimChallenge,
  verifyMspSsoDomainClaimOwnership,
  revokeMspSsoDomainClaim,
  getMspSsoTenantCredentialStatus,
  type MspSsoTenantCredentialStatusResult,
} from './integrations/mspSsoDomainActions';
export {
  getTeamsIntegrationStatus,
  runTeamsDiagnostics,
  sendTeamsTestMessage,
  saveTeamsIntegrationSettings,
  validateTeamsGraphCredentials,
  probeTeamsGraphPermissions,
  validateTeamsBotConnector,
  listTeamsDeliveries,
  listTeamsAuditEvents,
  getTeamsAddonPurchaseAccess,
  type TeamsDiagnosticsReport,
  type TeamsTestMessageResult,
  type TeamsGraphCredentialValidationResult,
  type TeamsGraphPermissionsProbeResult,
  type TeamsBotConnectorValidationResult,
  type TeamsDeliveriesPage,
  type TeamsAuditEventsPage,
  type TeamsDeliveryLogRow,
  type TeamsAuditLogRow,
  type ListTeamsDeliveriesParams,
  type ListTeamsAuditEventsParams,
} from './integrations/teamsActions';
export {
  getTeamsAppPackageStatus,
} from './integrations/teamsPackageActions';
export {
  initiateEntraDirectOAuth,
  connectEntraCipp,
  testEntraCippCredentials,
  runEntraPreflight,
  getEntraConfirmedMappings,
  getEntraSyncSchedule,
  canManageEntraIntegration,
  saveEntraSyncSchedule,
  getEntraIntegrationStatus,
  updateEntraFieldSyncConfig,
  connectEntraIntegration,
  getEntraReconciliationQueue,
  resolveEntraQueueToExisting,
  resolveEntraQueueToNew,
  dismissEntraQueueItem,
  validateEntraDirectConnection,
  validateEntraCippConnection,
  disconnectEntraIntegration,
  getEntraSyncRunHistory,
  getEntraSyncRunDetail,
  discoverEntraManagedTenants,
  getEntraMappingPreview,
  listEntraMappingGroups,
  confirmEntraMappings,
  skipEntraTenantMapping,
  importEntraTenantAsClient,
  unmapEntraTenant,
  remapEntraTenant,
  startEntraSync,
  type EntraConnectionType,
  type EntraSyncScope,
  type EntraStatusResponse,
  type EntraMappingPreviewResponse,
  type EntraMappingGroupOption,
  type EntraSyncHistoryRun,
  type EntraSyncHistoryResponse,
  type EntraSyncRunDetail,
  type EntraSyncRunTenantResult,
  type EntraReconciliationQueueItem,
  type EntraReconciliationQueueResponse,
  type EntraQueueResolutionResponse,
  type EntraFieldSyncConfig,
  type EntraConfirmedMapping,
  type EntraPreflightBucketId,
  type EntraPreflightIdentity,
  type EntraPreflightResponse,
  type EntraSyncScheduleSettings,
} from './integrations/entraActions';
export {
  getTacticalRmmSettings,
  saveTacticalRmmConfiguration,
  testTacticalRmmConnection,
  disconnectTacticalRmmIntegration,
  getTacticalRmmConnectionSummary,
  syncTacticalRmmOrganizations,
  syncTacticalRmmDevices,
  listTacticalRmmOrganizationMappings,
  updateTacticalRmmOrganizationMapping,
  getTacticalRmmWebhookInfo,
  backfillTacticalRmmAlerts,
  ingestTacticalRmmSoftwareInventory,
  syncTacticalRmmSingleAgent,
} from './integrations/tacticalRmmActions';
export {
  listRmmAlertRules,
  createRmmAlertRule,
  updateRmmAlertRule,
  deleteRmmAlertRule,
  reorderRmmAlertRules,
  listRmmMaintenanceWindows,
  createRmmMaintenanceWindow,
  updateRmmMaintenanceWindow,
  deleteRmmMaintenanceWindow,
  getRmmAlertRuleFormOptions,
  getRmmAlertPollingSettings,
  updateRmmAlertPollingSettings,
  getRmmIntegrationIdByProvider,
  type RmmAlertRuleFormOptions,
  type RmmAlertPollingSettingsView,
} from './integrations/rmmAlertRuleActions';
export {
  TACTICAL_WEBHOOK_HEADER_NAME,
  type TacticalRmmAuthMode,
} from '../lib/rmm/tacticalrmm/shared';
export {
  getXeroConnectionStatus,
  getXeroIntegrationStatus,
  saveXeroCredentials,
  disconnectXero,
  getXeroAccounts,
  getXeroItems,
  getXeroTaxRates,
  getXeroTrackingCategories,
  type XeroConnectionStatus,
  type XeroAccountOption,
  type XeroItemOption,
  type XeroTaxRateOption,
  type XeroTrackingCategoryOption
} from './integrations/xeroActions';
export {
  getServices,
  type PaginatedServicesResponse,
  type ServiceListOptions
} from './serviceCatalogActions';
export {
  getTaxRegions
} from './taxRegionActions';
