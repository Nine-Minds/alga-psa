// The runtime runner and gate use this inventory from their candidate checkout.
export const citusRuntimeFiles = Object.freeze([
  'ee/temporal-workflows/src/__tests__/integration/workflowInvocationPersistence.integration.test.ts',
  'server/src/test/integration/invoiceTicketImmutable.integration.test.ts',
  'server/src/test/integration/remainingBucketUnits.integration.test.ts',
  'server/src/test/integration/coManagedInternalEmailClaim.integration.test.ts',
  'server/src/test/integration/coManagedSeatAcceptance.db.test.ts',
  'server/src/test/integration/coManagedSeatInvitation.db.test.ts',
  'server/src/test/integration/coManagedTicketQueue.db.test.ts',
  'server/migrations/__tests__/unitOfMeasureBackfill.integration.test.ts',
  'server/migrations/__tests__/collapseRecurringServicePeriodObligationTypeMigration.integration.test.ts',
  'server/migrations/__tests__/coManagedMeetingCreationOperationsMigration.integration.test.ts',
  'server/migrations/__tests__/coManagedSeatTrialTicketWorkMigration.integration.test.ts',
  'server/migrations/__tests__/stripeCatalogAccountBackfill.integration.test.ts',
  'server/migrations/__tests__/timeSheetUniquenessMigrationDistribution.integration.test.ts',
]);
