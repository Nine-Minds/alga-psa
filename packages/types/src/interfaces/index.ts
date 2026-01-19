export interface TenantEntity {
  tenant?: string;
}

export * from './accountingExport.interfaces';
export * from './activity.interfaces';
export * from './asset.interfaces';
export type {
  IUser,
  IRole,
  IPermission,
  IUserWithRoles,
  ITeam,
  IRoleWithPermissions,
  IPolicy,
  ICondition,
  IUserRole,
  IUserRegister,
  IUserAuthenticated,
  TPasswordCriteria,
} from './auth.interfaces';
export * from './billing.interfaces';
export * from './board.interface';
export * from './cache.interfaces';
export * from './calendar.interfaces';
export * from './client.interfaces';
export * from './comment.interface';
export * from './contact.interfaces';
export * from './contract.interfaces';
export * from './contractLineServiceConfiguration.interfaces';
export * from './contractTemplate.interfaces';
export * from './dataTable.interfaces';
export * from './document-association.interface';
export * from './document.interface';
export * from './documentBlockContent.interface';
export * from './drag.interfaces';
export * from './event.interfaces';
export * from './interaction.interfaces';
export * from './invoice.interfaces';
export * from './material.interfaces';
export * from './microsoft365-diagnostics.interfaces';
export * from './payment.interfaces';
export * from './phaseTaskImport.interfaces';
export * from './project.interfaces';
export * from './projectTaskComment.interface';
export * from './projectTemplate.interfaces';
export * from './schedule.interfaces';
export * from './scheduling.interfaces';
export * from './serviceTier.interfaces';
export * from './session.interfaces';
export * from './software.interfaces';
export * from './status.interface';
export * from './subscription.interfaces';
export * from './survey.interface';
export * from './storage.interfaces';
export * from './tag.interfaces';
export * from './taskResource.interfaces';
export * from './tenant.interface';
export * from './ticket.interfaces';
export * from './ticketResource.interfaces';
export * from './timeEntry.interfaces';
export * from './usage.interfaces';
export * from './validation.interfaces';
export * from './workItem.interfaces';

// Tax interfaces: selectively exported to avoid collisions with billing.interfaces' ITaxRate.
export type {
  IClientTaxSettings,
  ITaxComponent,
  ICompositeTaxMapping,
  ITaxRateThreshold,
  ITaxHoliday,
  ITaxCalculationResult,
  ITaxRegion,
  IClientTaxRateAssociation,
  TaxSource,
  ITenantTaxSettings,
  IClientTaxSourceSettings,
  IExternalTaxImport,
  IExternalTaxImportResult,
  ITaxRate as ITaxRateDetails,
} from './tax.interfaces';

// Email interfaces are intentionally not exported here to avoid name collisions with outbound email types.
export * from './emailProvider.interface';

// Selectively export portal user types without re-exporting IUser/IRole/etc. (which would collide with auth.interfaces).
export type { CreatePortalUserInput, CreatePortalUserResult, PortalRoleOptions, PortalUserWithContext } from './user.interfaces';
