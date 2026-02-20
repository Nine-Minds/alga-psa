/**
 * @alga-psa/integrations - Actions
 */

export {
  getQboItems,
  getQboConnectionStatus,
  disconnectQbo,
  getQboTaxCodes,
  getQboTerms,
  resetQboCatalogCacheForTenant,
  getTenantQboCredentials,
  type QboConnectionSummary,
  type QboConnectionStatus,
  type QboItem,
  type QboTaxCode,
  type QboTerm
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
  runMicrosoft365Diagnostics,
  getHostedMicrosoftConfig
} from './email-actions/emailProviderActions';
export {
  getEmailDomains,
  addEmailDomain,
  verifyEmailDomain,
  deleteEmailDomain
} from './email-actions/emailDomainActions';
export {
  getEmailSettings,
  updateEmailSettings
} from './email-actions/emailSettingsActions';
export {
  getInboundTicketDefaults,
  createInboundTicketDefaults,
  updateInboundTicketDefaults,
  deleteInboundTicketDefaults
} from './email-actions/inboundTicketDefaultsActions';
export {
  getTicketFieldOptions,
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
  initiateEntraDirectOAuth,
  connectEntraCipp,
  getEntraIntegrationStatus,
  connectEntraIntegration,
  validateEntraDirectConnection,
  validateEntraCippConnection,
  disconnectEntraIntegration,
  discoverEntraManagedTenants,
  getEntraMappingPreview,
  confirmEntraMappings,
  skipEntraTenantMapping,
  startEntraSync,
  type EntraConnectionType,
  type EntraSyncScope,
  type EntraStatusResponse,
  type EntraMappingPreviewResponse,
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
  TACTICAL_WEBHOOK_HEADER_NAME,
  type TacticalRmmAuthMode,
} from '../lib/rmm/tacticalrmm/shared';
export {
  getXeroConnectionStatus,
  getXeroIntegrationStatus,
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
